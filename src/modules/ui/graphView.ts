/**
 * Citation graph viewer.
 *
 * Reads the seed paper's local citation graph (references + cited-by) from
 * SQLite, renders an interactive vis-network HTML, writes it to a temp file,
 * and returns the path. The caller (menu.ts) then hands the path to the
 * unified Zotero chrome window which hosts the file in a tabbed iframe.
 *
 * Layout choices:
 *   - Seed paper: large gold node at center
 *   - References (this paper cites): blue, positioned upward
 *   - Cited-by (papers citing this): green, positioned downward
 *   - Node size scales with log(cited_by_count + 1) so visual mass = influence
 */

import { config } from "../../../package.json";
import { getServices } from "../lifecycle";
import { writeTempHtml } from "./zoteroWindow";

declare const Zotero: any;

// All locally-stored references and cited-by are shown in the graph.
// Upstream cap (citedByMaxResults pref) controls how much enters the DB;
// the viewer renders whatever's there.

interface NodeRow {
  id: number;
  title: string;
  year: number | null;
  authors_json: string | null;
  doi: string | null;
  cited_by_count: number | null;
  is_influential: number | null; // 1 if S2 flagged the connecting edge
}

export interface PreparedGraph {
  filePath: string;
  seedTitle: string;
  seedRow: NodeRow;
}

/**
 * Build the citation-graph HTML for `zoteroItemId` and write it to a temp
 * file. Returns the file path + seed metadata so the caller can title the
 * window and combine with other tabs.
 */
export async function prepareGraphTempFile(
  zoteroItemId: number,
  fallbackTitle: string,
): Promise<PreparedGraph> {
  const { db } = getServices();
  const conn = db.connection;

  const seedRow: NodeRow | null = await conn.rowQueryAsync(
    `SELECT id, title, year, authors_json, doi, cited_by_count
     FROM paper WHERE zotero_item_id = ?`,
    [zoteroItemId],
  );
  if (!seedRow) {
    throw new Error(
      "本地数据库还没有这条目的引文记录，请先抓取一次",
    );
  }

  const refs: NodeRow[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.doi, p.cited_by_count,
            e.is_influential
     FROM citation_edge e JOIN paper p ON e.to_paper_id = p.id
     WHERE e.from_paper_id = ? AND e.source = 'openalex'
     ORDER BY e.is_influential DESC, COALESCE(p.cited_by_count, 0) DESC`,
    [seedRow.id],
  );

  const citedBy: NodeRow[] = await conn.queryAsync(
    `SELECT p.id, p.title, p.year, p.authors_json, p.doi, p.cited_by_count,
            e.is_influential
     FROM citation_edge e JOIN paper p ON e.from_paper_id = p.id
     WHERE e.to_paper_id = ? AND e.source = 'openalex'
     ORDER BY e.is_influential DESC, COALESCE(p.cited_by_count, 0) DESC`,
    [seedRow.id],
  );

  const totalRefs: number = await conn.valueQueryAsync(
    `SELECT COUNT(*) FROM citation_edge WHERE from_paper_id = ?`,
    [seedRow.id],
  );
  const totalCitedByLocal: number = await conn.valueQueryAsync(
    `SELECT COUNT(*) FROM citation_edge WHERE to_paper_id = ?`,
    [seedRow.id],
  );

  const visJs = await loadBundledVisNetwork();

  const html = renderHtml({
    seed: seedRow,
    refs,
    citedBy,
    totalRefs,
    totalCitedByLocal,
    totalCitedByReal: seedRow.cited_by_count ?? totalCitedByLocal,
    fallbackTitle,
    visJs,
  });

  const filePath = await writeTempHtml(
    `graph-${seedRow.id}-${Date.now()}.html`,
    html,
  );

  return {
    filePath,
    seedTitle: seedRow.title || fallbackTitle,
    seedRow,
  };
}

async function loadBundledVisNetwork(): Promise<string> {
  const url = `chrome://${config.addonRef}/content/vendor/vis-network.min.js`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Failed to load bundled vis-network.min.js (status ${resp.status}). ` +
        `Did the asset ship in the xpi? Expected at ${url}`,
    );
  }
  return await resp.text();
}

interface RenderInput {
  seed: NodeRow;
  refs: NodeRow[];
  citedBy: NodeRow[];
  totalRefs: number;
  totalCitedByLocal: number;
  totalCitedByReal: number;
  fallbackTitle: string;
  visJs: string;
}

function renderHtml(input: RenderInput): string {
  const seedTitle = input.seed.title || input.fallbackTitle;
  const seedAuthors = formatAuthors(input.seed.authors_json);

  // Seed gets a fixed prominent size; everyone else scales by log10(cited_by).
  const SEED_SIZE = 42;
  const sizeFor = (cited: number | null): number => {
    const c = cited ?? 0;
    return Math.max(9, Math.min(40, 9 + Math.log10(c + 1) * 7.5));
  };

  // Color scheme.
  const SEED_COLOR = { background: "#F4D03F", border: "#B7950B" };
  const REF_COLOR = { background: "#5DADE2", border: "#1F618D" };
  const CITED_COLOR = { background: "#52BE80", border: "#196F3D" };
  const REF_EDGE = "#3498DB";
  const CITED_EDGE = "#27AE60";

  // S2-flagged influential edges/nodes: red border + thicker edge.
  const INF_BORDER = "#C0392B";
  const INF_EDGE = "#E74C3C";

  const refsInfluentialCount = input.refs.filter((p) => p.is_influential).length;
  const citedInfluentialCount = input.citedBy.filter((p) => p.is_influential).length;

  // Top-5 most-cited papers across refs + citedBy (excluding the seed itself).
  // These get bold title / first-author / cited-by in the sidebar to draw the
  // eye to the highest-impact neighbors.
  const top5Ids = new Set<number>(
    [...input.refs, ...input.citedBy]
      .slice()
      .sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0))
      .slice(0, 5)
      .map((p) => p.id),
  );

  // X positions are fixed per column (refs left / seed center / cited right);
  // Y is left for physics to settle organically — gives a natural look without
  // sacrificing the left-to-right "influence flow" semantic.
  const COL_X = { ref: -480, seed: 0, cited: 480 };
  const yJitter = (i: number, n: number, range: number): number =>
    n <= 1 ? 0 : ((i - (n - 1) / 2) / Math.max(1, n - 1)) * range;

  const nodes = [
    {
      id: input.seed.id,
      label: truncateLabel(seedTitle, 36),
      title: tooltipFor(input.seed),
      shape: "dot",
      size: SEED_SIZE,
      color: SEED_COLOR,
      font: { size: 16, face: "system-ui", color: "#222", strokeWidth: 4, strokeColor: "#fff" },
      x: COL_X.seed,
      y: 0,
      fixed: { x: true, y: true },
    },
    ...input.refs.map((p, i) => ({
      id: p.id,
      label: truncateLabel(p.title || "(untitled)", 28),
      title: tooltipFor(p),
      shape: "dot",
      size: sizeFor(p.cited_by_count),
      color: p.is_influential
        ? { background: REF_COLOR.background, border: INF_BORDER }
        : REF_COLOR,
      borderWidth: p.is_influential ? 4 : 2,
      font: { size: 11, face: "system-ui", color: p.is_influential ? "#922B21" : "#1F618D", strokeWidth: 3, strokeColor: "#fff" },
      x: COL_X.ref,
      y: yJitter(i, input.refs.length, 700),
      fixed: { x: true, y: false },
    })),
    ...input.citedBy.map((p, i) => ({
      id: p.id,
      label: truncateLabel(p.title || "(untitled)", 28),
      title: tooltipFor(p),
      shape: "dot",
      size: sizeFor(p.cited_by_count),
      color: p.is_influential
        ? { background: CITED_COLOR.background, border: INF_BORDER }
        : CITED_COLOR,
      borderWidth: p.is_influential ? 4 : 2,
      font: { size: 11, face: "system-ui", color: p.is_influential ? "#922B21" : "#196F3D", strokeWidth: 3, strokeColor: "#fff" },
      x: COL_X.cited,
      y: yJitter(i, input.citedBy.length, 500),
      fixed: { x: true, y: false },
    })),
  ];

  // Edges drawn in TIME-FLOW direction (older → newer, always rightward):
  //   ref(left)  →  seed(middle)  →  citedBy(right)
  // This is the *reverse* of citation direction in the underlying DB
  // (DB stores "X cites Y" as from=X,to=Y; here we show "X influences Y").
  const edges = [
    ...input.refs.map((p) => ({
      from: p.id,
      to: input.seed.id,
      arrows: "to",
      width: p.is_influential ? 2.5 : 1.2,
      color: {
        color: p.is_influential ? INF_EDGE : REF_EDGE,
        opacity: p.is_influential ? 0.85 : 0.55,
      },
    })),
    ...input.citedBy.map((p) => ({
      from: input.seed.id,
      to: p.id,
      arrows: "to",
      width: p.is_influential ? 2.5 : 1.2,
      color: {
        color: p.is_influential ? INF_EDGE : CITED_EDGE,
        opacity: p.is_influential ? 0.85 : 0.55,
      },
    })),
  ];

  // Unified paper list for the searchable / selectable HTML side panel.
  // Vis-network paints labels onto <canvas>, which is non-selectable; this
  // sidebar is the user's escape hatch for copy-paste, search, and DOI clicks.
  type PaperType = "seed" | "ref" | "cited";
  const seedSplit = splitAuthors(input.seed.authors_json);
  const paperList: Array<{
    id: number;
    title: string;
    firstAuthor: string;
    restAuthors: string;
    year: number | null;
    doi: string | null;
    citedBy: number | null;
    type: PaperType;
    influential: boolean;
    topCited: boolean;
  }> = [
    {
      id: input.seed.id,
      title: input.seed.title,
      firstAuthor: seedSplit.first,
      restAuthors: seedSplit.rest,
      year: input.seed.year,
      doi: input.seed.doi,
      citedBy: input.seed.cited_by_count,
      type: "seed" as PaperType,
      influential: false,
      topCited: false,
    },
    ...input.refs.map((p) => {
      const split = splitAuthors(p.authors_json);
      return {
        id: p.id,
        title: p.title,
        firstAuthor: split.first,
        restAuthors: split.rest,
        year: p.year,
        doi: p.doi,
        citedBy: p.cited_by_count,
        type: "ref" as PaperType,
        influential: !!p.is_influential,
        topCited: top5Ids.has(p.id),
      };
    }),
    ...input.citedBy.map((p) => {
      const split = splitAuthors(p.authors_json);
      return {
        id: p.id,
        title: p.title,
        firstAuthor: split.first,
        restAuthors: split.rest,
        year: p.year,
        doi: p.doi,
        citedBy: p.cited_by_count,
        type: "cited" as PaperType,
        influential: !!p.is_influential,
        topCited: top5Ids.has(p.id),
      };
    }),
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
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  body { display: flex; flex-direction: column; background: #fafafa; color: #222; }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #e5e5e5; }
    .meta-panel, .list-panel { background: #262626 !important; border-color: #3a3a3a !important; }
    .legend-chip { background: #2d2d2d !important; }
    #graph { background: #1f1f1f !important; }
    .row { background: #2a2a2a !important; }
    .row:hover { background: #353535 !important; }
    .row.active { background: #3d4a3a !important; }
    #search { background: #2a2a2a !important; color: #e5e5e5 !important; border-color: #444 !important; }
    a { color: #7fb3d5 !important; }
  }
  .meta-panel { flex: 0 0 auto; padding: 14px 22px; background: #fff; border-bottom: 1px solid #ddd; }
  .meta-panel h1 { font-size: 16px; margin: 0 0 6px 0; line-height: 1.4; }
  .meta-panel .sub { font-size: 12px; color: #666; margin-bottom: 10px; }
  .stats { display: flex; gap: 18px; font-size: 13px; flex-wrap: wrap; }
  .stats span b { font-size: 15px; color: #B8860B; }
  .legend { display: flex; gap: 12px; font-size: 12px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  .legend-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; background: #f5f5f5; border-radius: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: 0 0 auto; }

  .content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: row; }
  #graph { flex: 1 1 60%; min-width: 0; min-height: 0; background: #fbfbfb; position: relative; }
  #error-banner { display: none; position: absolute; top: 8px; left: 8px; right: 8px; padding: 12px; background: #ffe6e6; color: #900; border: 1px solid #c66; border-radius: 4px; font-family: monospace; font-size: 13px; white-space: pre-wrap; z-index: 1000; }

  .list-panel { flex: 0 0 380px; display: flex; flex-direction: column; background: #fff; border-left: 1px solid #ddd; min-height: 0; }
  .list-header { flex: 0 0 auto; padding: 10px 14px; border-bottom: 1px solid #eee; }
  #search { width: 100%; padding: 7px 10px; font-size: 13px; border: 1px solid #ccc; border-radius: 4px; background: #fff; color: #222; }
  #search:focus { outline: none; border-color: #5DADE2; }
  .count-line { font-size: 11px; color: #888; margin-top: 6px; }
  .row-list { flex: 1 1 auto; overflow-y: auto; padding: 4px 8px; }
  .row { display: flex; gap: 8px; padding: 9px 10px; margin: 4px 0; border-radius: 6px; background: #f7f9fa; cursor: pointer; align-items: flex-start; transition: background .15s; }
  .row:hover { background: #eaf2fa; }
  .row.active { background: #fff4d6; outline: 2px solid #B7950B; }
  .row .body { flex: 1 1 auto; min-width: 0; }
  .row .title { font-size: 13px; line-height: 1.35; word-break: break-word; }
  .row .meta { font-size: 11px; color: #666; margin-top: 3px; word-break: break-word; }
  .row .doi a { color: #2874A6; text-decoration: none; }
  .row .doi a:hover { text-decoration: underline; }
  .row.hidden { display: none; }
  .row.influential { border-left: 3px solid #C0392B; }
  .inf-badge { display: inline-block; background: #C0392B; color: #fff; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>
  <div class="meta-panel">
    <h1>${escapeHtml(meta.seedTitle)}</h1>
    <div class="sub">${escapeHtml(meta.seedAuthors)} · ${meta.seedYear}${meta.seedDoi ? ` · DOI: ${escapeHtml(meta.seedDoi)}` : ""}</div>
    <div class="stats">
      <span title="本文引用的文献数（图中已全部展示）">引用：<b>${meta.refsShown}</b>${refsInfluentialCount ? ` · <span style="color:#C0392B">关键 ${refsInfluentialCount}</span>` : ""}</span>
      <span title="本地已抓取的被引数 / OpenAlex 报告的真实被引数。两者不一致 = 受 citedByMaxResults 上限限制">被引：本地 <b>${meta.citedByLocal}</b> · 真实 ${meta.citedByReal}${meta.citedByLocal < meta.citedByReal ? `（缺 ${meta.citedByReal - meta.citedByLocal}）` : ""}${citedInfluentialCount ? ` · <span style="color:#C0392B">关键 ${citedInfluentialCount}</span>` : ""}</span>
    </div>
    <div class="legend">
      <span class="legend-chip"><span class="dot" style="background:#5DADE2"></span>← 它引用的（${meta.refsShown}，左侧）</span>
      <span class="legend-chip"><span class="dot" style="background:#F4D03F"></span>种子论文（中间）</span>
      <span class="legend-chip"><span class="dot" style="background:#52BE80"></span>引用它的（${meta.citedByLocal}，右侧）→</span>
      <span class="legend-chip"><span class="dot" style="background:#fff;border:3px solid #C0392B"></span>S2 关键引用（红边 + 红线）</span>
      <span class="legend-chip">节点大小 ∝ log(cited_by_count) · 箭头方向 = 影响力流向（旧→新）</span>
    </div>
  </div>
  <div class="content">
    <div id="graph">
      <div id="error-banner"></div>
    </div>
    <aside class="list-panel">
      <div class="list-header">
        <input id="search" type="text" placeholder="搜索标题、作者、DOI..." />
        <div class="count-line"><span id="count-shown">${paperList.length}</span> / ${paperList.length} 条</div>
      </div>
      <div class="row-list" id="row-list">
        ${paperList
          .map((p) => {
            const titleEsc = escapeHtml(p.title || "(untitled)");
            const titleHtml = p.topCited ? `<b>${titleEsc}</b>` : titleEsc;
            const firstEsc = escapeHtml(p.firstAuthor);
            const firstHtml = p.topCited ? `<b>${firstEsc}</b>` : firstEsc;
            const citedTxt = `cited-by ${p.citedBy ?? "?"}`;
            const citedHtml = p.topCited ? `<b>${citedTxt}</b>` : citedTxt;
            const cls = `row${p.influential ? " influential" : ""}${p.topCited ? " top-cited" : ""}`;
            const dotStyle = `background: ${p.type === "seed" ? "#F4D03F" : p.type === "ref" ? "#5DADE2" : "#52BE80"}; margin-top: 5px; ${p.influential ? "border: 2px solid #C0392B; box-sizing: border-box;" : ""}`;
            return `<div class="${cls}" data-paper-id="${p.id}" data-type="${p.type}">
          <span class="dot" style="${dotStyle}"></span>
          <div class="body">
            <div class="title">${p.influential ? '<span class="inf-badge">关键</span> ' : ""}${titleHtml}</div>
            <div class="meta">${firstHtml}${escapeHtml(p.restAuthors)} · ${p.year ?? "?"} · ${citedHtml}</div>
            ${p.doi ? `<div class="meta doi">DOI: <a href="https://doi.org/${escapeHtml(p.doi)}" target="_blank" rel="noopener">${escapeHtml(p.doi)}</a></div>` : ""}
          </div>
        </div>`;
          })
          .join("")}
      </div>
    </aside>
  </div>

<script>
${input.visJs}
</script>

<script>
(function() {
  const errEl = document.getElementById('error-banner');
  const showError = (msg) => {
    console.error('[CitationRadar]', msg);
    errEl.style.display = 'block';
    errEl.textContent = msg;
  };
  window.addEventListener('error', (e) => {
    showError('Runtime error: ' + (e.error?.stack || e.message));
  });

  try {
    if (typeof vis === 'undefined' || !vis.Network) {
      throw new Error('vis-network failed to load. typeof vis = ' + typeof vis);
    }
    console.log('[CitationRadar] vis-network OK');

    const nodes = new vis.DataSet(${JSON.stringify(nodes)});
    const edges = new vis.DataSet(${JSON.stringify(edges)});
    console.log('[CitationRadar] DataSets built. nodes=' + nodes.length + ' edges=' + edges.length);

    const container = document.getElementById('graph');
    const network = new vis.Network(
      container,
      { nodes: nodes, edges: edges },
      {
        autoResize: true,
        layout: { hierarchical: { enabled: false }, randomSeed: 42 },
        physics: {
          enabled: true,
          solver: 'barnesHut',
          barnesHut: {
            gravitationalConstant: -800,
            centralGravity: 0,
            springLength: 120,
            springConstant: 0.02,
            damping: 0.4,
            avoidOverlap: 0.6
          },
          stabilization: { enabled: true, iterations: 250, fit: true },
          timestep: 0.4,
          adaptiveTimestep: true
        },
        nodes: { borderWidth: 2 },
        edges: {
          width: 1.2,
          smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.35 }
        },
        interaction: { hover: true, tooltipDelay: 120, navigationButtons: true, keyboard: true, dragNodes: true, dragView: true, zoomView: true }
      }
    );
    console.log('[CitationRadar] Network instance created');

    network.once('afterDrawing', () => {
      console.log('[CitationRadar] First draw complete');
      network.fit({ animation: false });
    });

    // Once physics has settled: freeze the engine AND unlock per-node fixed
    // constraints so the user can drag any node anywhere without it snapping
    // back. Initial column layout is preserved by the positions physics just
    // computed; from this point on, the graph is purely manual.
    network.once('stabilizationIterationsDone', () => {
      console.log('[CitationRadar] Stabilization done — freezing physics + unlocking drag');
      network.setOptions({ physics: { enabled: false } });
      const allIds = nodes.getIds();
      const updates = allIds.map(id => ({ id: id, fixed: false }));
      nodes.update(updates);
    });

    network.on('doubleClick', (params) => {
      if (params.nodes.length === 0) return;
      const node = nodes.get(params.nodes[0]);
      if (node && node.title) {
        const doiMatch = node.title.match(/DOI: (\\S+)/);
        if (doiMatch) window.open('https://doi.org/' + doiMatch[1], '_blank');
      }
    });

    // === Sidebar list interactions ===
    const rowsContainer = document.getElementById('row-list');
    const searchInput = document.getElementById('search');
    const countEl = document.getElementById('count-shown');
    const allRows = Array.from(rowsContainer.querySelectorAll('.row'));

    // Click row → focus that node in the graph + mark active
    rowsContainer.addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      // Don't intercept clicks on links inside the row
      if (e.target.tagName === 'A') return;
      const id = Number(row.dataset.paperId);
      allRows.forEach(r => r.classList.toggle('active', r === row));
      try {
        network.selectNodes([id], false);
        network.focus(id, { scale: 1.3, animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
      } catch (err) {
        console.warn('[CitationRadar] focus failed:', err);
      }
    });

    // Click node in graph → highlight + scroll to corresponding row
    network.on('click', (params) => {
      if (params.nodes.length === 0) {
        allRows.forEach(r => r.classList.remove('active'));
        return;
      }
      const id = params.nodes[0];
      const row = rowsContainer.querySelector('.row[data-paper-id="' + id + '"]');
      if (!row) return;
      allRows.forEach(r => r.classList.toggle('active', r === row));
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Search box → filter rows
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      let shown = 0;
      for (const row of allRows) {
        const text = row.textContent.toLowerCase();
        const match = !q || text.includes(q);
        row.classList.toggle('hidden', !match);
        if (match) shown++;
      }
      countEl.textContent = String(shown);
    });
  } catch (e) {
    showError('Init failed: ' + (e.stack || e.message));
  }
})();
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

function splitAuthors(authorsJson: string | null): {
  first: string;
  rest: string;
} {
  if (!authorsJson) return { first: "(unknown authors)", rest: "" };
  try {
    const arr = JSON.parse(authorsJson) as Array<{ name?: string }>;
    if (!arr.length) return { first: "(unknown authors)", rest: "" };
    const first = arr[0].name ?? "?";
    if (arr.length === 1) return { first, rest: "" };
    if (arr.length <= 3) {
      const rest =
        ", " + arr.slice(1).map((a) => a.name ?? "?").join(", ");
      return { first, rest };
    }
    const rest =
      ", " +
      arr.slice(1, 3).map((a) => a.name ?? "?").join(", ") +
      ` 等 ${arr.length} 人`;
    return { first, rest };
  } catch {
    return { first: "(unknown authors)", rest: "" };
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
