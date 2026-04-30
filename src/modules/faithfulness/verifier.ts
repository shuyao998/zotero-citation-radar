/**
 * Module B entry point: given a (claim, citation) pair, produce a verdict.
 *
 * Pipeline:
 *   1. Resolve cited paper (DOI lookup → local DB → citation graph)
 *   2. Locate evidence segments in cited PDF (evidenceLocator)
 *   3. Prompt LLM to compare claim vs. evidence with structured output
 *   4. Persist to faithfulness_check table
 *   5. Return verdict for UI popup
 */

import type { ExtractedClaim } from "./claimExtractor";
import type { FaithfulnessCheck } from "./reportSchema";

export interface VerifierOptions {
  llmModel: string;
  citingPaperZoteroItemId: number;
}

export async function verifyCitation(
  _claim: ExtractedClaim,
  _options: VerifierOptions,
): Promise<FaithfulnessCheck> {
  throw new Error("verifyCitation: not implemented");
}
