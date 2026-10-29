# English Typing Practice

导入一篇英文文章，按原文逐行输入：左边是文章导入 / 主打字区，右边是窄侧边栏（练习设置、打字统计、完成信息）；点击原文里的任意单词即可查看它的**释义、音标、词形变化、考纲范围和词频**。

- 纯前端 React + TypeScript（Umi 4），无需后端；
- 支持粘贴文本或导入 `.txt`；
- 逐行对照输入：原文行和下方输入框使用同一套等宽排版，正常英文下逐字符横向对齐；过长的原始行会按单词边界自动拆成多行；
- 下方是普通输入框，支持原生光标/选择：点击定位、←/→、Home/End、Shift+方向、鼠标拖选、正常输入/退格/Delete；
- 支持鼠标点击任意行、或用 ↑/↓ 切换当前行，直接回到前面的行修正错误，不需要先退格掉后续所有行；
- 正确/错误颜色提示直接标在**原文行**上，输入框里的文字保持普通颜色；
- 输入框里也会显示 `↵`；Enter 和普通字符一样作为输入处理，多按 Enter 会被当作错误字符，而不是跳到下一行；
- 导入时会先预处理：中文/全角标点转英文半角，键盘无法输入的字符（中文、emoji 等）统一替换为空格；
- 每段末尾显示 `↵`；空格 / 标点 / 数字 / 换行符可配置跳过，**默认全部关闭**；标记为跳过的字符会自动填入输入框（包括 `↵`），退格遇到自动跳过的字符时会连带退掉前面一个正常字符；
- 词库来自 ECDICT / ecdict-revised 的本地合并数据，按需加载约 2.1MB（gzip）的 Web 子集，支持变位词回退到原形；
- 释义按词性逐行展示；卡片显示词形变化（过去式、过去分词、复数、比较级等）；悬浮卡在单词上方时，字段顺序自动反转，让“释义”始终离输入位置最近；
- 起始页和打字页统一为左右栏：左侧导入文章或主打字，右侧固定窄侧边栏放设置与打字信息；
- 打字页左侧标题/工具栏固定，只有文章区域滚动，完成一行自动滚动一行；
- 正确字符为绿色，错误字符改为**深红底白字**的翻转提示；
- 打完不再跳转到独立结果页，而是在右侧边栏显示“打字完成”、锁定用时、WPM、正确率和错误数；完成后仍可继续退格修改、切换行或点击单词查词；
- 侧边栏可随时修改跳过设置并重新开始，也可直接重新开始或换文章。

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
