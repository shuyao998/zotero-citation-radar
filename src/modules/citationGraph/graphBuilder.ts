/**
 * Merges multi-source citation data (OpenAlex + Semantic Scholar + ...) into
 * the local SQLite graph. Resolves the same paper across sources by DOI first,
 * then by (title, year, first-author) fuzzy match.
 */

import type { PaperWithEdges } from "./types";

export class GraphBuilder {
  /** Build (or refresh) the local graph for a single seed paper. */
  async buildForPaper(_seedDoi: string): Promise<PaperWithEdges> {
    throw new Error("GraphBuilder.buildForPaper: not implemented");
  }

  /** Build the graph for an entire Zotero collection (batched + cached). */
  async buildForCollection(_collectionId: number): Promise<void> {
    throw new Error("GraphBuilder.buildForCollection: not implemented");
  }
}
