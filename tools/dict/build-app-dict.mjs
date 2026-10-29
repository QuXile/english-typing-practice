#!/usr/bin/env node
/**
 * Generate the compact dictionary used by the web app.
 *
 *   source : tools/dict/data/dict.sqlite  (built by ./build.mjs)
 *   output : src/data/generated/dictionary.json
 *
 * The file has two kinds of nodes:
 *   - headword : { t, p, tags?, frq?, bnc? }
 *   - alias    : { l, p? }  -- an inflected form that resolves to a headword
 *
 * Headwords: single English words with an exam tag, positive frequency,
 * Collins 3+, Oxford 3000, single-letter words, or a reasonably common BNC
 * rank. Aliases cover inflected forms (wrapped -> wrap, went -> go, ...) so
 * articles rarely show "未收录".
 *
 * Requirements: Node.js >= 22.5 (built-in node:sqlite), no npm dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DB_PATH = process.env.DICT_DB || path.join(HERE, 'data', 'dict.sqlite');
const OUT_PATH = path.join(ROOT, 'src', 'data', 'generated', 'dictionary.json');

const TAG_ORDER = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'];
const TAG_SET = new Set(TAG_ORDER);
const WORD_RE = /^[A-Za-z][A-Za-z'\-]*$/;
const DOMAIN_RE = /^\[[^\]]{1,8}\]/;
const FORM_CODES = new Set(['p', 'd', 'i', '3', 's', 'r', 't']);

/** 常见不规则变形；交换字段缺失时兜底（was 在 ECDICT 中没有 0: 链接） */
const MANUAL_FORMS = {
  was: 'be',
  were: 'be',
  am: 'be',
  is: 'be',
  are: 'be',
  been: 'be',
  being: 'be',
  did: 'do',
  does: 'do',
  done: 'do',
  doing: 'do',
  has: 'have',
  had: 'have',
  having: 'have',
};

function die(msg) {
  console.error(`\n[dict:app] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  die(`missing database: ${DB_PATH}\n          run "node tools/dict/build.mjs" first.`);
}

function normalizePhonetic(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\/+|\/+$/g, '');
  s = s.replace(/\u04d9/g, 'ə');
  s = s.replace(/'/g, 'ˈ');
  s = s.replace(/\s+/g, ' ').trim();
  return s ? `/${s}/` : '';
}

function splitLines(raw) {
  return String(raw || '')
    .split(/\\n|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanMeaning(raw) {
  const lines = [];
  const seen = new Set();
  for (const line of splitLines(raw)) {
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  const main = lines.filter((line) => !DOMAIN_RE.test(line));
  // 每个词性一行，前端按换行分行展示
  const picked = (main.length ? main : lines).slice(0, 4);
  return picked.join('\n').slice(0, 200);
}

/** 解析 ECDICT exchange：p 过去式 / d 过去分词 / i 现在分词 / 3 三单 / s 复数 / r 比较级 / t 最高级 / 0 原形 */
function parseExchange(raw) {
  const forms = {};
  let lemma = '';
  for (const part of String(raw || '').split('/')) {
    const index = part.indexOf(':');
    if (index < 0) continue;
    const code = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!value) continue;
    if (code === '0') {
      lemma = value.toLowerCase().replace(/’/g, "'");
    } else if (FORM_CODES.has(code)) {
      forms[code] = value;
    }
  }
  return { forms, lemma };
}

function normalizeTags(raw) {
  const tags = String(raw || '')
    .split(/\s+/)
    .filter((t) => TAG_SET.has(t));
  return [...new Set(tags)].sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

// 1) headwords
const headRows = db.prepare(`
  SELECT word, phonetic, translation, tag, frq, bnc, collins, oxford, exchange
  FROM words
  WHERE word <> ''
    AND word NOT LIKE '% %'
    AND (
      tag <> ''
      OR frq > 0
      OR collins >= 3
      OR oxford = 1
      OR length(word) = 1
      -- 补上只在 BNC 中有排名、但缺 FRQ/标签的常见词（如 an）
      OR (bnc > 0 AND bnc <= 10000)
    )
`).all();

const dictionary = Object.create(null);
const headKeys = new Set();

for (const row of headRows) {
  const word = String(row.word || '').trim();
  if (!WORD_RE.test(word)) continue;
  const key = word.toLowerCase().replace(/’/g, "'");
  if (headKeys.has(key)) continue;

  const meaning = cleanMeaning(row.translation);
  const phonetic = normalizePhonetic(row.phonetic);
  if (!meaning && !phonetic) continue;

  const entry = { t: meaning, p: phonetic };
  const tags = normalizeTags(row.tag);
  if (tags.length) entry.tags = tags;
  if (Number(row.frq) > 0) entry.frq = Number(row.frq);
  if (Number(row.bnc) > 0) entry.bnc = Number(row.bnc);

  const { forms, lemma } = parseExchange(row.exchange);
  if (Object.keys(forms).length > 0) entry.forms = forms;
  if (lemma && lemma !== key) entry.lemma = lemma;
  dictionary[key] = entry;
  headKeys.add(key);
}

// 2) aliases: inflected form -> headword (e.g. went -> go, wrapped -> wrap)
const aliasRows = db.prepare(`
  SELECT word, phonetic, exchange
  FROM words
  WHERE word <> ''
    AND word NOT LIKE '% %'
    AND exchange LIKE '%0:%'
`).all();

let aliasCount = 0;
for (const row of aliasRows) {
  const word = String(row.word || '').trim();
  if (!WORD_RE.test(word)) continue;
  const key = word.toLowerCase().replace(/’/g, "'");
  if (headKeys.has(key) || dictionary[key]) continue;

  const match = String(row.exchange || '').match(/(?:^|\/)0:([^/]+)/);
  if (!match) continue;
  const lemma = match[1].trim().toLowerCase().replace(/’/g, "'");
  if (!lemma || lemma === key || !headKeys.has(lemma)) continue;

  const alias = { l: lemma };
  const phonetic = normalizePhonetic(row.phonetic);
  if (phonetic) alias.p = phonetic;
  dictionary[key] = alias;
  aliasCount += 1;
}

// 3) manual fallback for irregular forms that have no exchange link
const lookupPhonetic = db.prepare('SELECT phonetic FROM words WHERE word = ?');
for (const [form, lemma] of Object.entries(MANUAL_FORMS)) {
  if (dictionary[form] || !headKeys.has(lemma)) continue;
  const row = lookupPhonetic.get(form);
  const alias = { l: lemma };
  const phonetic = normalizePhonetic(row && row.phonetic);
  if (phonetic) alias.p = phonetic;
  dictionary[form] = alias;
  aliasCount += 1;
}

db.close();

const sorted = {};
for (const key of Object.keys(dictionary).sort()) sorted[key] = dictionary[key];
const json = JSON.stringify(sorted);
const gzip = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, json + '\n');

const headCount = Object.keys(sorted).length - aliasCount;
const tagCounts = Object.fromEntries(TAG_ORDER.map((t) => [t, 0]));
let phoneticCount = 0;
for (const entry of Object.values(sorted)) {
  if (entry.p) phoneticCount += 1;
  for (const t of entry.tags || []) tagCounts[t]++;
}

console.log(`[dict:app] done
  output        ${path.relative(ROOT, OUT_PATH)}
  headwords     ${headCount.toLocaleString()}
  aliases       ${aliasCount.toLocaleString()}
  total keys    ${Object.keys(sorted).length.toLocaleString()}
  raw JSON      ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB
  gzip          ${(gzip.length / 1024 / 1024).toFixed(2)} MB
  phonetic      ${phoneticCount.toLocaleString()}
  tags          ${TAG_ORDER.map((t) => `${t}:${tagCounts[t]}`).join('  ')}
`);
