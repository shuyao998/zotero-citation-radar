/**
 * Semantic Scholar Graph API client.
 *
 * Auth: optional. With a personal key → 1 req/s dedicated.
 * Without → shared 5000 req / 5 min unauthenticated pool (subject to throttling).
 * @see https://api.semanticscholar.org/api-docs/graph
 *
 * Key value: `references[].isInfluential` flag — used to weight prompts in
 * the influence module.
 */

import type { PaperRecord } from "./types";

export interface SemanticScholarClientOptions {
  apiKey?: string;
  cacheTtlSeconds?: number;
}

export interface S2Reference {
  paper: PaperRecord;
  isInfluential: boolean;
  contextSnippet?: string;
}

export class SemanticScholarClient {
  constructor(private readonly options: SemanticScholarClientOptions) {}

  /** Fetch references with influential flag for a given paper (by DOI or S2 ID). */
  async getReferencesWithInfluence(
    _paperId: string,
  ): Promise<S2Reference[]> {
    throw new Error(
      "SemanticScholarClient.getReferencesWithInfluence: not implemented",
    );
  }

  /** Fetch citations with influential flag for a given paper. */
  async getCitationsWithInfluence(
    _paperId: string,
  ): Promise<S2Reference[]> {
    throw new Error(
      "SemanticScholarClient.getCitationsWithInfluence: not implemented",
    );
  }
}
