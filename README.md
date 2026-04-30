# Zotero Citation Radar

给每篇文献一次雷达扫描——基于本地引文图谱给出文献定位，用 LLM 输出结构化分析报告。

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/Release-R1-brightgreen.svg)](https://github.com/shuyao998/zotero-citation-radar/releases)
![Zotero: 7-8](https://img.shields.io/badge/Zotero-7%20%7C%208-red.svg)

## 这个插件解决什么问题

Zotero 自带的元数据只告诉你被引几次，但不告诉你这篇文章在领域里属于哪一脉、它接的是谁的工作、它对后续产生了什么影响。Citation Radar 把 OpenAlex 的引文图谱 + Semantic Scholar 的影响力标记 + LLM 的结构化分析串起来，一次右键就能看完。

## 已实现功能（R1）

引文图谱视图

- 从 OpenAlex 拉本文的所有 references 和 cited-by，存进本地 SQLite
- Semantic Scholar 的 isInfluential 标记（哪些引用是结构性的、不是顺手的）会标在图上：红边框节点 + 红色加粗连线
- 力导向布局：references 在左、种子论文居中、cited-by 在右，自由拖拽
- 右侧 sidebar 列出所有节点，按关键 / 高被引排序，引用前 5 加粗，支持搜索 + 点击聚焦 + DOI 直跳

文献定位报告（LLM 分析）

- 把种子论文 + 关键先驱 15 篇 + 关键后继 10 篇的元数据和摘要喂给 LLM
- 输出五选一的定位标签：seminal 开创 / mainstream 主流 / follow-up 跟随 / fringe 边缘 / review 综述
- 中文 markdown 报告 + 置信度 + 关键先驱列表 + 关键后继列表 + caveats
- 报告写进 SQLite 缓存，重复点击秒回；右键还有"重新分析"绕过缓存

统一界面

- 一次右键 "分析此论文"，弹出一个 Zotero 内嵌窗口，顶部两个 tab：引文图谱 + 文献定位
- 不需要离开 Zotero 跳到浏览器
- LLM 失败不影响图谱 tab

## 安装

R1 release 已发布，普通用户两步安装：

1. 到 [Releases 页面](https://github.com/shuyao998/zotero-citation-radar/releases) 下载最新的 `zotero-citation-radar.xpi`
2. Zotero 打开 工具 → 插件 → 右上角齿轮 → Install Plugin From File，选刚下载的 xpi

## 配置

第一次启动后，编辑 → 设置 → Citation Radar 标签里填：

| 字段 | 必填 | 用途 |
|---|---|---|
| OpenAlex API Key | 必填 | 拉引用图。免费，[这里申请](https://openalex.org/settings/api)，30 秒 |
| Semantic Scholar API Key | 可选 | 拉影响力标记。不填走公共池（慢但能用）；想要稳定 1 req/s 就[这里申请](https://www.semanticscholar.org/product/api) |
| LLM Provider | 必填 | 默认 DeepSeek |
| LLM Model | 必填 | 默认 `deepseek-chat`，可改成 `deepseek-reasoner` 等 |
| LLM API Key | 必填 | 你的 DeepSeek key（[申请入口](https://platform.deepseek.com/)） |
| Cited-by 抓取上限 | 可选 | 默认 0 = 不限。被引非常多的文章可设上限省 API 配额 |

所有 key 存在本地 Zotero 偏好里（`extensions.zotero.citation-radar.*`），不上传任何服务器。

## 使用

1. 在 Zotero 库里选中一篇有 DOI 的文献
2. 右键 → Citation Radar：分析此论文
3. 进度条会显示：抓引用 → 生成图谱 → 调 LLM 生成报告（首次约 20-40 秒）
4. 弹出窗口，左 tab 看引文图谱，右 tab 看文献定位

如果想让 LLM 重新跑一份新报告（比如对原报告不满意）：右键 → Citation Radar：重新分析此论文（绕过缓存）

## 路线图

- [x] R1：OpenAlex + S2 + 本地存储 + 引文图谱 + 文献定位 LLM 报告
- [ ] R2：PDF 段落定位 + 引文真实性核查（选中带引用的句子，验证被引文献是否真的支持该论点）
- [ ] R3：跨论文交叉引用视图 + 作者 h-index + 方法学指纹（材料学专属）

## 项目结构

```
src/modules/
├── citationGraph/   OpenAlex + Semantic Scholar 客户端
├── influence/       文献定位评估（prompt + LLM + 解析）
├── llm/             多 provider 抽象，目前实装 DeepSeek
├── storage/         SQLite 持久化
└── ui/              菜单 + 图谱视图 + 报告视图 + Zotero 窗口包装
```

## 开发者本地运行

需要 Node.js 22+ 和 git。

```bash
git clone https://github.com/shuyao998/zotero-citation-radar.git
cd zotero-citation-radar
npm install
cp .env.example .env
# 编辑 .env，填入 Zotero 路径
npm start
```

`npm start` 会自动编译 + 启动一个独立 Zotero dev profile + 装入插件 + 监听文件变化热重载。

## 隐私

- 所有 API key 保存在本地 Zotero 偏好，不上传任何服务器
- LLM 调用使用你自己的 API key，数据隐私由 provider 条款决定
- 插件不收集遥测、不发送分析数据
- 引文数据通过 OpenAlex 和 Semantic Scholar 的公开 API 拉取，缓存在本地 SQLite

## 致谢

- [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 项目脚手架
- [OpenAlex](https://openalex.org) 全球开放学术图谱
- [Semantic Scholar](https://www.semanticscholar.org/) Influential citations 算法
- [vis-network](https://visjs.org/) 图谱可视化

## 许可证

[AGPL-3.0-or-later](LICENSE)
