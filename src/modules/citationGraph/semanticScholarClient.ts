/**
 * Semantic Scholar Graph API client.
 *
 * Used to enrich the OpenAlex citation graph with `isInfluential` flags —
 * S2's ML model decides whether a citation is "structurally important" to
 * the citing paper (mentioned multiple times, in methods/results sections,
 * etc.) vs a passing acknowledgment.
 *
 * Auth:
 *   - With personal key (header `x-api-key`): 1 req/s dedicated.
 *   - Without key: 5000 req/5min shared public pool.
 * @see https://api.semanticscholar.org/api-docs/graph
 */

const BASE_URL = "https://api.semanticscholar.org/graph/v1";
const MIN_INTERVAL_MS = 1100; // be safe: 1.1s between calls even with key

export interface SemanticScholarClientOptions {
  apiKey?: string;
}

/** DOI (lowercased) → whether S2 marks the citation as influential. */
export type InfluenceMap = Record<string, boolean>;

interface S2ExternalIds {
  DOI?: string;
  ArXiv?: string;
}
interface S2Paper {
  paperId: string;
  externalIds?: S2ExternalIds;
  title?: string;
}
interface S2ReferenceItem {
  isInfluential?: boolean;
  citedPaper?: S2Paper;
}
interface S2CitationItem {
  isInfluential?: boolean;
  citingPaper?: S2Paper;
}

export class SemanticScholarClient {
  private lastRequestAt = 0;

  constructor(private readonly options: SemanticScholarClientOptions) {}

  /**
   * Fetch references of the seed paper and return a DOI→isInfluential map.
   * Skips entries S2 has no DOI for (we can't match them to local edges).
   */
  async getReferenceInfluences(seedDoi: string): Promise<InfluenceMap> {
    const paperId = await this.resolveDoiToPaperId(seedDoi);
    return this.paginateInfluences<S2ReferenceItem>(
      `${BASE_URL}/paper/${paperId}/references`,
      (item) => ({ doi: item.citedPaper?.externalIds?.DOI, inf: !!item.isInfluential }),
    );
  }

  /** Same shape but for papers citing the seed. */
  async getCitationInfluences(seedDoi: string): Promise<InfluenceMap> {
    const paperId = await this.resolveDoiToPaperId(seedDoi);
    return this.paginateInfluences<S2CitationItem>(
      `${BASE_URL}/paper/${paperId}/citations`,
      (item) => ({ doi: item.citingPaper?.externalIds?.DOI, inf: !!item.isInfluential }),
    );
  }

  // === internals ===

  private async resolveDoiToPaperId(doi: string): Promise<string> {
    const clean = normalizeDoi(doi);
    const url = `${BASE_URL}/paper/DOI:${encodeURIComponent(clean)}?fields=paperId`;
    const data = await this.fetchJson<{ paperId?: string }>(url);
    if (!data.paperId) {
      throw new Error(`S2 has no record for DOI ${clean}`);
    }
    return data.paperId;
  }

  private async paginateInfluences<T>(
    baseEndpoint: string,
    extract: (item: T) => { doi?: string; inf: boolean },
  ): Promise<InfluenceMap> {
    const map: InfluenceMap = {};
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const url = `${baseEndpoint}?fields=isInfluential,externalIds&limit=${pageSize}&offset=${offset}`;
      const page = await this.fetchJson<{ data?: T[]; next?: number | null }>(url);
      const items = page.data ?? [];
      for (const item of items) {
        const { doi, inf } = extract(item);
        if (doi) map[doi.toLowerCase()] = inf;
      }
      if (items.length < pageSize) break;
      if (page.next == null) break;
      offset = page.next;
    }
    return map;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    await this.respectRateLimit();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.apiKey) headers["x-api-key"] = this.options.apiKey;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "(no body)");
      throw new Error(
        `S2 ${resp.status} ${resp.statusText} for ${url} :: ${body.slice(0, 200)}`,
      );
    }
    return (await resp.json()) as T;
  }

  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    this.lastRequestAt = Date.now();
  }
}

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "");
}
