export type WordFormCode = 'p' | 'd' | 'i' | '3' | 's' | 'r' | 't';

/** 变形关系：p 过去式 / d 过去分词 / i 现在分词 / 3 三单 / s 复数 / r 比较级 / t 最高级 */
export type WordForms = Partial<Record<WordFormCode, string>>;

export interface DictionaryEntry {
  /** 中文释义，已清洗并合并 */
  t: string;
  /** 规范化音标，形如 /əˈbændən/ */
  p: string;
  /** 考纲标签：zk/gk/cet4/cet6/ky/toefl/ielts/gre */
  tags?: string[];
  /** 当代语料库词频顺序 */
  frq?: number;
  /** BNC 词频顺序 */
  bnc?: number;
  /** 单词变形关系 */
  forms?: WordForms;
  /** 该词是变形词时，指向的原形 */
  lemma?: string;
}

/** 变形词节点，指向原形词条 */
export interface DictionaryAlias {
  l: string;
  p?: string;
}

export type DictionaryNode = DictionaryEntry | DictionaryAlias;

export type Dictionary = Record<string, DictionaryNode>;

export const TAG_ORDER = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'] as const;

export const TAG_LABELS: Record<string, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

let dictionaryPromise: Promise<Dictionary> | null = null;

/**
 * 动态加载生成的词典 chunk（约 1.8MB gzip），首次点击“开始练习”时触发。
 * 加载失败时清空缓存，允许重试。
 */
export function loadDictionary(): Promise<Dictionary> {
  if (!dictionaryPromise) {
    dictionaryPromise = import('./generated/dictionary.json')
      .then((module) => {
        const data = (module as unknown as { default?: Dictionary }).default ?? (module as unknown as Dictionary);
        return data as Dictionary;
      })
      .catch((error) => {
        dictionaryPromise = null;
        throw error;
      });
  }
  return dictionaryPromise;
}

function isAlias(node: DictionaryNode): node is DictionaryAlias {
  return 'l' in node;
}

/**
 * 查询单词。变形词（wrapped / went / was ...）会自动回退到原形词条，
 * 音标仍使用变形词自己的音标。
 */
export function lookupWord(dictionary: Dictionary, word: string): DictionaryEntry | undefined {
  const key = word.toLowerCase().replace(/’/g, "'");
  const node = dictionary[key];
  if (!node) return undefined;
  if (!isAlias(node)) return node;

  const base = dictionary[node.l];
  if (!base || isAlias(base)) return undefined;
  return { ...base, p: node.p || base.p, lemma: node.l };
}
