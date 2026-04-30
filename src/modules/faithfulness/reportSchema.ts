/**
 * Structured output for a single citation-faithfulness check.
 */

export type FaithfulnessVerdict =
  | "supports" // 被引文确实支持论点
  | "partial" // 部分支持，有限定条件
  | "contradicts" // 被引文与论点矛盾
  | "unrelated" // 被引文与论点无关
  | "unverifiable"; // 信息不足以判断

export interface ClaimLocation {
  attachmentItemId: number; // Zotero PDF attachment id
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaithfulnessCheck {
  claimText: string;
  claimLocation: ClaimLocation;
  citedPaperId?: number; // local paper.id; nullable if cited paper not in library
  evidenceText?: string;
  evidenceLocation?: ClaimLocation;
  verdict: FaithfulnessVerdict;
  verdictConfidence: number; // 0..1
  reasoning: string; // LLM 的推理（用户可读）
  llmModel: string;
  generatedAt: number;
}
