/**
 * Influence report viewer ("文献定位 / academic positioning").
 *
 * Renders an InfluenceReport into a self-contained HTML page, writes it to
 * the temp directory, and opens it inside Zotero (same chrome wrapper used
 * by the graph viewer).
 *
 * The page intentionally avoids any external assets — markdown is rendered
 * inline by a tiny hand-rolled parser sufficient for the LLM's output
 * shape (paragraphs, headers, lists, bold/italic, inline code, links).
 */

import { writeTempHtml } from "./zoteroWindow";
import type { InfluenceReport, PositionLabel } from "../influence/reportSchema";

export interface ReportViewInput {
  seedTitle: string;
  seedAuthors: string;
  seedYear?: number | null;
  seedDoi?: string | null;
  seedCitedBy?: number | null;
  report: InfluenceReport;
  cached: boolean;
  generatedAt: number;
  llmModel: string;
  promptTokens?: number;
  completionTokens?: number;
}

/** Build the report HTML and write to a temp file; return the absolute path. */
export async function prepareReportTempFile(
  input: ReportViewInput,
): Promise<string> {
  const html = renderReportHtml(input);
  return writeTempHtml(`report-${Date.now()}.html`, html);
}

/** Build a small "report failed" HTML so the report tab still renders something. */
export async function prepareReportErrorTempFile(
  errorMessage: string,
): Promise<string> {
  const safe = errorMessage
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>文献定位（生成失败）</title>
<style>
  body { font-family: system-ui, "Microsoft YaHei", sans-serif; padding: 36px 48px; max-width: 820px; margin: 0 auto; color: #222; line-height: 1.7; }
  h1 { font-size: 20px; color: #C0392B; margin-bottom: 12px; }
  .hint { color: #666; font-size: 13px; margin-bottom: 24px; }
  pre { background: #f5f5f5; padding: 14px 16px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; border-left: 3px solid #C0392B; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e5e5e5; }
    pre { background: #2a2a2a !important; }
    .hint { color: #999 !important; }
  }
</style></head>
<body>
  <h1>文献定位报告生成失败</h1>
  <div class="hint">引文图谱已生成、可正常使用；下方是 LLM 调用的错误详情。</div>
  <pre>${safe}</pre>
</body></html>`;
  return writeTempHtml(`report-error-${Date.now()}.html`, html);
}

// ============================================================================
// HTML rendering

const LABEL_META: Record<
  PositionLabel,
  { zh: string; bg: string; fg: string }
> = {
  seminal: { zh: "开创性", bg: "#F4D03F", fg: "#7D6608" },
  mainstream: { zh: "主流路线", bg: "#5DADE2", fg: "#1B4F72" },
  "follow-up": { zh: "跟随/增量", bg: "#52BE80", fg: "#196F3D" },
  fringe: { zh: "边缘/小众", bg: "#95A5A6", fg: "#34495E" },
  review: { zh: "综述类", bg: "#AF7AC5", fg: "#5B2C6F" },
};

function renderReportHtml(input: ReportViewInput): string {
  const r = input.report;
  const meta = LABEL_META[r.positionLabel];
  const confPct = Math.round(r.positionConfidence * 100);
  const generatedStr = new Date(input.generatedAt).toLocaleString("zh-CN");
  const summaryHtml = renderMarkdown(r.summaryMd || "(模型未返回 summary_md)");

  const ancestorsHtml = renderEvidenceList(r.evidence.keyAncestors, "无");
  const descendantsHtml = renderEvidenceList(r.evidence.keyDescendants, "无");

  const tokenStr =
    input.promptTokens != null && input.completionTokens != null
      ? ` · token ${input.promptTokens} → ${input.completionTokens}`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>文献定位 · ${escapeHtml(truncate(input.seedTitle, 60))}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    line-height: 1.7; color: #222; background: #fafafa;
    padding: 32px 48px; max-width: 920px; margin: 0 auto;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e5e5e5; }
    .card, .verdict { background: #262626 !important; border-color: #3a3a3a !important; }
    .meta-line, .footer-line { color: #999 !important; }
    a { color: #7fb3d5 !important; }
    code { background: #2d2d2d !important; }
    blockquote { border-left-color: #555 !important; color: #bbb !important; }
  }

  header h1 { font-size: 22px; line-height: 1.4; margin: 0 0 6px 0; }
  .meta-line { font-size: 13px; color: #666; margin-bottom: 24px; }

  .verdict {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    background: #fff; padding: 18px 22px; border-radius: 10px;
    border: 1px solid #e0e0e0; margin-bottom: 24px;
  }
  .label-badge {
    display: inline-flex; align-items: baseline; gap: 6px;
    padding: 6px 14px; border-radius: 999px;
    font-weight: 600; font-size: 14px;
  }
  .label-badge .en { font-size: 11px; opacity: 0.75; font-weight: 400; }
  .conf {
    font-size: 13px; color: #666;
    display: inline-flex; align-items: center; gap: 8px;
  }
  .conf-bar {
    width: 100px; height: 6px; background: #eee; border-radius: 3px; overflow: hidden;
  }
  .conf-bar-fill { height: 100%; background: #7d6608; border-radius: 3px; }
  .one-line { font-size: 15px; flex: 1 1 auto; min-width: 240px; }

  h2 { font-size: 16px; margin: 28px 0 12px 0; padding-bottom: 6px; border-bottom: 1px solid #e0e0e0; }
  h3 { font-size: 14px; margin: 18px 0 8px 0; color: #555; }

  .card {
    background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
    padding: 16px 20px; margin-bottom: 18px;
  }
  .markdown-body p { margin: 0 0 12px 0; }
  .markdown-body p:last-child { margin-bottom: 0; }
  .markdown-body ul, .markdown-body ol { margin: 8px 0 12px 0; padding-left: 24px; }
  .markdown-body li { margin-bottom: 4px; }
  .markdown-body code {
    background: #f0f0f0; padding: 1px 5px; border-radius: 3px;
    font-family: ui-monospace, Consolas, monospace; font-size: 13px;
  }
  .markdown-body strong { color: #000; }
  @media (prefers-color-scheme: dark) {
    .markdown-body strong { color: #fff !important; }
  }
  .markdown-body blockquote {
    border-left: 3px solid #ccc; margin: 12px 0; padding: 4px 12px; color: #666;
  }
  .markdown-body a { color: #2874A6; }

  .evidence-list { list-style: none; padding: 0; margin: 0; }
  .evidence-list li {
    padding: 10px 0; border-bottom: 1px solid #eee;
  }
  .evidence-list li:last-child { border-bottom: none; }
  .evidence-list .ev-title { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
  .evidence-list .ev-reason { font-size: 13px; color: #555; }
  .evidence-list .ev-doi { font-size: 12px; margin-top: 3px; }
  .evidence-list .ev-doi a { color: #2874A6; text-decoration: none; }
  .evidence-list .ev-doi a:hover { text-decoration: underline; }
  .evidence-empty { color: #999; font-size: 13px; }

  .lineage { font-size: 13px; color: #555; margin-top: 12px; padding: 10px 14px; background: #f5f5f5; border-radius: 6px; border-left: 3px solid #95A5A6; }
  @media (prefers-color-scheme: dark) {
    .lineage { background: #2a2a2a !important; }
  }

  .caveats { font-size: 13px; }
  .caveats ul { margin: 6px 0 0 0; padding-left: 22px; }
  .caveats li { color: #B7950B; }

  .footer-line {
    font-size: 11px; color: #999; margin-top: 32px; padding-top: 12px;
    border-top: 1px solid #eee; text-align: center;
  }
  .pill {
    display: inline-block; padding: 1px 7px; border-radius: 999px;
    font-size: 10px; background: #eee; color: #555; margin-right: 4px;
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(input.seedTitle)}</h1>
    <div class="meta-line">
      ${escapeHtml(input.seedAuthors)}${input.seedYear ? ` · ${input.seedYear}` : ""}${input.seedCitedBy != null ? ` · cited-by ${input.seedCitedBy}` : ""}${input.seedDoi ? ` · DOI: <a href="https://doi.org/${escapeHtml(input.seedDoi)}" target="_blank" rel="noopener">${escapeHtml(input.seedDoi)}</a>` : ""}
    </div>
  </header>

  <section class="verdict">
    <div class="label-badge" style="background:${meta.bg};color:${meta.fg}">
      ${meta.zh} <span class="en">${escapeHtml(r.positionLabel)}</span>
    </div>
    <div class="conf" title="LLM 自报的判断把握度">
      置信度 ${confPct}%
      <span class="conf-bar"><span class="conf-bar-fill" style="width:${confPct}%;background:${meta.fg}"></span></span>
    </div>
    <div class="one-line">${escapeHtml(r.oneLineVerdict || "(无总结)")}</div>
  </section>

  <h2>分析报告</h2>
  <div class="card markdown-body">${summaryHtml}</div>

  <h2>关键证据</h2>
  <div class="card">
    <h3>关键先驱（它接的传统）</h3>
    ${ancestorsHtml}
    <h3>关键后继（它的影响力体现）</h3>
    ${descendantsHtml}
    ${r.evidence.methodLineage ? `<div class="lineage"><b>方法演进：</b>${escapeHtml(r.evidence.methodLineage)}</div>` : ""}
  </div>

  ${
    r.caveats && r.caveats.length
      ? `<h2>不确定性 / Caveats</h2>
  <div class="card caveats">
    <ul>${r.caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
  </div>`
      : ""
  }

  <div class="footer-line">
    <span class="pill">${input.cached ? "缓存" : "新生成"}</span>
    ${escapeHtml(generatedStr)} · 模型 ${escapeHtml(input.llmModel)}${tokenStr}
  </div>
</body>
</html>`;
}

function renderEvidenceList(
  items: Array<{ doi?: string; title: string; reason: string }>,
  emptyMsg: string,
): string {
  if (!items || items.length === 0) {
    return `<div class="evidence-empty">${escapeHtml(emptyMsg)}</div>`;
  }
  return (
    '<ul class="evidence-list">' +
    items
      .map((it) => {
        const doiHtml = it.doi
          ? `<div class="ev-doi"><a href="https://doi.org/${escapeHtml(it.doi)}" target="_blank" rel="noopener">DOI: ${escapeHtml(it.doi)}</a></div>`
          : "";
        return `<li>
          <div class="ev-title">${escapeHtml(it.title)}</div>
          <div class="ev-reason">${escapeHtml(it.reason)}</div>
          ${doiHtml}
        </li>`;
      })
      .join("") +
    "</ul>"
  );
}

// ============================================================================
// Tiny markdown renderer.
// Supports: headers (## / ###), paragraphs, lists (-, *, 1.), bold (**), italic (*),
// inline code (`...`), links [text](url), blockquotes (>).
// Anything else is escaped as plain text — keeps the surface area small and
// the output predictable for our LLM output.

function renderMarkdown(md: string): string {
  // Normalize line endings, trim trailing whitespace per line.
  const lines = md.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));

  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Blank line: skip
    if (line.trim() === "") { i++; continue; }

    // Header
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = Math.min(6, headerMatch[1].length + 2); // h1 reserved → start at h3
      blocks.push(`<h${level}>${renderInline(headerMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Paragraph: gather consecutive non-blank lines that aren't a block start
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[-*]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].startsWith(">")
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      blocks.push(`<p>${renderInline(para.join(" "))}</p>`);
    }
  }

  return blocks.join("\n");
}

/** Inline markdown: **bold**, *italic*, `code`, [text](url). Escapes HTML first. */
function renderInline(s: string): string {
  let out = escapeHtml(s);

  // Code first (so its content isn't bolded)
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold (must come before italic since ** would partially match *)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Italic
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  // Links [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
