/**
 * Serializes a paper's local citation neighborhood into messages for the
 * influence evaluator. Token budget is held by the evaluator (it picks how
 * many neighbors to feed in); this module is purely formatting + the system
 * prompt that defines the task and JSON output schema.
 */

import type { ChatMessage } from "../llm/provider";

/** Per-paper fields needed in the prompt — kept minimal to save tokens. */
export interface InfluencePromptPaper {
  title: string;
  firstAuthor: string;
  year?: number | null;
  doi?: string | null;
  citedByCount?: number | null;
  abstract?: string | null;
  isInfluential?: boolean; // S2 flag (only meaningful for refs/citing)
}

export interface InfluencePromptInput {
  seed: InfluencePromptPaper;
  /** Top references this paper cites. Caller sorts (S2-influential first, then by cited_by). */
  topRefs: InfluencePromptPaper[];
  /** Top papers citing this paper. Same ordering rule. */
  topCiting: InfluencePromptPaper[];
  /** Real total cited-by reported by OpenAlex (may exceed local count). */
  totalCitedByReal?: number;
  /** Total references in DB (may exceed topRefs.length). */
  totalRefsLocal?: number;
}

const ABSTRACT_LIMIT_CHARS = 800;

const SYSTEM_PROMPT = `你是一名资深的科研引文分析专家。任务：基于一篇"种子论文"及其本地引文邻域（它引用的关键先驱、引用它的后续工作），判定该论文在所属研究领域中的"文献定位"。

【定位类别】（五选一，必须严格使用英文标签）：
- seminal     开创性工作。提出原创性概念/方法/发现，被后续工作大量构建。
- mainstream  主流路线。沿着已建立的研究脉络展开，被持续引用与扩展。
- follow-up   跟随/增量。在既有方法上做改进或验证，独立创新性较弱。
- fringe      边缘/小众。引用网络稀疏，未进入主流话语，或为独立支流。
- review      综述类。系统总结某方向的工作，本身少有原创实验结论。

【判断信号】（参考，不必穷举）：
- 它引用的论文中"关键引用"（S2 isInfluential）的数量与年代分布 → 接的传统是否成熟
- 这些关键引用本身的被引量 → 是否依赖经典文献
- 种子论文自身的被引量与年代 → 影响力体量
- 引用它的论文的体量、领域宽度 → 传承宽度

【输出要求】
只输出一个 JSON 对象，严格遵循下面的 schema。不要 markdown 代码块包裹、不要前后说明文字、不要中文标点污染 JSON 结构。

{
  "positionLabel": "seminal | mainstream | follow-up | fringe | review",
  "positionConfidence": 0.0~1.0 数值（你对该判断的把握度）,
  "oneLineVerdict": "一句中文总结（不超过 40 字）",
  "summaryMd": "中文 markdown 报告，3-6 段。建议结构：(1) 论文做了什么 (2) 它接的是哪一脉工作 (3) 对后续产生了什么影响 (4) 综合定位与理由",
  "evidence": {
    "keyAncestors": [
      {"title": "完整或截断的标题", "doi": "可选", "reason": "为什么是关键先驱（一句话）"}
    ],
    "keyDescendants": [
      {"title": "...", "doi": "可选", "reason": "为什么体现了它的影响力（一句话）"}
    ],
    "methodLineage": "可选，方法演进脉络一句话"
  },
  "caveats": ["可选，列出你判断的不确定性来源（如样本量小、领域陌生等）"]
}`;

export function buildInfluencePrompt(
  input: InfluencePromptInput,
): ChatMessage[] {
  const userContent = renderUserContent(input);
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

function renderUserContent(input: InfluencePromptInput): string {
  const parts: string[] = [];

  parts.push("【种子论文】");
  parts.push(renderPaper(input.seed, { showInfluential: false, indent: 0 }));
  if (input.totalRefsLocal != null && input.totalCitedByReal != null) {
    parts.push(
      `（本地引用 ${input.totalRefsLocal} 篇 · OpenAlex 报告被引 ${input.totalCitedByReal} 次）`,
    );
  }

  parts.push("");
  parts.push(
    `【它引用的关键先驱（${input.topRefs.length} 篇，已按"S2 关键 → 高被引"排序）】`,
  );
  if (input.topRefs.length === 0) {
    parts.push("(无)");
  } else {
    input.topRefs.forEach((p, i) => {
      parts.push(
        `${i + 1}. ${renderPaper(p, { showInfluential: true, indent: 3 })}`,
      );
    });
  }

  parts.push("");
  parts.push(
    `【引用它的后续工作（${input.topCiting.length} 篇，同序）】`,
  );
  if (input.topCiting.length === 0) {
    parts.push("(无)");
  } else {
    input.topCiting.forEach((p, i) => {
      parts.push(
        `${i + 1}. ${renderPaper(p, { showInfluential: true, indent: 3 })}`,
      );
    });
  }

  parts.push("");
  parts.push("请根据以上信息，输出符合 schema 的 JSON。");
  return parts.join("\n");
}

function renderPaper(
  p: InfluencePromptPaper,
  opts: { showInfluential: boolean; indent: number },
): string {
  const pad = " ".repeat(opts.indent);
  const flag = opts.showInfluential && p.isInfluential ? "[关键] " : "";
  const lines: string[] = [];
  lines.push(`${flag}${p.title}`);
  const meta: string[] = [];
  meta.push(p.firstAuthor);
  if (p.year != null) meta.push(String(p.year));
  if (p.citedByCount != null) meta.push(`cited-by ${p.citedByCount}`);
  if (p.doi) meta.push(`DOI: ${p.doi}`);
  lines.push(pad + meta.join(" · "));
  if (p.abstract && p.abstract.trim()) {
    const abs = truncate(p.abstract.replace(/\s+/g, " ").trim(), ABSTRACT_LIMIT_CHARS);
    lines.push(pad + "摘要：" + abs);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
