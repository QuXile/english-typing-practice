#!/usr/bin/env node
/**
 * Build a merged dictionary SQLite database.
 *
 *   base      : ecdict-revised v0.1.1  (word / phonetic / translation)
 *   joined    : ECDICT                 (tag / frq / bnc / collins / oxford / exchange / definition / pos)
 *   filled-back: ECDICT entries that revised does not contain
 *
 * Output: tools/dict/data/dict.sqlite  (+ build-meta.json)
 *
 * Requirements: Node.js >= 22.5 (built-in node:sqlite), no npm dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const DATA = path.join(HERE, 'data');
const ECDICT_CSV = process.env.ECDICT_CSV || path.join(CACHE, 'ecdict.csv');
const REVISED_CSV = process.env.REVISED_CSV || path.join(CACHE, 'revised', 'data', 'entries.csv');
const OUT_DB = path.join(DATA, 'dict.sqlite');
const OUT_META = path.join(DATA, 'build-meta.json');

const EXAM_TAGS = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts'];
const EXAM_TAG_SET = new Set(EXAM_TAGS);

function die(msg) {
  console.error(`\n[build] ${msg}\n`);
  process.exit(1);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Minimal streaming-free CSV parser that handles quoted fields,
 * escaped quotes ("") and embedded newlines. ECDICT fields use
 * literal "\n" mostly, but revised keeps real newlines inside quotes.
 */
function parseCsvFile(file, onRow) {
  const text = fs.readFileSync(file, 'utf8');
  const len = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row = [];
  let field = '';
  let inQuotes = false;

  for (; i < len; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    switch (c) {
      case '"':
        inQuotes = true;
        break;
      case ',':
        row.push(field);
        field = '';
        break;
      case '\n':
        row.push(field);
        field = '';
        onRow(row);
        row = [];
        break;
      case '\r':
        break;
      default:
        field += c;
    }
  }
  if (row.length > 0 || field !== '') {
    row.push(field);
    onRow(row);
  }
}

function asInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

for (const [label, file] of [
  ['ECDICT CSV', ECDICT_CSV],
  ['revised entries.csv', REVISED_CSV],
]) {
  if (!fs.existsSync(file)) {
    die(`missing ${label}: ${file}\n       run ./fetch-data.sh first (or set ECDICT_CSV / REVISED_CSV).`);
  }
}

fs.mkdirSync(DATA, { recursive: true });
if (fs.existsSync(OUT_DB)) fs.rmSync(OUT_DB);

console.log('[build] reading sources...');
const sources = {
  ecdict: { file: path.relative(HERE, ECDICT_CSV), bytes: fs.statSync(ECDICT_CSV).size, sha256: sha256(ECDICT_CSV) },
  revised: { file: path.relative(HERE, REVISED_CSV), bytes: fs.statSync(REVISED_CSV).size, sha256: sha256(REVISED_CSV) },
};

const db = new DatabaseSync(OUT_DB);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -100000;
  CREATE TABLE words (
    word       TEXT PRIMARY KEY COLLATE NOCASE,
    phonetic   TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    definition TEXT NOT NULL DEFAULT '',
    pos        TEXT NOT NULL DEFAULT '',
    tag        TEXT NOT NULL DEFAULT '',
    bnc        INTEGER NOT NULL DEFAULT 0,
    frq        INTEGER NOT NULL DEFAULT 0,
    collins    INTEGER NOT NULL DEFAULT 0,
    oxford     INTEGER NOT NULL DEFAULT 0,
    exchange   TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'revised'
  ) WITHOUT ROWID;
`);

const insertStmt = db.prepare(`
  INSERT INTO words (word, phonetic, translation, definition, pos, tag, bnc, frq, collins, oxford, exchange, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const findStmt = db.prepare(`SELECT word FROM words WHERE word = ?`);
const updateStmt = db.prepare(`
  UPDATE words SET
    definition = ?, pos = ?, tag = ?, bnc = ?, frq = ?,
    collins = ?, oxford = ?, exchange = ?,
    phonetic = CASE WHEN phonetic = '' THEN ? ELSE phonetic END
  WHERE word = ?
`);

const stats = {
  revisedEntries: 0,
  ecdictRows: 0,
  joined: 0,
  filledBack: 0,
  examWordsFilledBack: 0,
  examTagCounts: Object.fromEntries(EXAM_TAGS.map((t) => [t, 0])),
  examWords: 0,
  skipped: 0,
};

// 1) revised is the base layer.
db.exec('BEGIN');
{
  let header = true;
  parseCsvFile(REVISED_CSV, (f) => {
    if (header) {
      header = false;
      return;
    }
    if (f.length < 3) {
      stats.skipped++;
      return;
    }
    const word = (f[0] || '').trim();
    if (!word) {
      stats.skipped++;
      return;
    }
    insertStmt.run(word, (f[1] || '').trim(), f[2] || '', '', '', '', 0, 0, 0, 0, '', 'revised');
    stats.revisedEntries++;
  });
}

// 2) ECDICT supplies metadata; missing entries are filled back.
{
  let header = true;
  parseCsvFile(ECDICT_CSV, (f) => {
    if (header) {
      header = false;
      return;
    }
    if (f.length < 11) {
      stats.skipped++;
      return;
    }
    const word = (f[0] || '').trim();
    if (!word) {
      stats.skipped++;
      return;
    }
    const phonetic = (f[1] || '').trim();
    const definition = f[2] || '';
    const translation = f[3] || '';
    const pos = (f[4] || '').trim();
    const collins = asInt(f[5]);
    const oxford = asInt(f[6]);
    const tag = (f[7] || '').trim();
    const bnc = asInt(f[8]);
    const frq = asInt(f[9]);
    const exchange = (f[10] || '').trim();

    const tags = tag.split(/\s+/).filter(Boolean);
    const hasExamTag = tags.some((t) => EXAM_TAG_SET.has(t));
    if (hasExamTag) stats.examWords++;
    for (const t of tags) if (EXAM_TAG_SET.has(t)) stats.examTagCounts[t]++;

    const existing = findStmt.get(word);
    if (existing) {
      updateStmt.run(definition, pos, tag, bnc, frq, collins, oxford, exchange, phonetic, word);
      stats.joined++;
    } else {
      insertStmt.run(word, phonetic, translation, definition, pos, tag, bnc, frq, collins, oxford, exchange, 'ecdict');
      stats.filledBack++;
      if (hasExamTag) stats.examWordsFilledBack++;
    }
    stats.ecdictRows++;
  });
}

db.exec('COMMIT');
db.exec('VACUUM');
const total = db.prepare('SELECT COUNT(*) AS n FROM words').get().n;
db.close();

const meta = {
  builtAt: new Date().toISOString(),
  node: process.version,
  sources,
  merge: {
    base: 'ecdict-revised v0.1.1',
    supplemental: 'ECDICT master (ecdict.csv)',
    revisedEntries: stats.revisedEntries,
    ecdictRows: stats.ecdictRows,
    metadataJoined: stats.joined,
    filledBack: stats.filledBack,
    examWordsFilledBack: stats.examWordsFilledBack,
    totalWords: total,
    skipped: stats.skipped,
    examTagCounts: stats.examTagCounts,
    examWords: stats.examWords,
    examTags: EXAM_TAGS,
  },
};
fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));

const sizeMb = (fs.statSync(OUT_DB).size / 1024 / 1024).toFixed(1);
console.log(`
[build] done
  revised base           ${stats.revisedEntries.toLocaleString()} entries
  ECDICT rows            ${stats.ecdictRows.toLocaleString()}
    metadata joined      ${stats.joined.toLocaleString()}
    filled back          ${stats.filledBack.toLocaleString()}
      exam-tag words     ${stats.examWordsFilledBack.toLocaleString()}  (中考/高考/四六级/考研/托福/雅思)
  total words            ${total.toLocaleString()}
  exam words (any tag)   ${stats.examWords.toLocaleString()}
  skipped rows           ${stats.skipped.toLocaleString()}
  database               ${OUT_DB}  (${sizeMb} MB)
  meta                   ${OUT_META}
`);
