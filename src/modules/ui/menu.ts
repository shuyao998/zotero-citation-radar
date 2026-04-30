/**
 * Right-click menu integration: "Citation Radar → Fetch from OpenAlex".
 *
 * For W1, the action is end-to-end-but-minimal:
 *   1. Take currently selected Zotero items
 *   2. For each item with a DOI, fetch its OpenAlex Work + reference list
 *   3. Write paper + references + edges into local SQLite
 *   4. Show progress + result via Zotero notification window
 *
 * UI for influence report (module A) and faithfulness (module B) come later.
 */

import { config } from "../../../package.json";
import { OpenAlexClient } from "../citationGraph/openAlexClient";
import { SemanticScholarClient } from "../citationGraph/semanticScholarClient";
import { getServices } from "../lifecycle";
import { getPref } from "../../utils/prefs";
import type { PaperRecord } from "../citationGraph/types";
import { prepareGraphTempFile } from "./graphView";
import { evaluateInfluence } from "../influence/evaluator";
import {
  prepareReportTempFile,
  prepareReportErrorTempFile,
} from "./reportView";
import { openInZoteroWindow, type TabSpec } from "./zoteroWindow";

declare const Zotero: any;

export function registerMenuItems(): void {
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

  ztoolkit.Menu.register("item", { tag: "menuseparator" });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${config.addonRef}-analyze-paper`,
    label: "Citation Radar：分析此论文",
    commandListener: () => {
      void onAnalyzePaper({ forceRefresh: false });
    },
    icon: menuIcon,
  });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${config.addonRef}-reanalyze-paper`,
    label: "Citation Radar：重新分析此论文（绕过缓存）",
    commandListener: () => {
      void onAnalyzePaper({ forceRefresh: true });
    },
    icon: menuIcon,
  });
}

/**
 * Single combined entry: ensure citations are fetched, build graph view,
 * try to build LLM report, then open one Zotero window with up-to-2 tabs
 * (引文图谱 + 文献定位). Report failure does NOT block the graph tab.
 *
 * `forceRefresh` skips the influence_report cache and re-runs the LLM —
 * use when the prompt changes or the cached output is unsatisfactory.
 */
async function onAnalyzePaper(opts: {
  forceRefresh: boolean;
}): Promise<void> {
  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const itemsWithDoi = items.filter(
    (it) => it.isRegularItem() && !!it.getField("DOI"),
  );
  if (itemsWithDoi.length === 0) {
    showProgress("选中的条目没有 DOI", "fail");
    return;
  }

  const { db } = getServices();

  // Step 1: ensure each selected item has been fetched into the local DB.
  const itemsToFetch: typeof itemsWithDoi = [];
  for (const item of itemsWithDoi) {
    if (!(await isAlreadyFetched(db.connection, item.id))) {
      itemsToFetch.push(item);
    }
  }
  if (itemsToFetch.length > 0) {
    const apiKey = getPref("openAlexApiKey") as string;
    if (!apiKey) {
      showProgress(
        "请先在 设置 → Citation Radar 填入 OpenAlex API key",
        "fail",
      );
      return;
    }
    await runFetchPipeline(itemsToFetch, apiKey);
  }

  // Step 2: build the graph + report tabs for the FIRST selected paper.
  const target = itemsWithDoi[0];
  const llmApiKey = getPref("llmApiKey") as string;
  const llmModel = (getPref("llmModel") as string) || "deepseek-chat";

  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: "正在生成引文图谱...",
      type: "default",
      progress: 0,
    })
    .show();

  let graphFile: string;
  let seedTitle: string;
  let seedRow: any;
  try {
    const prepared = await prepareGraphTempFile(
      target.id,
      target.getField("title") || "Paper",
    );
    graphFile = prepared.filePath;
    seedTitle = prepared.seedTitle;
    seedRow = prepared.seedRow;
  } catch (err) {
    Zotero.debug(`[Citation Radar] Graph build failed: ${err}`);
    progress.changeLine({
      progress: 100,
      text: `❌ 图谱生成失败：${(err as Error).message.slice(0, 200)}`,
      type: "fail",
    });
    progress.startCloseTimer(15000);
    return;
  }

  // Step 3: try the LLM report. Failure → wrap into an error pane so the
  // window still opens with both tabs (graph good, report shows the error).
  let reportFile: string;
  let reportTabLabel = "文献定位";
  if (!llmApiKey) {
    progress.changeLine({
      progress: 60,
      text: "未配置 LLM API Key，跳过文献定位报告",
      type: "default",
    });
    reportFile = await prepareReportErrorTempFile(
      "未配置 LLM API Key。\n请打开 设置 → Citation Radar → LLM 配置，填入 DeepSeek API Key 后再试。",
    );
    reportTabLabel = "文献定位（未配置）";
  } else {
    progress.changeLine({
      progress: 50,
      text: `正在生成文献定位报告（${llmModel}，约 20-40s）...`,
    });
    try {
      const result = await evaluateInfluence(target.id, {
        apiKey: llmApiKey,
        llmModel,
        forceRefresh: opts.forceRefresh,
      });
      reportFile = await prepareReportTempFile({
        seedTitle,
        seedAuthors: formatAuthorsForHeader(seedRow.authors_json),
        seedYear: seedRow.year,
        seedDoi: seedRow.doi,
        seedCitedBy: seedRow.cited_by_count,
        report: result.report,
        cached: result.cached,
        generatedAt: result.generatedAt,
        llmModel,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      reportTabLabel = result.cached
        ? `文献定位 · ${result.report.positionLabel}（缓存）`
        : `文献定位 · ${result.report.positionLabel}`;
    } catch (err) {
      Zotero.debug(`[Citation Radar] Report build failed: ${err}`);
      reportFile = await prepareReportErrorTempFile(
        (err as Error).message || String(err),
      );
      reportTabLabel = "文献定位（失败）";
    }
  }

  // Step 4: open the unified window.
  const tabs: TabSpec[] = [
    { label: "引文图谱", filePath: graphFile },
    { label: reportTabLabel, filePath: reportFile },
  ];
  openInZoteroWindow({
    title: `Citation Radar · ${seedTitle}`,
    tabs,
  });

  progress.changeLine({
    progress: 100,
    text: "✓ 完成",
    type: "success",
  });
  progress.startCloseTimer(4000);
}

function formatAuthorsForHeader(authorsJson: string | null): string {
  if (!authorsJson) return "(unknown authors)";
  try {
    const arr = JSON.parse(authorsJson) as Array<{ name?: string }>;
    if (!arr.length) return "(unknown authors)";
    if (arr.length <= 3) return arr.map((a) => a.name ?? "?").join(", ");
    return arr.slice(0, 3).map((a) => a.name ?? "?").join(", ") + ` 等 ${arr.length} 人`;
  } catch {
    return "(unknown authors)";
  }
}

async function isAlreadyFetched(
  conn: any,
  zoteroItemId: number,
): Promise<boolean> {
  const paperId = await conn.valueQueryAsync(
    "SELECT id FROM paper WHERE zotero_item_id = ?",
    [zoteroItemId],
  );
  if (!paperId) return false;
  const edgeCount = await conn.valueQueryAsync(
    "SELECT COUNT(*) FROM citation_edge WHERE from_paper_id = ? OR to_paper_id = ?",
    [paperId, paperId],
  );
  return (edgeCount ?? 0) > 0;
}

async function runFetchPipeline(
  itemsWithDoi: any[],
  apiKey: string,
): Promise<void> {
  const progress = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: `正在抓取 ${itemsWithDoi.length} 篇文献的引文...`,
      type: "default",
      progress: 0,
    })
    .show();

  const client = new OpenAlexClient({ apiKey });
  const { db } = getServices();

  const citedByCap = (getPref("citedByMaxResults") as number) ?? 0;
  let done = 0;
  let totalReferences = 0;
  let totalCitedByFetched = 0;
  let totalCitedByReal = 0;

  for (const item of itemsWithDoi) {
    const doi = item.getField("DOI");
    try {
      const paper = await client.getWorkByDoi(doi);
      paper.zoteroItemId = item.id;

      const paperId = await upsertPaper(db.connection, paper);

      const refs = paper.openAlexId
        ? await client.getReferences(paper.openAlexId)
        : [];

      const citedByTotal = paper.citedByCount ?? 0;
      progress.changeLine({
        progress: Math.round((done / itemsWithDoi.length) * 100),
        text:
          `[${done + 1}/${itemsWithDoi.length}] ${truncate(paper.title, 36)} ` +
          `· 抓 cited-by 0/${citedByTotal}...`,
      });

      const citedBy = paper.openAlexId
        ? await client.getCitedBy(paper.openAlexId, {
            maxResults: citedByCap,
            onProgress: (fetched, total) => {
              progress.changeLine({
                progress: Math.round((done / itemsWithDoi.length) * 100),
                text:
                  `[${done + 1}/${itemsWithDoi.length}] ${truncate(paper.title, 36)} ` +
                  `· cited-by ${fetched}/${total}`,
              });
            },
          })
        : [];

      await db.connection.executeTransaction(async () => {
        for (const ref of refs) {
          const refId = await upsertPaper(db.connection, ref);
          await db.connection.queryAsync(
            `INSERT OR IGNORE INTO citation_edge
             (from_paper_id, to_paper_id, source) VALUES (?, ?, 'openalex')`,
            [paperId, refId],
          );
        }
        for (const citing of citedBy) {
          const citingId = await upsertPaper(db.connection, citing);
          await db.connection.queryAsync(
            `INSERT OR IGNORE INTO citation_edge
             (from_paper_id, to_paper_id, source) VALUES (?, ?, 'openalex')`,
            [citingId, paperId],
          );
        }
      });

      totalReferences += refs.length;
      totalCitedByFetched += citedBy.length;
      totalCitedByReal += citedByTotal;
      done += 1;

      const partial =
        citedByCap > 0 && citedByTotal > citedByCap ? "（已上限）" : "";
      progress.changeLine({
        progress: Math.round((done / itemsWithDoi.length) * 100),
        text:
          `[${done}/${itemsWithDoi.length}] ${truncate(paper.title, 36)} ` +
          `· refs ${refs.length} · cited-by ${citedBy.length}/${citedByTotal}${partial}`,
      });
    } catch (err) {
      Zotero.debug(`[Citation Radar] Fetch failed for DOI ${doi}: ${err}`);
      progress.createLine({
        text: `❌ ${truncate(doi, 60)}: ${(err as Error).message.slice(0, 100)}`,
        type: "fail",
      });
    }
  }

  // === Semantic Scholar enrichment: mark influential edges ===
  const s2Key = (getPref("semanticScholarApiKey") as string) || undefined;
  const s2Client = new SemanticScholarClient({ apiKey: s2Key });
  let totalInfluentialMarked = 0;

  for (const item of itemsWithDoi) {
    const doi = item.getField("DOI");
    progress.createLine({
      text: `S2: 抓 influential 标记... ${truncate(doi, 50)}`,
      type: "default",
      progress: undefined,
    });
    try {
      const [refInf, citInf] = await Promise.all([
        s2Client.getReferenceInfluences(doi),
        s2Client.getCitationInfluences(doi),
      ]);
      const refDois = Object.keys(refInf).filter((d) => refInf[d]);
      const citDois = Object.keys(citInf).filter((d) => citInf[d]);

      await db.connection.executeTransaction(async () => {
        if (refDois.length > 0) {
          const placeholders = refDois.map(() => "?").join(",");
          await db.connection.queryAsync(
            `UPDATE citation_edge SET is_influential = 1
             WHERE source = 'openalex'
               AND from_paper_id = (SELECT id FROM paper WHERE zotero_item_id = ?)
               AND to_paper_id IN (
                 SELECT id FROM paper WHERE LOWER(doi) IN (${placeholders})
               )`,
            [item.id, ...refDois],
          );
        }
        if (citDois.length > 0) {
          const placeholders = citDois.map(() => "?").join(",");
          await db.connection.queryAsync(
            `UPDATE citation_edge SET is_influential = 1
             WHERE source = 'openalex'
               AND to_paper_id = (SELECT id FROM paper WHERE zotero_item_id = ?)
               AND from_paper_id IN (
                 SELECT id FROM paper WHERE LOWER(doi) IN (${placeholders})
               )`,
            [item.id, ...citDois],
          );
        }
      });
      totalInfluentialMarked += refDois.length + citDois.length;
    } catch (err) {
      Zotero.debug(`[Citation Radar] S2 enrichment failed for ${doi}: ${err}`);
      progress.createLine({
        text: `⚠ S2 跳过 ${truncate(doi, 50)}: ${(err as Error).message.slice(0, 80)}`,
        type: "fail",
      });
    }
  }

  progress.changeLine({
    progress: 100,
    text:
      `✓ 完成 ${done}/${itemsWithDoi.length} 篇 · ` +
      `references ${totalReferences} · cited-by ${totalCitedByFetched}/${totalCitedByReal} · ` +
      `influential ${totalInfluentialMarked}`,
    type: "success",
  });
  progress.startCloseTimer(15000);
}

async function upsertPaper(
  conn: any,
  paper: PaperRecord,
): Promise<number> {
  // Try to find existing by openAlexId or DOI
  let existing: number | null = null;
  if (paper.openAlexId) {
    existing = await conn.valueQueryAsync(
      "SELECT id FROM paper WHERE openalex_id = ?",
      [paper.openAlexId],
    );
  }
  if (!existing && paper.doi) {
    existing = await conn.valueQueryAsync(
      "SELECT id FROM paper WHERE doi = ?",
      [paper.doi],
    );
  }

  if (existing) {
    await conn.queryAsync(
      `UPDATE paper SET
        zotero_item_id = COALESCE(?, zotero_item_id),
        doi            = COALESCE(?, doi),
        openalex_id    = COALESCE(?, openalex_id),
        title          = ?,
        year           = COALESCE(?, year),
        authors_json   = ?,
        venue          = COALESCE(?, venue),
        abstract       = COALESCE(?, abstract),
        cited_by_count = COALESCE(?, cited_by_count),
        fetched_at     = ?
       WHERE id = ?`,
      [
        paper.zoteroItemId ?? null,
        paper.doi ?? null,
        paper.openAlexId ?? null,
        paper.title,
        paper.year ?? null,
        JSON.stringify(paper.authors ?? []),
        paper.venue ?? null,
        paper.abstract ?? null,
        paper.citedByCount ?? null,
        paper.fetchedAt,
        existing,
      ],
    );
    return existing;
  }

  await conn.queryAsync(
    `INSERT INTO paper
      (zotero_item_id, doi, openalex_id, title, year, authors_json,
       venue, abstract, cited_by_count, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paper.zoteroItemId ?? null,
      paper.doi ?? null,
      paper.openAlexId ?? null,
      paper.title,
      paper.year ?? null,
      JSON.stringify(paper.authors ?? []),
      paper.venue ?? null,
      paper.abstract ?? null,
      paper.citedByCount ?? null,
      paper.fetchedAt,
    ],
  );
  return await conn.valueQueryAsync("SELECT last_insert_rowid()");
}

function showProgress(text: string, type: "default" | "fail" | "success") {
  new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: 5000,
  })
    .createLine({ text, type, progress: 100 })
    .show();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
