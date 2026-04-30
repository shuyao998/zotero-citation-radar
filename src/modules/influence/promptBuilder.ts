/**
 * Serializes a paper's local citation graph into a token-efficient prompt
 * for the influence evaluator. Trims to fit within model context budget
 * by keeping only influential citations + a sample of regular ones.
 */

import type { PaperWithEdges } from "../citationGraph/types";

export interface PromptBudget {
  maxTokens: number; // approximate token budget for graph context
  prioritizeInfluential: boolean;
}

export function buildInfluencePrompt(
  _data: PaperWithEdges,
  _budget: PromptBudget,
): string {
  throw new Error("buildInfluencePrompt: not implemented");
}
