# Zotero Citation Radar

> 给每篇文献一次"雷达扫描"——基于引文图谱给出**江湖地位**评估，并用 LLM 核查**引文是否真的支持其论点**。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/Status-pre--alpha-orange.svg)
![Zotero: 7-8](https://img.shields.io/badge/Zotero-7%20%7C%208-red.svg)

## 这个插件是干嘛的？

把一篇文献加入 Zotero 后，你通常不知道：
- 它在领域里是开创性工作、主流跟随、还是边缘探索？
- 它引用的那些论文，**真的**支持作者声称的论点吗？

现有的 Zotero 插件要么只给被引数，要么只能做单篇问答。**Citation Radar 把引文图谱 + 全文 + LLM 三者打通**，给你两个核心能力：

### 模块 A：江湖地位评估
- 自动从 OpenAlex / Semantic Scholar 拉本文的全部引用 + 被引论文
- 标记 *influential citations*（Semantic Scholar 机器学习判定的"真正基于此论文推进的"引用）
- 把图结构 + 关键论文摘要喂给 LLM，输出一份结构化报告：开创性 / 主流 / 跟随 / 边缘 / 综述

### 模块 B：引文真实性核查
- 在 PDF 阅读器里选中一段含引用的论点 → 右键 "Verify citation"
- 插件自动定位被引论文 PDF 的对应段落
- LLM 比对原始证据，给出判断：`supports` / `partial` / `contradicts` / `unrelated`，并附推理与可点回的证据段

## 安装方式

> ⚠️ **当前为 pre-alpha 阶段，尚未发布 release。**

### 开发者本地构建

需要：Node.js ≥ 22、Zotero 7 或 8、git

```bash
git clone https://github.com/shuyao998/zotero-citation-radar.git
cd zotero-citation-radar
npm install
cp .env.example .env
# 编辑 .env，填入 Zotero 路径与 API key
npm start
```

### 普通用户安装（待发布后）

下载 release 中的 `.xpi` 文件 → Zotero → Tools → Plugins → 齿轮按钮 → Install Plugin From File。

## 配置

第一次启动后，在 Zotero → 编辑 → 首选项 → Citation Radar 标签内填入：

| 字段 | 必填 | 说明 |
|---|---|---|
| OpenAlex API Key | ✅ | 免费，[在这里申请](https://openalex.org/settings/api) |
| Semantic Scholar API Key | ⚠️ | 推荐，[这里申请](https://www.semanticscholar.org/product/api)；不填则用公共池（慢） |
| LLM Provider | ✅ | DeepSeek / OpenAI / Anthropic / Gemini / 自托管 |
| LLM API Key | ✅ | 对应 provider 的 key |

## 项目结构

```
src/modules/
├── citationGraph/   # 拉引文图（OpenAlex + S2 + Crossref）
├── influence/       # 江湖地位评估（A 模块）
├── faithfulness/    # 引文真实性核查（B 模块）
├── llm/             # 多 provider 抽象
├── storage/         # SQLite 持久化
└── pdf/             # PDF 文本提取与段落定位（W4 加入）
```

## 路线图

- [x] 项目初始化（脚手架 + 模块骨架）
- [ ] **W1** OpenAlex client + 本地 SQLite + 偏好面板
- [ ] **W2** Semantic Scholar 整合 + 引文图构建
- [ ] **W3** 模块 A 完整链路：prompt → LLM → 报告渲染
- [ ] **W4** PDF 段落定位
- [ ] **W5** 模块 B verifier + UI
- [ ] **W6** 文档 / 国际化 / 发布 v0.1.0

## 隐私与合规

- 所有 API key **保存在本地 Zotero 偏好**（`extensions.zotero.citation-radar.*`），不会上传任何服务器
- LLM 调用使用**用户自己的 API key**，数据隐私由 provider 条款决定
- 插件不收集任何遥测、不发送任何分析数据

## 致谢

- [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) — 项目骨架
- [OpenAlex](https://openalex.org) — 全球开放学术图谱
- [Semantic Scholar](https://www.semanticscholar.org/) — Influential citations 算法

## 许可证

[AGPL-3.0-or-later](LICENSE) © 2026 shuyao998
