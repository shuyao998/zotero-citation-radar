/**
 * Local SQLite database wrapper.
 * Uses Zotero's bundled DBConnection — creates a separate file
 * `<Zotero data dir>/citation-radar.sqlite` so we never touch the user's
 * main library DB.
 *
 * Schema lives in storage/schema.sql; future migrations under storage/migrations/.
 */

declare const Zotero: any;

export class CitationRadarDB {
  private conn: any | null = null;

  async open(): Promise<void> {
    throw new Error("CitationRadarDB.open: not implemented");
  }

  async runMigrations(): Promise<void> {
    throw new Error("CitationRadarDB.runMigrations: not implemented");
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.closeDatabase();
      this.conn = null;
    }
  }
}
