# English Typing Practice

导入一篇英文文章，按原文逐行输入：原文在上、手写在下；点击原文里的任意单词即可查看它的**释义、音标、词形变化、考纲范围和词频**。

- 纯前端 React + TypeScript（Umi 4），无需后端；
- 支持粘贴文本或导入 `.txt`；
- 逐行对照输入：原文行和手写行使用同一套等宽排版、逐字符对齐；过长的原始行会按单词边界自动拆成多行对照；
- 当前手写行支持原生光标/选择：点击定位、←/→、Home/End、Shift+方向、鼠标拖选；输入、退格、Delete 都作用于光标位置，跳过的字符也能用光标经过（为保证固定对齐，输入采用覆盖目标格的语义）；
- 导入时会先预处理：中文/全角标点转英文半角，键盘无法输入的字符（中文、emoji 等）统一替换为空格；
- 每段末尾显示 `↵`；空格 / 标点 / 数字 / 换行符可配置跳过，**默认全部关闭**，关闭跳过换行时需要自己按 Enter 换行；
- 词库来自 ECDICT / ecdict-revised 的本地合并数据，按需加载约 2.1MB（gzip）的 Web 子集，支持变位词回退到原形；
- 释义按词性逐行展示；卡片显示词形变化（过去式、过去分词、复数、比较级等）；悬浮卡在单词上方时，字段顺序自动反转，让“释义”始终离输入位置最近；
- 练习页顶部（标题/工具栏/统计）固定，只有文章区域滚动，完成一行自动滚动一行；
- 练完显示 WPM、正确率、用时，可重练或换文章。

## 开发

需要 Node.js >= 20 和 [pnpm](https://pnpm.io/)（当前环境 Node 24 + pnpm 12 可直接运行；Umi 已升级到 4.7.28，不再需要 Node 20 兼容层）。

```bash
pnpm install
pnpm dev      # 默认 http://localhost:8000/
pnpm build    # 输出到 docs/
```

pnpm 12 默认会拦截依赖的构建脚本，本项目已在 `pnpm-workspace.yaml` 的 `allowBuilds` 中放行 `esbuild` / `core-js` / `core-js-pure`。

## 词库

Web 端词典由 `tools/dict/` 的合并数据库生成：

```bash
cd tools/dict
bash fetch-data.sh     # 首次下载 ECDICT + ecdict-revised 原始数据（约 110MB）
node build.mjs         # 生成 data/dict.sqlite（约 73MB）
cd ../..
pnpm dict:app          # 生成 src/data/generated/dictionary.json（约 5.6MB / gzip 1.8MB）
```

- `tools/dict/dict.mjs` 是命令行查词工具（精确查词/中文反查/随机词/统计）；
- 详细说明见 [tools/dict/README.md](tools/dict/README.md)。

## 数据许可

- [ECDICT](https://github.com/skywind3000/ECDICT)：MIT；
- [ecdict-revised](https://github.com/sliuhaob/ecdict-revised)：基础内容 MIT，新增中文修订 CC BY-SA 4.0。

个人使用请保留来源说明；若公开分发词库数据，需按上述许可署名/共享。
