/**
 * Citation graph viewer.
 *
 * Reads the seed paper's local citation graph (references + cited-by) from
 * SQLite, renders an interactive vis-network HTML, writes it to the temp
 * directory, and opens it in the user's default browser.
 *
 * Layout choices:
 *   - Seed paper: large gold node at center
 *   - References (this paper cites): blue, positioned upward
 *   - Cited-by (papers citing this): green, positioned downward
 *   - Node size scales with log(cited_by_count + 1) so visual mass = influence
 *   - Top-N filtering by cited_by_count keeps the graph readable for highly
 *     cited papers (NumPy → 14k cited-by would be unrenderable raw)
 */

import { getServices } from "../lifecycle";

declare const Zotero: any;
declare const IOUtils: any;
declare const PathUtils: any;

const TOP_N_REFS = 50;
const TOP_N_CITED_BY = 50;

interface NodeRow {
  id: number;
  title: string;
  year: number | null;
  authors_json: string | null;
  doi: string | null;
  cited_by_count: number | null;
}

export async function openCitationGraph(
  zoteroItemId: number,
  fallbackTitle: string,
): Promise<void> {
  const { db } = getServices();
  const conn = db.connection;

  const seedRow: NodeRow | null = await conn.rowQueryAsync(
    `SELECT id, title, year, authors_json, doi, cited_by_count
     FROM paper WHERE zotero_item_id = ?`,
    [zoteroItemId],
  );
  if (!seedRow) {
    throw new Error(
      "本地数据库还没有这条目的引文记录，请先用「从 OpenAlex 抓取引文」",
    );
  }

  const refs: NodeRow[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.doi, p.cited_by_count
     FROM citation_edge e JOIN paper p ON e.to_paper_id = p.id
     WHERE e.from_paper_id = ? AND e.source = 'openalex'
     ORDER BY COALESCE(p.cited_by_count, 0) DESC
     LIMIT ?`,
    [seedRow.id, TOP_N_REFS],
  );

  const citedBy: NodeRow[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.doi, p.cited_by_count
     FROM citation_edge e JOIN paper p ON e.from_paper_id = p.id
     WHERE e.to_paper_id = ? AND e.source = 'openalex'
     ORDER BY COALESCE(p.cited_by_count, 0) DESC
     LIMIT ?`,
    [seedRow.id, TOP_N_CITED_BY],
  );

  const totalRefs: number = await conn.valueQueryAsync(
    `SELECT COUNT(*) FROM citation_edge WHERE from_paper_id = ?`,
    [seedRow.id],
  );
  const totalCitedByLocal: number = await conn.valueQueryAsync(
    `SELECT COUNT(*) FROM citation_edge WHERE to_paper_id = ?`,
    [seedRow.id],
  );

  const html = renderHtml({
    seed: seedRow,
    refs,
    citedBy,
    totalRefs,
    totalCitedByLocal,
    totalCitedByReal: seedRow.cited_by_count ?? totalCitedByLocal,
    fallbackTitle,
  });

  const tempDir = PathUtils.join(
    Zotero.getTempDirectory().path,
    "citation-radar",
  );
  await IOUtils.makeDirectory(tempDir, { ignoreExisting: true });

  const outFile = PathUtils.join(
    tempDir,
    `graph-${seedRow.id}-${Date.now()}.html`,
  );
  await IOUtils.writeUTF8(outFile, html);

  Zotero.launchFile(outFile);
}

interface RenderInput {
  seed: NodeRow;
  refs: NodeRow[];
  citedBy: NodeRow[];
  totalRefs: number;
  totalCitedByLocal: number;
  totalCitedByReal: number;
  fallbackTitle: string;
}

function renderHtml(input: RenderInput): string {
  const seedTitle = input.seed.title || input.fallbackTitle;
  const seedAuthors = formatAuthors(input.seed.authors_json);

  const SEED_SIZE = 36;
  const sizeFor = (cited: number | null): number => {
    const c = cited ?? 0;
    return Math.max(8, Math.min(28, 8 + Math.log10(c + 1) * 6));
  };

  const nodes = [
    {
      id: input.seed.id,
      label: truncateLabel(seedTitle, 40),
      title: tooltipFor(input.seed),
      shape: "dot",
      size: SEED_SIZE,
      color: { background: "#FFD166", border: "#B8860B" },
      font: { size: 16, face: "system-ui" },
      group: "seed",
    },
    ...input.refs.map((p) => ({
      id: p.id,
      label: truncateLabel(p.title || "(untitled)", 32),
      title: tooltipFor(p),
      shape: "dot",
      size: sizeFor(p.cited_by_count),
      color: { background: "#7FB3D5", border: "#21618C" },
      group: "ref",
    })),
    ...input.citedBy.map((p) => ({
      id: p.id,
      label: truncateLabel(p.title || "(untitled)", 32),
      title: tooltipFor(p),
      shape: "dot",
      size: sizeFor(p.cited_by_count),
      color: { background: "#82E0AA", border: "#1E8449" },
      group: "citedBy",
    })),
  ];

  const edges = [
    ...input.refs.map((p) => ({
      from: input.seed.id,
      to: p.id,
      arrows: "to",
      color: { color: "#5DADE2", opacity: 0.5 },
    })),
    ...input.citedBy.map((p) => ({
      from: p.id,
      to: input.seed.id,
      arrows: "to",
      color: { color: "#58D68D", opacity: 0.5 },
    })),
  ];

  const meta = {
    seedTitle,
    seedAuthors,
    seedYear: input.seed.year ?? "?",
    seedDoi: input.seed.doi ?? "",
    refsShown: input.refs.length,
    refsTotal: input.totalRefs,
    citedByShown: input.citedBy.length,
    citedByLocal: input.totalCitedByLocal,
    citedByReal: input.totalCitedByReal,
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>引文图谱 · ${escapeHtml(truncateLabel(seedTitle, 60))}</title>
<script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  body { display: grid; grid-template-rows: auto 1fr; background: #fafafa; color: #222; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e5e5e5; }
    .meta-panel { background: #262626 !important; border-color: #3a3a3a !important; }
    .legend-chip { background: #2d2d2d !important; }
  }
  .meta-panel { padding: 14px 22px; background: #fff; border-bottom: 1px solid #ddd; }
  .meta-panel h1 { font-size: 16px; margin: 0 0 6px 0; line-height: 1.4; }
  .meta-panel .sub { font-size: 12px; color: #666; margin-bottom: 10px; }
  .stats { display: flex; gap: 18px; font-size: 13px; flex-wrap: wrap; }
  .stats span b { font-size: 15px; color: #B8860B; }
  .legend { display: flex; gap: 12px; font-size: 12px; align-items: center; margin-top: 8px; }
  .legend-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; background: #f5f5f5; border-radius: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  #graph { width: 100%; height: 100%; }
</style>
</head>
<body>
  <div class="meta-panel">
    <h1>${escapeHtml(meta.seedTitle)}</h1>
    <div class="sub">${escapeHtml(meta.seedAuthors)} · ${meta.seedYear}${meta.seedDoi ? ` · DOI: ${escapeHtml(meta.seedDoi)}` : ""}</div>
    <div class="stats">
      <span>引用：<b>${meta.refsShown}</b> / ${meta.refsTotal}（图中显示 / 本地存储）</span>
      <span>被引：<b>${meta.citedByShown}</b> / ${meta.citedByLocal} / ${meta.citedByReal}（图中 / 本地 / 真实）</span>
    </div>
    <div class="legend">
      <span class="legend-chip"><span class="dot" style="background:#FFD166"></span>种子论文</span>
      <span class="legend-chip"><span class="dot" style="background:#7FB3D5"></span>它引用的（${meta.refsShown}）</span>
      <span class="legend-chip"><span class="dot" style="background:#82E0AA"></span>引用它的（${meta.citedByShown}）</span>
      <span class="legend-chip">节点大小 ∝ log(cited_by_count)</span>
    </div>
  </div>
  <div id="graph"></div>
<script>
  const nodes = new vis.DataSet(${JSON.stringify(nodes)});
  const edges = new vis.DataSet(${JSON.stringify(edges)});
  const network = new vis.Network(
    document.getElementById('graph'),
    { nodes, edges },
    {
      physics: {
        forceAtlas2Based: { gravitationalConstant: -45, centralGravity: 0.005, springLength: 130, damping: 0.9 },
        solver: 'forceAtlas2Based',
        stabilization: { iterations: 250 }
      },
      nodes: { borderWidth: 2, font: { face: 'system-ui', size: 12 } },
      edges: { width: 1, smooth: { type: 'continuous' } },
      interaction: { hover: true, tooltipDelay: 120, navigationButtons: true }
    }
  );
  network.on('doubleClick', (params) => {
    if (params.nodes.length === 0) return;
    const node = nodes.get(params.nodes[0]);
    if (node && node.title) {
      const doiMatch = node.title.match(/DOI: (\\S+)/);
      if (doiMatch) window.open('https://doi.org/' + doiMatch[1], '_blank');
    }
  });
</script>
</body>
</html>`;
}

function formatAuthors(authorsJson: string | null): string {
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

function tooltipFor(p: NodeRow): string {
  const authors = formatAuthors(p.authors_json);
  const lines = [
    p.title || "(untitled)",
    `${authors} (${p.year ?? "?"})`,
    `Cited by: ${p.cited_by_count ?? "?"}`,
  ];
  if (p.doi) lines.push(`DOI: ${p.doi}`);
  return lines.join("\n");
}

function truncateLabel(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
