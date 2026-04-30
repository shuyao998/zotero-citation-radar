/**
 * OpenAlex REST API client.
 *
 * Auth: API key required as of 2026-02-13 (polite pool deprecated).
 * Pass key via `api_key` query parameter.
 * @see https://developers.openalex.org/how-to-use-the-api/rate-limits-and-authentication
 */

import type { PaperRecord } from "./types";

export interface OpenAlexClientOptions {
  apiKey: string;
  cacheTtlSeconds?: number;
}

export class OpenAlexClient {
  constructor(private readonly options: OpenAlexClientOptions) {}

  /** Fetch a single Work by DOI. */
  async getWorkByDoi(_doi: string): Promise<PaperRecord> {
    throw new Error("OpenAlexClient.getWorkByDoi: not implemented");
  }

  /** Fetch all references (cited works) of a given OpenAlex Work. */
  async getReferences(_openAlexId: string): Promise<PaperRecord[]> {
    throw new Error("OpenAlexClient.getReferences: not implemented");
  }

  /** Fetch all citations (citing works) of a given OpenAlex Work. */
  async getCitedBy(_openAlexId: string): Promise<PaperRecord[]> {
    throw new Error("OpenAlexClient.getCitedBy: not implemented");
  }
}
