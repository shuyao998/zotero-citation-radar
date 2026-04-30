/**
 * OpenAlex REST API client.
 *
 * Auth: API key required (polite pool deprecated 2026-02-13).
 * Pass key via `api_key` query parameter.
 *
 * Free tier (per day): unlimited single-entity queries, 10k list calls,
 * 1k search calls.
 *
 * @see https://developers.openalex.org/how-to-use-the-api/rate-limits-and-authentication
 * @see https://docs.openalex.org/api-entities/works/work-object
 */

import type { Author, PaperRecord } from "./types";

const BASE_URL = "https://api.openalex.org";

export interface OpenAlexClientOptions {
  apiKey: string;
}

interface RawAuthorship {
  author?: { display_name?: string; orcid?: string };
}

interface RawWork {
  id?: string; // e.g. "https://openalex.org/W2741809807"
  doi?: string; // e.g. "https://doi.org/10.1038/s41586-020-2649-2"
  title?: string;
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: RawAuthorship[];
  primary_location?: { source?: { display_name?: string } };
  referenced_works?: string[];
}

export class OpenAlexClient {
  constructor(private readonly options: OpenAlexClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        "OpenAlex API key is required. Get one free at openalex.org/settings/api",
      );
    }
  }

  /** Fetch a single Work by DOI. */
  async getWorkByDoi(doi: string): Promise<PaperRecord> {
    const cleanDoi = normalizeDoi(doi);
    const url = `${BASE_URL}/works/doi:${encodeURIComponent(cleanDoi)}?api_key=${encodeURIComponent(this.options.apiKey)}`;
    const work = await this.fetchJson<RawWork>(url);
    return mapWorkToPaper(work);
  }

  /**
   * Fetch the references of a given OpenAlex Work.
   * `referenced_works` returns OpenAlex IDs only — we batch-fetch their full
   * records via the bulk filter endpoint to avoid one HTTP call per ID.
   */
  async getReferences(openAlexId: string): Promise<PaperRecord[]> {
    const work = await this.fetchJson<RawWork>(
      `${BASE_URL}/works/${encodeURIComponent(stripOpenAlexUrl(openAlexId))}?api_key=${encodeURIComponent(this.options.apiKey)}`,
    );
    const refIds = (work.referenced_works ?? []).map(stripOpenAlexUrl);
    if (refIds.length === 0) return [];

    return this.batchFetchWorks(refIds);
  }

  /**
   * Fetch citing works (papers that cite the given OpenAlex Work).
   * Uses the `filter=cites:W...` endpoint. Pages until exhausted or capped.
   */
  async getCitedBy(
    openAlexId: string,
    options: { maxResults?: number } = {},
  ): Promise<PaperRecord[]> {
    const id = stripOpenAlexUrl(openAlexId);
    const max = options.maxResults ?? 200;
    const perPage = 50;
    const results: PaperRecord[] = [];
    let cursor = "*";

    while (results.length < max) {
      const url =
        `${BASE_URL}/works?filter=cites:${id}&per-page=${perPage}` +
        `&cursor=${encodeURIComponent(cursor)}` +
        `&api_key=${encodeURIComponent(this.options.apiKey)}`;
      const page = await this.fetchJson<{
        results: RawWork[];
        meta?: { next_cursor?: string | null };
      }>(url);
      for (const work of page.results ?? []) {
        results.push(mapWorkToPaper(work));
        if (results.length >= max) break;
      }
      const next = page.meta?.next_cursor;
      if (!next) break;
      cursor = next;
    }

    return results;
  }

  // === internals ===

  private async batchFetchWorks(ids: string[]): Promise<PaperRecord[]> {
    const out: PaperRecord[] = [];
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const filter = `openalex_id:${chunk.join("|")}`;
      const url =
        `${BASE_URL}/works?filter=${encodeURIComponent(filter)}` +
        `&per-page=${chunk.length}` +
        `&api_key=${encodeURIComponent(this.options.apiKey)}`;
      const page = await this.fetchJson<{ results: RawWork[] }>(url);
      for (const w of page.results ?? []) out.push(mapWorkToPaper(w));
    }
    return out;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      const body = await safeText(resp);
      throw new Error(
        `OpenAlex ${resp.status} ${resp.statusText} for ${redactKey(url)} :: ${body.slice(0, 300)}`,
      );
    }
    return (await resp.json()) as T;
  }
}

// === helpers ===

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "");
}

function stripOpenAlexUrl(id: string): string {
  return id.replace(/^https?:\/\/openalex\.org\//, "");
}

function mapWorkToPaper(work: RawWork): PaperRecord {
  return {
    doi: work.doi ? normalizeDoi(work.doi) : undefined,
    openAlexId: work.id ? stripOpenAlexUrl(work.id) : undefined,
    title: work.title || work.display_name || "(untitled)",
    year: work.publication_year,
    authors: (work.authorships ?? []).map<Author>((a) => ({
      name: a.author?.display_name ?? "Unknown",
      orcid: a.author?.orcid,
    })),
    venue: work.primary_location?.source?.display_name,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    citedByCount: work.cited_by_count,
    fetchedAt: Date.now(),
  };
}

/** OpenAlex serves abstracts as inverted index; reconstruct to plain text. */
function reconstructAbstract(
  inv: Record<string, number[]> | undefined,
): string | undefined {
  if (!inv) return undefined;
  const positions: Array<[number, string]> = [];
  for (const [word, posList] of Object.entries(inv)) {
    for (const p of posList) positions.push([p, word]);
  }
  if (positions.length === 0) return undefined;
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ");
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "(no body)";
  }
}

function redactKey(url: string): string {
  return url.replace(/api_key=[^&]+/i, "api_key=***");
}
