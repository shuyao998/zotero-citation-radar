/**
 * Schema as inline string (embedded into the bundle).
 * Mirrors storage/schema.sql — keep them in sync until the build pipeline
 * supports loading SQL files at runtime from chrome:// URIs.
 *
 * Versioning: bump SCHEMA_VERSION when adding new tables/columns and append
 * an entry to MIGRATIONS in db.ts. Do not edit prior migrations in place.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  zotero_item_id  INTEGER UNIQUE,
  doi             TEXT,
  openalex_id     TEXT,
  s2_id           TEXT,
  title           TEXT NOT NULL,
  year            INTEGER,
  authors_json    TEXT,
  venue           TEXT,
  abstract        TEXT,
  cited_by_count  INTEGER,
  fetched_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paper_doi          ON paper(doi);
CREATE INDEX IF NOT EXISTS idx_paper_openalex     ON paper(openalex_id);
CREATE INDEX IF NOT EXISTS idx_paper_s2           ON paper(s2_id);
CREATE INDEX IF NOT EXISTS idx_paper_zotero_item  ON paper(zotero_item_id);

CREATE TABLE IF NOT EXISTS citation_edge (
  from_paper_id    INTEGER NOT NULL,
  to_paper_id      INTEGER NOT NULL,
  source           TEXT NOT NULL,
  is_influential   INTEGER DEFAULT 0,
  context_snippet  TEXT,
  PRIMARY KEY (from_paper_id, to_paper_id, source),
  FOREIGN KEY (from_paper_id) REFERENCES paper(id) ON DELETE CASCADE,
  FOREIGN KEY (to_paper_id)   REFERENCES paper(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_edge_from  ON citation_edge(from_paper_id);
CREATE INDEX IF NOT EXISTS idx_edge_to    ON citation_edge(to_paper_id);

CREATE TABLE IF NOT EXISTS influence_report (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  paper_id        INTEGER NOT NULL,
  generated_at    INTEGER NOT NULL,
  llm_model       TEXT,
  position_label  TEXT,
  summary_md      TEXT,
  raw_json        TEXT,
  FOREIGN KEY (paper_id) REFERENCES paper(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_paper ON influence_report(paper_id);

CREATE TABLE IF NOT EXISTS faithfulness_check (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  citing_paper_id         INTEGER NOT NULL,
  cited_paper_id          INTEGER,
  claim_text              TEXT NOT NULL,
  claim_location_json     TEXT,
  evidence_text           TEXT,
  evidence_location_json  TEXT,
  verdict                 TEXT NOT NULL,
  llm_reasoning           TEXT,
  llm_model               TEXT,
  generated_at            INTEGER NOT NULL,
  FOREIGN KEY (citing_paper_id) REFERENCES paper(id) ON DELETE CASCADE,
  FOREIGN KEY (cited_paper_id)  REFERENCES paper(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_check_citing ON faithfulness_check(citing_paper_id);
CREATE INDEX IF NOT EXISTS idx_check_cited  ON faithfulness_check(cited_paper_id);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key    TEXT PRIMARY KEY,
  payload      TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_seconds  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_fetched_at ON api_cache(fetched_at);
`;

export interface Migration {
  toVersion: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { toVersion: 1, sql: SCHEMA_V1_SQL },
];
