/**
 * Structured output schema for the "影响力 / 江湖地位" report.
 * The LLM is prompted to return JSON matching this shape; the UI then
 * renders summary_md to the user.
 */

export type PositionLabel =
  | "seminal" // 开创性工作
  | "mainstream" // 主流路线
  | "follow-up" // 跟随 / 增量
  | "fringe" // 边缘 / 小众
  | "review"; // 综述类

export interface InfluenceReport {
  positionLabel: PositionLabel;
  positionConfidence: number; // 0..1
  oneLineVerdict: string; // 给用户看的一句话总结
  summaryMd: string; // 完整中文 markdown 报告
  evidence: {
    keyAncestors: Array<{ doi?: string; title: string; reason: string }>;
    keyDescendants: Array<{ doi?: string; title: string; reason: string }>;
    methodLineage?: string; // 方法演进脉络
  };
  caveats?: string[]; // LLM 自报的不确定性
}
