/**
 * Extracts the (claim, citation) pair from a user-selected text region in a
 * Zotero PDF reader. The selection is expected to contain an inline citation
 * marker like "[12]", "(Smith 2021)", "Smith et al. (2021)" etc.
 *
 * Returns:
 *   - claimText: the user-selected sentence/passage
 *   - citationKey: the parsed citation marker (if found)
 *   - claimLocation: PDF coords for later highlighting
 */

import type { ClaimLocation } from "./reportSchema";

export interface ExtractedClaim {
  claimText: string;
  citationMarker?: string; // raw marker as it appears in text
  claimLocation: ClaimLocation;
}

export function extractClaim(
  _selection: { text: string; location: ClaimLocation },
): ExtractedClaim {
  throw new Error("extractClaim: not implemented");
}
