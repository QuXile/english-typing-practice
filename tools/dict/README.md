# dict — 本地命令行查词工具

基于 **ecdict-revised v0.1.1**（英汉译文底座）+ **ECDICT**（考纲标签 / 词频 / 柯林斯 / 牛津 / 词形 / 英文释义）合并出的本地 SQLite 词典，配一个纯 Node、零依赖的命令行查词工具。

> 纯自用工具：不涉及前端打包，也不需要 ECDICT 的 63MB CSV 出现在应用里。

## 环境要求

- Node.js **>= 22.5**（使用了内置的 `node:sqlite`，无需 npm 依赖）
- 首次准备数据需要 `curl` + `unzip`（Git Bash 自带）

## 快速开始

```bash
cd tools/dict

# 1. 下载原始数据（约 110MB，只需一次，缓存在 .cache/）
bash fetch-data.sh

# 2. 合并生成 data/dict.sqlite（约 73MB）
node build.mjs

# 3. 查词
node dict.mjs abandon
```

可选：`build.mjs` 支持环境变量覆盖数据路径：

```bash
ECDICT_CSV=/path/to/ecdict.csv REVISED_CSV=/path/to/entries.csv node build.mjs
```

## 命令

```bash
node dict.mjs abandon                # 精确查词（大小写不敏感）
node dict.mjs aband                  # 没查到时给前缀/包含建议
node dict.mjs --zh 放弃              # 按中文释义反查
node dict.mjs --random toefl         # 从考纲标签随机抽词
node dict.mjs --stats                # 数据库统计
node dict.mjs --json abandon         # JSON 输出，方便脚本处理
node dict.mjs                        # 交互模式（:q 退出，:stats 看统计）
```

考纲标签：`zk` 中考、`gk` 高考、`cet4` 四级、`cet6` 六级、`ky` 考研、`toefl` 托福、`ielts` 雅思、`gre` GRE。

输出示例（真实数据）：

```text
abandon  /əˈbændən/
  标签 [高考] [四级] [六级] [考研] [托福] [GRE]   当代词频 #2182   BNC #2057   柯林斯 ★★★   牛津3000

释义
  vt. 放弃, 抛弃, 遗弃, 使屈从, 沉溺, 放纵
  n. 放任, 无拘束, 狂热

英文释义
  n. the trait of lacking restraint or control; reckless freedom from inhibition or worry
  v. forsake, leave behind
  ...

词形
  过去式 abandoned  ·  过去分词 abandoned  ·  现在分词 abandoning  ·  第三人称单数 abandons

来源  ecdict-revised v0.1.1 译文 + ECDICT 元数据
```

- 终端里会带颜色；管道/重定向时自动关闭；可用 `NO_COLOR=1` 强制关闭。
- 释义里 `[医]/[法]/[计]/[网络]` 等专业义项会以灰色显示，主释义排在前面。
- 音标会做显示层规范化：ECDICT 的 `ә` → `ə`、`'` 重音 → `ˈ`，并加 `/ /`；原始数据不动。

## 合并规则与构建结果

`build.mjs` 的流程：

1. **revised 为底座**：758,497 条（`word / phonetic / translation`）。
2. **ECDICT 按小写 word join 元数据**：`definition / pos / tag / bnc / frq / collins / oxford / exchange`；音标仅在 revised 为空时兜底。
3. **revised 没有、ECDICT 有的词条补录**：25,581 条，`source = ecdict`，译文用 ECDICT。
4. 输出 `data/dict.sqlite` + `data/build-meta.json`（记录两个源文件的 SHA-256、条目数、构建时间）。

最近一次构建（2026-10-26）：

| 项 | 数量 |
|---|---:|
| revised 底座 | 758,497 |
| ECDICT 行数 | 770,611 |
| join 上元数据的词条 | 745,030 |
| ECDICT 补录词条 | 25,581 |
| **合计** | **784,078** |
| 考纲词条（任一考纲标签） | 11,453 |
| 其中 revised 缺失、由 ECDICT 补回的考纲词条 | **6**（`B.C.` `i.e.` `Mr.` `Ms.` `no.` `P.M.`） |

> 你关心的中考/高考/四六级/考研/托福/雅思单词，revised 本来就 100% 覆盖（单字词 11,438 个全在），真正补回来的是 6 个缩写/短语形式的考纲条目 + 25,581 条冷门词条（多数是词组、古词、词缀）。补录条目的 `source` 字段会显示为“ECDICT 补录”。

## 生成前端词典

Web 应用使用一个精简词典文件，由 `build-app-dict.mjs` 从 `data/dict.sqlite` 生成：

```bash
node build-app-dict.mjs
# 或在仓库根目录执行: pnpm dict:app
```

输出 `src/data/generated/dictionary.json`：

- **headwords**：考纲 / 高频 / 核心单字词，并补充常见 BNC 排名词（避免 an 这类缺 FRQ/标签的常见词漏收），含释义、音标、考纲标签、frq/bnc；
- **aliases**：变形词 → 原形（`went → go`、`wrapped → wrap`、`was → be`），文章里遇到变位词会回退到原形释义，同时保留变形词自己的音标；
- **forms / lemma**：来自 ECDICT `exchange`，记录过去式、过去分词、现在分词、三单、复数、比较级、最高级；`lemma` 表示该词本身是某原形的变形；
- 当前约 44,538 个 headwords + 29,352 个 aliases（共 73,890 个 key），文件约 6.8MB，gzip 约 2.12MB，前端按需动态加载。

示例节点：

```json
{
  "abandon": {
    "t": "vt. 放弃, 抛弃...",
    "p": "/əˈbændən/",
    "tags": ["gk", "cet4"],
    "frq": 2182,
    "bnc": 2057,
    "forms": { "p": "abandoned", "d": "abandoned", "i": "abandoning", "3": "abandons" }
  },
  "abandoned": { "l": "abandon", "p": "/əˈbændənd/" }
}
```

## 已知限制

- **没有例句、没有真人发音**：ECDICT 的 `audio` 字段是空的，`detail` 也基本为空。后续可接 KyleBing 词库的例句、或浏览器 TTS。
- **revised 译文仍有专业义项噪音**：工具里把 `[医]/[法]/[计]` 等行置灰，但没有删；这是故意保留原数据，方便以后清洗。
- **revised 自己的 13,467 条新增词头里有大量拼写变体噪音**（`aaaaah`、`a's` 之类），目前原样保留（精确查词时基本不会碰到）。
- **音标是显示层清洗**，没有做系统性的 IPA 校对；如果以后要更标准的 US/UK 音标，可接 KyleBing 的 us/uk 或 `ipa-dict` 的 en_US。
- 数据库 ~73MB、原始源 ~110MB，均已在 `.gitignore` 中排除，不随仓库提交。

## 数据来源与许可

- [ecdict-revised](https://github.com/sliuhaob/ecdict-revised) v0.1.1：基础 ECDICT 内容 MIT（Copyright (c) 2025 Linwei）；新增中文修订 CC BY-SA 4.0（ECDICT Revised contributors）。若对外分发本词典数据，需保留署名并以 CC BY-SA 4.0 共享相关修订内容。
- [ECDICT](https://github.com/skywind3000/ECDICT)：MIT。
- 本工具代码为本地自用工具，随项目代码走。

## 文件

```text
tools/dict/
├── fetch-data.sh      # 下载原始数据到 .cache/
├── build.mjs          # 合并 → data/dict.sqlite
├── build-app-dict.mjs # 生成前端 src/data/generated/dictionary.json
├── dict.mjs           # 命令行查词（精确 / 前缀建议 / 中文反查 / 随机 / JSON / 交互）
├── README.md
├── .cache/            # 原始数据（gitignore）
└── data/              # dict.sqlite + build-meta.json（gitignore）
```
