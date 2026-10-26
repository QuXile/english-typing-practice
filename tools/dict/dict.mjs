#!/usr/bin/env node
/**
 * Command-line dictionary built by ./build.mjs.
 *
 *   node dict.mjs abandon          # exact lookup (case-insensitive)
 *   node dict.mjs aban             # prefix suggestions when not found
 *   node dict.mjs --zh 放弃        # search Chinese translations
 *   node dict.mjs --random toefl   # random word from a word book
 *   node dict.mjs --stats          # database statistics
 *   node dict.mjs --json abandon   # machine-readable output
 *   node dict.mjs                  # interactive REPL
 *
 * Requirements: Node.js >= 22.5 (built-in node:sqlite), no npm dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DICT_DB || path.join(HERE, 'data', 'dict.sqlite');
const META_PATH = path.join(HERE, 'data', 'build-meta.json');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[dict] 缺少数据库: ${DB_PATH}\n       先运行: node build.mjs`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const stmtExact = db.prepare('SELECT * FROM words WHERE word = ?');
const stmtPrefix = db.prepare(`
  SELECT word, translation FROM words
  WHERE word LIKE ?
  ORDER BY CASE WHEN frq = 0 THEN 1 ELSE 0 END, frq, length(word)
  LIMIT 10
`);
const stmtContains = db.prepare(`
  SELECT word, translation FROM words
  WHERE word LIKE ?
  ORDER BY CASE WHEN frq = 0 THEN 1 ELSE 0 END, frq, length(word)
  LIMIT 10
`);
const stmtChinese = db.prepare(`
  SELECT word, tag, translation FROM words
  WHERE instr(translation, ?) > 0
  ORDER BY CASE WHEN frq = 0 THEN 1 ELSE 0 END, frq, length(word)
  LIMIT 15
`);
const stmtRandom = db.prepare(`
  SELECT word FROM words
  WHERE instr(' ' || tag || ' ', ' ' || ? || ' ') > 0
  ORDER BY RANDOM()
  LIMIT 1
`);

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const cyan = paint('36');
const green = paint('32');
const yellow = paint('33');
const magenta = paint('35');

const TAG_LABELS = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};
const TAG_ORDER = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'];

const EXCHANGE_LABELS = {
  p: '过去式',
  d: '过去分词',
  i: '现在分词',
  3: '第三人称单数',
  r: '比较级',
  t: '最高级',
  s: '复数',
  0: '原形',
  1: '原形变体',
};

function splitLines(raw) {
  return String(raw || '')
    .split(/\\n|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqueLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

const DOMAIN_RE = /^\[([^\]]{1,8})\]/;

function splitMeanings(raw) {
  const main = [];
  const domain = [];
  for (const line of uniqueLines(splitLines(raw))) {
    if (DOMAIN_RE.test(line)) domain.push(line);
    else main.push(line);
  }
  // 如果全是 [xx] 开头的释义，至少保留一行，避免空卡片
  if (main.length === 0 && domain.length > 0) main.push(domain.shift());
  return { main, domain };
}

function normalizePhonetic(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\/+|\/+$/g, '');
  s = s.replace(/\u04d9/g, 'ə'); // 西里尔字母 ә -> IPA ə
  s = s.replace(/'/g, 'ˈ'); // ECDICT 用 ' 表示重音
  s = s.replace(/\s+/g, ' ').trim();
  return s ? `/${s}/` : '';
}

const EXCHANGE_ORDER = ['0', 'p', 'd', 'i', '3', 's', 'r', 't', '1'];

function parseExchange(raw) {
  const out = [];
  for (const part of String(raw || '').split('/')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!value) continue;
    out.push({ type: key, label: EXCHANGE_LABELS[key] || key, value });
  }
  out.sort((a, b) => {
    const ia = EXCHANGE_ORDER.indexOf(a.type);
    const ib = EXCHANGE_ORDER.indexOf(b.type);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return out;
}

function tagList(raw) {
  const tags = String(raw || '').split(/\s+/).filter(Boolean);
  return tags.sort((a, b) => {
    const ia = TAG_ORDER.indexOf(a);
    const ib = TAG_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function firstMeaning(raw) {
  const { main, domain } = splitMeanings(raw);
  const line = main[0] || domain[0] || '';
  return line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 60);
}

function formatRow(row) {
  const data = {
    word: row.word,
    phonetic: row.phonetic,
    phoneticDisplay: normalizePhonetic(row.phonetic),
    meanings: splitMeanings(row.translation),
    definition: uniqueLines(splitLines(row.definition)).slice(0, 6),
    pos: row.pos,
    tags: tagList(row.tag).map((t) => TAG_LABELS[t] || t),
    tagIds: tagList(row.tag),
    frq: row.frq,
    bnc: row.bnc,
    collins: row.collins,
    oxford: row.oxford,
    exchange: parseExchange(row.exchange),
    source: row.source,
  };
  return data;
}

function render(data) {
  const lines = [];
  const head = [`${bold(data.word)}${data.phoneticDisplay ? '  ' + cyan(data.phoneticDisplay) : ''}`];
  lines.push(head[0]);

  const meta = [];
  if (data.tags.length) meta.push(`标签 ${data.tags.map((t) => green(`[${t}]`)).join(' ')}`);
  if (data.frq > 0) meta.push(`当代词频 #${data.frq}`);
  if (data.bnc > 0) meta.push(`BNC #${data.bnc}`);
  if (data.collins > 0) meta.push(`柯林斯 ${yellow('★'.repeat(data.collins))}`);
  if (data.oxford === 1) meta.push(magenta('牛津3000'));
  if (meta.length) lines.push(dim('  ' + meta.join('   ')));

  const { main, domain } = data.meanings;
  if (main.length || domain.length) {
    lines.push('');
    lines.push(bold('释义'));
    for (const line of main) lines.push('  ' + line);
    for (const line of domain.slice(0, 6)) lines.push('  ' + dim(line));
    if (domain.length > 6) lines.push('  ' + dim(`… 另有 ${domain.length - 6} 条专业释义`));
  }

  if (data.definition.length) {
    lines.push('');
    lines.push(bold('英文释义'));
    for (const line of data.definition) lines.push('  ' + line);
  }

  if (data.exchange.length) {
    lines.push('');
    lines.push(bold('词形'));
    lines.push('  ' + data.exchange.map((e) => `${dim(e.label)} ${cyan(e.value)}`).join('  ·  '));
  }

  lines.push('');
  const source =
    data.source === 'ecdict'
      ? 'ECDICT 补录（revised v0.1.1 未收）'
      : 'ecdict-revised v0.1.1 译文 + ECDICT 元数据';
  lines.push(dim(`来源  ${source}`));
  return lines.join('\n');
}

function printSuggestions(query) {
  const q = query.trim();
  if (!q) return;
  let rows = stmtPrefix.all(q + '%');
  if (rows.length === 0) rows = stmtContains.all('%' + q + '%');
  if (rows.length === 0) {
    console.log(`未找到 "${q}"，也没有相近词条。`);
    return;
  }
  console.log(`未找到 "${q}"，你是不是想找：`);
  for (const row of rows) {
    const meaning = firstMeaning(row.translation);
    console.log(`  ${bold(row.word)}` + (meaning ? '  ' + dim(meaning) : ''));
  }
}

function lookup(query, options = {}) {
  const raw = String(query || '').trim();
  if (!raw) return 1;
  const row = stmtExact.get(raw);
  if (!row) {
    if (options.json) console.log(JSON.stringify({ found: false, query: raw }, null, 2));
    else printSuggestions(raw);
    return 2;
  }
  const data = formatRow(row);
  if (options.json) {
    console.log(JSON.stringify({ found: true, ...data }, null, 2));
  } else {
    console.log(render(data));
  }
  return 0;
}

function randomFromTag(tag) {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return 1;
  const row = stmtRandom.get(t);
  if (!row) {
    console.error(`没有带标签 "${t}" 的词（可用: ${TAG_ORDER.join(', ')}）`);
    return 1;
  }
  console.log(dim(`随机抽词 [${TAG_LABELS[t] || t}]`));
  console.log();
  return lookup(row.word);
}

function chineseSearch(text) {
  const q = String(text || '').trim();
  if (!q) return 1;
  const rows = stmtChinese.all(q);
  if (rows.length === 0) {
    console.log(`没有在中文释义中找到 "${q}"。`);
    return 2;
  }
  console.log(`中文释义包含 "${q}" 的词条（最多 15 条）：`);
  for (const row of rows) {
    const tags = tagList(row.tag).map((t) => TAG_LABELS[t] || t);
    const meaning = splitMeanings(row.translation).main[0] || '';
    console.log(
      `  ${bold(row.word.padEnd(18))}${dim(meaning.slice(0, 70))}` + (tags.length ? dim(`  [${tags.join('/')}]`) : ''),
    );
  }
  return 0;
}

function printStats() {
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch {
    /* ignore */
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM words').get().n;
  const revised = db.prepare("SELECT COUNT(*) AS n FROM words WHERE source = 'revised'").get().n;
  const filled = db.prepare("SELECT COUNT(*) AS n FROM words WHERE source = 'ecdict'").get().n;
  console.log(bold('词典数据库'));
  console.log(`  文件      ${DB_PATH}`);
  console.log(`  大小      ${(fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  总词条    ${total.toLocaleString()}`);
  console.log(`  revised   ${revised.toLocaleString()}`);
  console.log(`  ECDICT补录 ${filled.toLocaleString()}`);
  if (meta?.sources) {
    console.log(`  数据源    ECDICT ${meta.sources.ecdict.sha256.slice(0, 12)}… · revised ${meta.sources.revised.sha256.slice(0, 12)}…`);
    console.log(`  构建时间  ${meta.builtAt}`);
  }
  console.log('');
  console.log(bold('考纲标签覆盖'));
  for (const tag of TAG_ORDER) {
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM words WHERE instr(' ' || tag || ' ', ?) > 0")
      .get(` ${tag} `).n;
    console.log(`  ${(TAG_LABELS[tag] || tag).padEnd(6)} ${String(n).padStart(7)}`);
  }
}

function startRepl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '查词> ' });
  console.log(dim('输入英文单词查词；:q / exit 退出；:stats 查看数据库统计。'));
  rl.prompt();
  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();
    if (input === ':q' || input === ':quit' || input === 'exit' || input === 'quit') {
      rl.close();
      return;
    }
    if (input === ':stats') {
      printStats();
      return rl.prompt();
    }
    lookup(input);
    console.log();
    rl.prompt();
  });
  rl.on('close', () => {
    console.log('');
    process.exit(0);
  });
}

function main(argv) {
  const options = { json: false };
  const positional = [];
  let mode = 'lookup';
  let value = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' || arg === '-j') options.json = true;
    else if (arg === '--help' || arg === '-h') mode = 'help';
    else if (arg === '--stats') mode = 'stats';
    else if (arg === '--zh' || arg === '-z') {
      mode = 'zh';
      value = argv[++i];
    } else if (arg === '--random' || arg === '-r') {
      mode = 'random';
      value = argv[++i];
    } else if (arg.startsWith('-')) {
      console.error(`未知参数: ${arg}`);
      mode = 'help';
    } else {
      positional.push(arg);
    }
  }

  if (mode === 'help') {
    console.log(`用法:
  node dict.mjs <word>              精确查词（大小写不敏感）
  node dict.mjs <prefix>            找不到时给出前缀/包含建议
  node dict.mjs --zh <中文>         按中文释义反查
  node dict.mjs --random <tag>      从考纲标签随机抽词 (zk/gk/cet4/cet6/ky/toefl/ielts/gre)
  node dict.mjs --stats             数据库统计
  node dict.mjs --json <word>       JSON 输出
  node dict.mjs                     交互模式

环境变量: DICT_DB=<path> 指定数据库文件。`);
    return 0;
  }
  if (mode === 'stats') {
    printStats();
    return 0;
  }
  if (mode === 'zh') return chineseSearch(value);
  if (mode === 'random') return randomFromTag(value);
  if (positional.length === 0) {
    startRepl();
    return 0;
  }
  return lookup(positional.join(' '), options);
}

process.exitCode = main(process.argv.slice(2));
