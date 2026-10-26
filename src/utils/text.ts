export interface WordToken {
  /** 展示/查词文本，弯撇号已统一为直撇号 */
  text: string;
  /** 小写查词 key */
  key: string;
  /** 全文中的单词序号 */
  index: number;
}

export type ArticleToken =
  | { kind: 'word'; word: WordToken }
  | { kind: 'gap'; text: string };

export interface ArticleLine {
  /** 行号（从 0 开始） */
  index: number;
  /** 行文本（不含换行） */
  text: string;
  tokens: ArticleToken[];
}

export interface ParsedArticle {
  lines: ArticleLine[];
  words: WordToken[];
  /** 所有行的字符数之和（不含换行） */
  charCount: number;
}

export const MAX_ARTICLE_WORDS = 20000;
export const MAX_ARTICLE_CHARS = 500000;

const WORD_RE = /[A-Za-z]+(?:['\-][A-Za-z]+)*/g;
const DEFAULT_MAX_LINE_CHARS = 74;

/**
 * 根据当前窗口宽度估算“一行最多能放多少个等宽字符”。
 * 原文行和手写行必须保持单行不折行，字符才能一一对齐。
 */
export function getArticleMaxChars(viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth): number {
  const pagePadding = viewportWidth <= 780 ? 32 : 48;
  const panelPadding = viewportWidth <= 780 ? 44 : 64;
  // 每行左侧要为当前行竖线/缩进预留空位
  const rowPadding = viewportWidth <= 780 ? 12 : 16;
  const content = Math.min(viewportWidth, 980) - pagePadding - panelPadding - rowPadding;
  // 18px 等宽字体单字符约 10.8px；额外留出几个字符给行尾空格/标点
  return Math.max(20, Math.min(74, Math.floor((content - 40) / 10.8)));
}

export function normalizeApostrophes(text: string): string {
  return text.replace(/’/g, "'");
}

/** 行/字符相关的统一规范化：BOM、换行、NBSP、弯撇号 */
export function normalizeArticleText(raw: string): string {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/’/g, "'");
}

/**
 * 把文章解析成「行 -> token」结构。空行保留；首尾空行去掉。
 * 行内空格、标点、缩进都原样保留，用于逐行对照输入。
 * 由于原文行和手写行需要单行对齐，过长的原始行会按 token 边界再切成多行。
 */
export function parseArticle(raw: string, maxChars = DEFAULT_MAX_LINE_CHARS): ParsedArticle {
  const normalized = normalizeArticleText(raw);
  const rawLines = normalized.split('\n');
  let start = 0;
  let end = rawLines.length;
  while (start < end && rawLines[start].trim() === '') start += 1;
  while (end > start && rawLines[end - 1].trim() === '') end -= 1;

  const lines: ArticleLine[] = [];
  const words: WordToken[] = [];
  let charCount = 0;

  const tokenText = (token: ArticleToken): string =>
    token.kind === 'word' ? token.word.text : token.text;

  const splitRowTokens = (lineTokens: ArticleToken[]): ArticleToken[][] => {
    const rows: ArticleToken[][] = [];
    let current: ArticleToken[] = [];
    let length = 0;

    const flush = () => {
      if (current.length > 0) {
        rows.push(current);
        current = [];
        length = 0;
      }
    };

    for (const token of lineTokens) {
      const text = tokenText(token);
      if (current.length > 0 && length + text.length > maxChars) {
        if (token.kind === 'gap') {
          // 行尾的空格/标点跟随本行，下一行从单词开始，避免行首出现空白
          current.push(token);
          length += text.length;
          flush();
          continue;
        }
        flush();
      }
      current.push(token);
      length += text.length;
      if (token.kind === 'gap' && length >= maxChars) flush();
    }
    flush();
    return rows;
  };

  for (let i = start; i < end; i += 1) {
    const lineText = rawLines[i];
    charCount += lineText.length;

    const lineTokens: ArticleToken[] = [];
    let last = 0;
    WORD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_RE.exec(lineText))) {
      if (match.index > last) {
        lineTokens.push({ kind: 'gap', text: lineText.slice(last, match.index) });
      }
      const word: WordToken = {
        text: match[0],
        key: match[0].toLowerCase(),
        index: words.length,
      };
      words.push(word);
      lineTokens.push({ kind: 'word', word });
      last = match.index + match[0].length;
    }
    if (last < lineText.length) {
      lineTokens.push({ kind: 'gap', text: lineText.slice(last) });
    }

    if (lineTokens.length === 0) {
      lines.push({ index: lines.length, text: '', tokens: [] });
      continue;
    }

    for (const rowTokens of splitRowTokens(lineTokens)) {
      const rowText = rowTokens.map(tokenText).join('');
      lines.push({ index: lines.length, text: rowText, tokens: rowTokens });
    }
  }

  return { lines, words, charCount };
}

/** 字符分类，用于四个跳过设置的判定 */
export type CharCategory = 'letter' | 'space' | 'punct' | 'digit' | 'other';

export interface SkipSettings {
  space: boolean;
  punct: boolean;
  digit: boolean;
  other: boolean;
}

export const DEFAULT_SKIP_SETTINGS: SkipSettings = {
  space: false,
  punct: false,
  digit: false,
  other: false,
};

const SPACE_RE = /^\s$/;
const DIGIT_RE = /^\p{Nd}$/u;
const UNICODE_PUNCT_RE = /^\p{P}$/u;

function isAsciiPunct(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
}

export function classifyChar(char: string): CharCategory {
  const code = char.codePointAt(0) ?? 0;
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return 'letter';
  if (SPACE_RE.test(char)) return 'space';
  if (DIGIT_RE.test(char)) return 'digit';
  if (code < 128 ? isAsciiPunct(code) : UNICODE_PUNCT_RE.test(char)) return 'punct';
  return 'other';
}

export function shouldSkipCategory(category: CharCategory, skip: SkipSettings): boolean {
  if (category === 'letter') return false;
  return skip[category];
}

export interface TypingChar {
  char: string;
  category: CharCategory;
  skipped: boolean;
  /** 需要输入的字符在 targets 里的下标；跳过字符为 null */
  targetIndex: number | null;
  /** 所属单词的全局序号；gap 字符为 null */
  wordIndex: number | null;
  /** 该字符前面有多少个需要输入的字符（用于判断跳过字符是否已经越过） */
  requiredBefore: number;
}

export interface TypingTarget {
  char: string;
  category: CharCategory;
  wordIndex: number | null;
  /** 当前光标在这个字符时的“当前词”：字符所在词，或前面的词/后面的词 */
  activeWordIndex: number | null;
}

export interface TypingLine {
  index: number;
  text: string;
  tokens: ArticleToken[];
  chars: TypingChar[];
  targets: TypingTarget[];
  skippedCount: number;
}

export interface TypingModel {
  lines: TypingLine[];
  words: WordToken[];
  totalChars: number;
  totalTargets: number;
  skippedChars: number;
}

export function buildTypingModel(article: ParsedArticle, skip: SkipSettings): TypingModel {
  const lines: TypingLine[] = [];
  let totalTargets = 0;
  let skippedChars = 0;

  for (const line of article.lines) {
    const forceBlank = line.text.trim() === '';
    const chars: TypingChar[] = [];
    const targets: TypingTarget[] = [];
    const targetPositions: number[] = [];
    const wordIndexes: Array<number | null> = [];
    let requiredBefore = 0;

    const pushChar = (char: string, wordIndex: number | null) => {
      const category = classifyChar(char);
      const skipped = forceBlank || shouldSkipCategory(category, skip);
      const targetIndex = skipped ? null : requiredBefore;
      chars.push({ char, category, skipped, targetIndex, wordIndex, requiredBefore });
      wordIndexes.push(wordIndex);
      if (skipped) {
        skippedChars += 1;
      } else {
        targetPositions.push(chars.length - 1);
        targets.push({ char, category, wordIndex, activeWordIndex: null });
        requiredBefore += 1;
      }
    };

    for (const token of line.tokens) {
      if (token.kind === 'word') {
        for (const char of token.word.text) pushChar(char, token.word.index);
      } else {
        for (const char of token.text) pushChar(char, null);
      }
    }

    // 计算每个 target 对应的“当前词”：优先向前找同行的词，行内没有前词再向后找
    for (let t = 0; t < targets.length; t += 1) {
      const position = targetPositions[t];
      let active: number | null = null;
      for (let k = position; k >= 0; k -= 1) {
        if (wordIndexes[k] !== null) {
          active = wordIndexes[k];
          break;
        }
      }
      if (active === null) {
        for (let k = position; k < wordIndexes.length; k += 1) {
          if (wordIndexes[k] !== null) {
            active = wordIndexes[k];
            break;
          }
        }
      }
      targets[t].activeWordIndex = active;
    }

    lines.push({
      index: line.index,
      text: line.text,
      tokens: line.tokens,
      chars,
      targets,
      skippedCount: chars.length - targets.length,
    });
    totalTargets += targets.length;
  }

  return {
    lines,
    words: article.words,
    totalChars: article.charCount,
    totalTargets,
    skippedChars,
  };
}

export function findNextLineWithTargets(model: TypingModel, from: number): number {
  for (let i = Math.max(0, from); i < model.lines.length; i += 1) {
    if (model.lines[i].targets.length > 0) return i;
  }
  return -1;
}

export function findPreviousLineWithTargets(model: TypingModel, from: number): number {
  for (let i = Math.min(from, model.lines.length - 1); i >= 0; i -= 1) {
    if (model.lines[i].targets.length > 0) return i;
  }
  return -1;
}

export interface Coverage {
  total: number;
  covered: number;
  ratio: number;
}

/** 文章里「不重复单词」在词典里的覆盖率，用于开始前提示 */
export function countCoverage(words: WordToken[], dictionary: Record<string, unknown>): Coverage {
  const unique = new Set(words.map((word) => word.key));
  let covered = 0;
  for (const key of unique) {
    if (dictionary[key]) covered += 1;
  }
  return {
    total: unique.size,
    covered,
    ratio: unique.size ? covered / unique.size : 0,
  };
}

/** 展示用：已用时间 mm:ss */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
