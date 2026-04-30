/**
 * Module A entry point: take a paper, return an InfluenceReport.
 *
 * Pipeline:
 *   1. Ensure citation graph is built (GraphBuilder)
 *   2. Build prompt within budget (promptBuilder)
 *   3. Call LLM provider with structured-output schema
 *   4. Persist to influence_report table
 *   5. Return report for UI rendering
 */

import type { InfluenceReport } from "./reportSchema";

export interface EvaluatorOptions {
  llmModel: string; // e.g. "deepseek-chat"
  forceRefresh?: boolean; // ignore cached report
}

export async function evaluateInfluence(
  _zoteroItemId: number,
  _options: EvaluatorOptions,
): Promise<InfluenceReport> {
  throw new Error("evaluateInfluence: not implemented");
}
