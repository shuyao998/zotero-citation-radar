/**
 * Module A entry point: take a paper, return an InfluenceReport ("文献定位").
 *
 * Pipeline:
 *   1. Look up seed + top-15 refs + top-10 citing from local SQLite
 *      (already populated by W1 OpenAlex fetch + W2 S2 enrichment)
 *   2. Build prompt within budget (promptBuilder)
 *   3. Call LLM provider with JSON-output mode
 *   4. Parse + validate the structured output
 *   5. Persist to influence_report table; return for UI rendering
 *
 * Cache policy:
 *   - On (paper_id, llm_model) hit, return most-recent row unless forceRefresh.
 *   - The raw JSON is preserved in raw_json so the UI can recover after
 *     schema changes without re-paying the LLM cost.
 */

import { getServices } from "../lifecycle";
import { DeepSeekProvider } from "../llm/deepseek";
import type { ChatMessage } from "../llm/provider";
import {
  buildInfluencePrompt,
  type InfluencePromptInput,
  type InfluencePromptPaper,
} from "./promptBuilder";
import type { InfluenceReport, PositionLabel } from "./reportSchema";

declare const Zotero: any;

const TOP_REFS = 15;
const TOP_CITING = 10;

export interface EvaluatorOptions {
  apiKey: string;
  llmModel: string; // e.g. "deepseek-chat"
  forceRefresh?: boolean;
}

export interface EvaluateResult {
  report: InfluenceReport;
  cached: boolean;
  generatedAt: number; // unix ms
  promptTokens?: number;
  completionTokens?: number;
}

/** Top-level entry. Throws on DB miss / LLM error / parse failure. */
export async function evaluateInfluence(
  zoteroItemId: number,
  options: EvaluatorOptions,
): Promise<EvaluateResult> {
  const { db } = getServices();
  const conn = db.connection;

  // 1. Seed lookup
  const seedRow = await conn.rowQueryAsync(
    `SELECT id, title, year, authors_json, abstract, doi, cited_by_count
     FROM paper WHERE zotero_item_id = ?`,
    [zoteroItemId],
  );
  if (!seedRow) {
    throw new Error(
      "本地数据库还没有这条目的引文记录，请先用「生成引文图谱」抓取一次",
    );
  }
  const paperId: number = seedRow.id;

  // 2. Cache hit?
  if (!options.forceRefresh) {
    const cached = await conn.rowQueryAsync(
      `SELECT generated_at, raw_json FROM influence_report
       WHERE paper_id = ? AND llm_model = ?
       ORDER BY generated_at DESC LIMIT 1`,
      [paperId, options.llmModel],
    );
    if (cached && cached.raw_json) {
      try {
        const report = parseAndValidate(cached.raw_json);
        return {
          report,
          cached: true,
          generatedAt: cached.generated_at,
        };
      } catch (err) {
        Zotero.debug(
          `[Citation Radar] Cached report unparseable, re-running: ${err}`,
        );
        // fall through to fresh evaluation
      }
    }
  }

  // 3. Gather neighborhood
  const refRows: any[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.abstract, p.doi,
            p.cited_by_count, e.is_influential
     FROM citation_edge e JOIN paper p ON e.to_paper_id = p.id
     WHERE e.from_paper_id = ? AND e.source = 'openalex'
     ORDER BY e.is_influential DESC, COALESCE(p.cited_by_count, 0) DESC
     LIMIT ?`,
    [paperId, TOP_REFS],
  );
  const citingRows: any[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.abstract, p.doi,
            p.cited_by_count, e.is_influential
     FROM citation_edge e JOIN paper p ON e.from_paper_id = p.id
     WHERE e.to_paper_id = ? AND e.source = 'openalex'
     ORDER BY e.is_influential DESC, COALESCE(p.cited_by_count, 0) DESC
     LIMIT ?`,
    [paperId, TOP_CITING],
  );
  const totalRefsLocal: number = await conn.valueQueryAsync(
    `SELECT COUNT(*) FROM citation_edge WHERE from_paper_id = ?`,
    [paperId],
  );

  // 4. Build prompt
  const promptInput: InfluencePromptInput = {
    seed: rowToPromptPaper(seedRow, false),
    topRefs: refRows.map((r) => rowToPromptPaper(r, !!r.is_influential)),
    topCiting: citingRows.map((r) => rowToPromptPaper(r, !!r.is_influential)),
    totalCitedByReal: seedRow.cited_by_count ?? undefined,
    totalRefsLocal,
  };
  const messages: ChatMessage[] = buildInfluencePrompt(promptInput);

  // 5. LLM call
  const provider = new DeepSeekProvider(options.apiKey);
  const result = await provider.chat({
    model: options.llmModel,
    messages,
    temperature: 0.3,
    responseSchema: {}, // sentinel — DeepSeek treats this as json_object mode
  });

  // 6. Parse + validate
  const report = parseAndValidate(result.content);

  // 7. Persist
  const now = Date.now();
  await conn.queryAsync(
    `INSERT INTO influence_report
       (paper_id, generated_at, llm_model, position_label, summary_md, raw_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      paperId,
      now,
      options.llmModel,
      report.positionLabel,
      report.summaryMd,
      JSON.stringify(report),
    ],
  );

  return {
    report,
    cached: false,
    generatedAt: now,
    promptTokens: result.usage?.promptTokens,
    completionTokens: result.usage?.completionTokens,
  };
}

/** Whether a cached report exists for this (paper, model) pair. */
export async function hasCachedReport(
  zoteroItemId: number,
  llmModel: string,
): Promise<boolean> {
  const { db } = getServices();
  const paperId = await db.connection.valueQueryAsync(
    `SELECT id FROM paper WHERE zotero_item_id = ?`,
    [zoteroItemId],
  );
  if (!paperId) return false;
  const row = await db.connection.valueQueryAsync(
    `SELECT id FROM influence_report
     WHERE paper_id = ? AND llm_model = ? LIMIT 1`,
    [paperId, llmModel],
  );
  return row != null;
}

// ============================================================================

function rowToPromptPaper(row: any, isInfluential: boolean): InfluencePromptPaper {
  return {
    title: row.title || "(untitled)",
    firstAuthor: extractFirstAuthor(row.authors_json),
    year: row.year ?? null,
    doi: row.doi ?? null,
    citedByCount: row.cited_by_count ?? null,
    abstract: row.abstract ?? null,
    isInfluential,
  };
}

function extractFirstAuthor(authorsJson: string | null): string {
  if (!authorsJson) return "(unknown)";
  try {
    const arr = JSON.parse(authorsJson) as Array<{ name?: string }>;
    if (!arr.length) return "(unknown)";
    const first = arr[0].name ?? "?";
    return arr.length > 1 ? `${first} 等 ${arr.length} 人` : first;
  } catch {
    return "(unknown)";
  }
}

const VALID_LABELS: ReadonlySet<PositionLabel> = new Set<PositionLabel>([
  "seminal",
  "mainstream",
  "follow-up",
  "fringe",
  "review",
]);

/**
 * Parse the LLM's JSON output and validate the shape. We're lenient about
 * extra fields, strict about the label being one of the five we support
 * (anything else is mapped to "fringe" with a caveat appended).
 */
function parseAndValidate(raw: string): InfluenceReport {
  const cleaned = stripMarkdownFence(raw).trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `LLM 输出无法解析为 JSON：${(err as Error).message}\n--- 原始片段 ---\n${cleaned.slice(0, 300)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM 输出不是 JSON 对象");
  }

  const labelRaw = String(parsed.positionLabel ?? "").trim().toLowerCase();
  let positionLabel: PositionLabel;
  let labelCaveat: string | null = null;
  if (VALID_LABELS.has(labelRaw as PositionLabel)) {
    positionLabel = labelRaw as PositionLabel;
  } else {
    positionLabel = "fringe";
    labelCaveat = `LLM 返回了不识别的 label "${parsed.positionLabel}"，已回退为 fringe`;
  }

  const conf = Number(parsed.positionConfidence);
  const positionConfidence = Number.isFinite(conf)
    ? Math.max(0, Math.min(1, conf))
    : 0.5;

  const evidence = parsed.evidence ?? {};
  const caveats: string[] = Array.isArray(parsed.caveats)
    ? parsed.caveats.filter((c: unknown) => typeof c === "string")
    : [];
  if (labelCaveat) caveats.unshift(labelCaveat);

  return {
    positionLabel,
    positionConfidence,
    oneLineVerdict: String(parsed.oneLineVerdict ?? "").trim(),
    summaryMd: String(parsed.summaryMd ?? "").trim(),
    evidence: {
      keyAncestors: Array.isArray(evidence.keyAncestors)
        ? evidence.keyAncestors.map(coerceCitedItem)
        : [],
      keyDescendants: Array.isArray(evidence.keyDescendants)
        ? evidence.keyDescendants.map(coerceCitedItem)
        : [],
      methodLineage:
        typeof evidence.methodLineage === "string"
          ? evidence.methodLineage
          : undefined,
    },
    caveats: caveats.length ? caveats : undefined,
  };
}

function coerceCitedItem(item: any): { doi?: string; title: string; reason: string } {
  return {
    doi: typeof item?.doi === "string" && item.doi ? item.doi : undefined,
    title: String(item?.title ?? "(untitled)"),
    reason: String(item?.reason ?? ""),
  };
}

/** LLMs sometimes wrap JSON in ```json ... ``` despite instructions. */
function stripMarkdownFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1] : s;
}
