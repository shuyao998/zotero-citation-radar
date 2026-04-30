/**
 * Shared types for the citation-graph module.
 * These map roughly onto OpenAlex / Semantic Scholar shapes but are
 * provider-agnostic so the rest of the codebase doesn't depend on
 * any single API's schema.
 */

export interface Author {
  name: string;
  orcid?: string;
}

export interface PaperRecord {
  id?: number; // local DB primary key
  zoteroItemId?: number;
  doi?: string;
  openAlexId?: string;
  s2Id?: string;
  title: string;
  year?: number;
  authors: Author[];
  venue?: string;
  abstract?: string;
  citedByCount?: number;
  fetchedAt: number;
}

export interface CitationEdge {
  fromPaperId: number;
  toPaperId: number;
  source: "openalex" | "s2" | "crossref";
  isInfluential?: boolean;
  contextSnippet?: string;
}

export interface PaperWithEdges {
  paper: PaperRecord;
  references: PaperRecord[]; // papers this one cites
  citedBy: PaperRecord[]; // papers that cite this one
  influentialReferences: PaperRecord[]; // S2-flagged subset of references
  influentialCitedBy: PaperRecord[]; // S2-flagged subset of citedBy
}
