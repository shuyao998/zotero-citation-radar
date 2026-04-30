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
import { getServices } from "../lifecycle";
import { getPref } from "../../utils/prefs";
import type { PaperRecord } from "../citationGraph/types";

declare const Zotero: any;

export function registerMenuItems(): void {
  const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;

  ztoolkit.Menu.register("item", { tag: "menuseparator" });

  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: `${config.addonRef}-fetch-openalex`,
    label: "Citation Radar：从 OpenAlex 抓取引文",
    commandListener: () => {
      void onFetchFromOpenAlex();
    },
    icon: menuIcon,
  });
}

async function onFetchFromOpenAlex(): Promise<void> {
  const apiKey = getPref("openAlexApiKey") as string;
  if (!apiKey) {
    showProgress(
      "请先在 设置 → Citation Radar 填入 OpenAlex API key",
      "fail",
    );
    return;
  }

  const items = ztoolkit.getGlobal("ZoteroPane").getSelectedItems();
  const itemsWithDoi = items.filter(
    (it) => it.isRegularItem() && !!it.getField("DOI"),
  );

  if (itemsWithDoi.length === 0) {
    showProgress("选中的条目没有 DOI", "fail");
    return;
  }

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

  let done = 0;
  let totalReferences = 0;

  for (const item of itemsWithDoi) {
    const doi = item.getField("DOI");
    try {
      const paper = await client.getWorkByDoi(doi);
      paper.zoteroItemId = item.id;

      const paperId = await upsertPaper(db.connection, paper);

      const refs = paper.openAlexId
        ? await client.getReferences(paper.openAlexId)
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
      });

      totalReferences += refs.length;
      done += 1;
      progress.changeLine({
        progress: Math.round((done / itemsWithDoi.length) * 100),
        text: `[${done}/${itemsWithDoi.length}] ${truncate(paper.title, 50)} (${refs.length} 引用)`,
      });
    } catch (err) {
      Zotero.debug(`[Citation Radar] Fetch failed for DOI ${doi}: ${err}`);
      progress.createLine({
        text: `❌ ${truncate(doi, 60)}: ${(err as Error).message.slice(0, 100)}`,
        type: "fail",
      });
    }
  }

  progress.changeLine({
    progress: 100,
    text: `✓ 抓取完成 ${done}/${itemsWithDoi.length} 篇，共 ${totalReferences} 条引用`,
    type: "success",
  });
  progress.startCloseTimer(8000);
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
