/**
 * Given a claim and the cited paper's PDF, find the most relevant passage
 * (the "evidence segment") that the claim is paraphrasing or quoting.
 *
 * Strategy:
 *   1. Embed the claim
 *   2. Chunk the cited PDF into overlapping windows
 *   3. Cosine-similarity rank windows
 *   4. Return top-1 or top-3 with location info
 *
 * For v0.1 we may use a simpler keyword/BM25 approach to avoid bundling
 * an embedding model; revisit when LLM context windows allow whole-paper input.
 */

import type { ClaimLocation } from "./reportSchema";

export interface EvidenceCandidate {
  text: string;
  location: ClaimLocation;
  score: number;
}

export async function locateEvidence(
  _claimText: string,
  _citedPaperPdfAttachmentId: number,
  _topK: number = 3,
): Promise<EvidenceCandidate[]> {
  throw new Error("locateEvidence: not implemented");
}
