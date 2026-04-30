/**
 * Local SQLite database for Citation Radar.
 *
 * Uses Zotero's bundled DBConnection — creates a separate file
 * `<Zotero data dir>/citation-radar.sqlite` so we never touch the
 * user's main library DB.
 */

import { MIGRATIONS, SCHEMA_VERSION } from "./sqlSchema";

declare const Zotero: any;

const DB_NAME = "citation-radar";

export class CitationRadarDB {
  private conn: any | null = null;

  async open(): Promise<void> {
    if (this.conn) return;
    this.conn = new Zotero.DBConnection(DB_NAME);
    await this.runMigrations();
  }

  async runMigrations(): Promise<void> {
    if (!this.conn) throw new Error("DB not opened");

    let currentVersion = 0;
    try {
      const result = await this.conn.valueQueryAsync(
        "SELECT MAX(version) FROM schema_version",
      );
      currentVersion = result ?? 0;
    } catch {
      // schema_version table doesn't exist yet — fresh DB
      currentVersion = 0;
    }

    if (currentVersion >= SCHEMA_VERSION) return;

    for (const migration of MIGRATIONS) {
      if (migration.toVersion <= currentVersion) continue;

      await this.conn.executeTransaction(async () => {
        const statements = migration.sql
          .split(";")
          .map((s: string) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          await this.conn.queryAsync(stmt);
        }
        await this.conn.queryAsync(
          "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
          [migration.toVersion, Date.now()],
        );
      });

      Zotero.debug(
        `[Citation Radar] Applied migration to v${migration.toVersion}`,
      );
    }
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.closeDatabase();
      this.conn = null;
    }
  }

  /** Direct access for query implementations. */
  get connection(): any {
    if (!this.conn) throw new Error("DB not opened — call open() first");
    return this.conn;
  }

  /** Convenience: count rows in a table (for sanity tests). */
  async countRows(table: string): Promise<number> {
    const result = await this.connection.valueQueryAsync(
      `SELECT COUNT(*) FROM ${table}`,
    );
    return result ?? 0;
  }
}
