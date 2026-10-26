import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DictionaryEntry, WordFormCode } from '../data/dictionary';
import { TAG_LABELS } from '../data/dictionary';

export interface WordTipProps {
  word: string;
  entry?: DictionaryEntry;
  anchorEl: HTMLElement | null;
  /** 可选：让卡片出现在该元素（通常是原文行 + 手写行的整行）下方 */
  belowEl?: HTMLElement | null;
  /** 任意变化的 key，用于手写行内容变高时重新计算位置 */
  repositionKey?: string | number;
  visible: boolean;
}

interface TipPosition {
  top: number;
  left: number;
  placement: 'below' | 'above';
}

interface TipRow {
  label: string;
  content: ReactNode;
  muted?: boolean;
  stacked?: boolean;
}

const VIEWPORT_PADDING = 12;
const BOUNDARY_PADDING = 6;
const ANCHOR_GAP = 10;

const FORM_LABELS: Array<{ code: WordFormCode; label: string }> = [
  { code: 'p', label: '过去式' },
  { code: 'd', label: '过去分词' },
  { code: 'i', label: '现在分词' },
  { code: '3', label: '第三人称单数' },
  { code: 's', label: '复数' },
  { code: 'r', label: '比较级' },
  { code: 't', label: '最高级' },
];

function buildMeaning(entry?: DictionaryEntry): ReactNode {
  if (!entry || !entry.t) return '未收录';
  const lines = entry.t
    .split(/\r?\n|；/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '未收录';
  return (
    <>
      {lines.map((line, index) => (
        <span className="word-tip__line" key={`${line}-${index}`}>
          {line}
        </span>
      ))}
    </>
  );
}

function buildForms(entry?: DictionaryEntry): ReactNode | null {
  if (!entry) return null;
  const lines: string[] = [];

  if (entry.lemma) {
    lines.push(`原形 ${entry.lemma}`);
  }

  const groups = new Map<string, string[]>();
  for (const { code, label } of FORM_LABELS) {
    const value = entry.forms?.[code];
    if (!value) continue;
    const labels = groups.get(value) || [];
    labels.push(label);
    groups.set(value, labels);
  }
  if (groups.size > 0) {
    lines.push(
      [...groups.entries()]
        .map(([form, labels]) => `${labels.join('/')} ${form}`)
        .join(' · '),
    );
  }

  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line, index) => (
        <span className="word-tip__line" key={`${line}-${index}`}>
          {line}
        </span>
      ))}
    </>
  );
}

function buildRows(entry?: DictionaryEntry): TipRow[] {
  if (!entry) {
    return [
      { label: '释义', content: '未收录', muted: true, stacked: true },
      { label: '音标', content: '—', muted: true },
      { label: '范围', content: '—', muted: true },
      { label: '词频', content: '—', muted: true },
    ];
  }

  const range = (entry.tags || [])
    .map((tag) => TAG_LABELS[tag] || tag)
    .filter(Boolean)
    .join(' · ');

  const frequency: string[] = [];
  if (entry.frq) frequency.push(`当代 #${entry.frq}`);
  if (entry.bnc) frequency.push(`BNC #${entry.bnc}`);

  const rows: TipRow[] = [
    { label: '释义', content: buildMeaning(entry), stacked: true },
    { label: '音标', content: entry.p ? entry.p : '—' },
  ];

  const forms = buildForms(entry);
  if (forms) {
    // 变形关系放在音标和范围之间
    rows.push({ label: '变形', content: forms, stacked: true });
  }

  rows.push(
    { label: '范围', content: range || '未标注考纲' },
    { label: '词频', content: frequency.join(' · ') || '暂无' },
  );
  return rows;
}

/** 当前单词下方 / 上方的词义悬浮卡；卡片始终限制在文章区域内 */
export default function WordTip({ word, entry, anchorEl, belowEl, repositionKey, visible }: WordTipProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<TipPosition | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorEl) {
      setPosition(null);
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const card = cardRef.current;
      if (!card || !anchorEl.isConnected) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const width = cardRect.width || 300;
      const height = cardRect.height || 150;

      // 卡片约束在文章滚动区域内，避免盖住顶部标题/信息栏
      const boundaryEl = anchorEl.closest('.article-lines') as HTMLElement | null;
      const boundaryRect = boundaryEl?.getBoundingClientRect();
      const minTop = boundaryRect ? boundaryRect.top + BOUNDARY_PADDING : VIEWPORT_PADDING;
      const maxBottom = boundaryRect
        ? boundaryRect.bottom - BOUNDARY_PADDING
        : window.innerHeight - VIEWPORT_PADDING;

      // 逐行模式里词的上方是原文、下方是手写行：只有手写行紧贴该词所在行时才
      // 把卡片放到手写行下方；否则直接放在单词下方，避免卡片跑到很远的地方。
      const belowRect = belowEl?.getBoundingClientRect();
      const nearTypedLine = belowRect ? belowRect.top - anchorRect.bottom <= 64 : false;
      const anchorBottom = nearTypedLine && belowRect
        ? Math.max(anchorRect.bottom, belowRect.bottom)
        : anchorRect.bottom;

      const belowTop = anchorBottom + ANCHOR_GAP;
      const aboveTop = anchorRect.top - height - ANCHOR_GAP;
      const belowFits = belowTop + height <= maxBottom;
      const aboveFits = aboveTop >= minTop;

      let placement: 'below' | 'above' = 'below';
      let top = belowTop;
      if (belowFits) {
        placement = 'below';
        top = belowTop;
      } else if (aboveFits) {
        placement = 'above';
        top = aboveTop;
      } else {
        // 两边都放不下时，优先选空间更大的一侧，再夹到文章区域内部
        const spaceBelow = maxBottom - anchorBottom;
        const spaceAbove = anchorRect.top - minTop;
        if (spaceBelow >= spaceAbove) {
          placement = 'below';
          top = belowTop;
        } else {
          placement = 'above';
          top = aboveTop;
        }
      }
      top = Math.max(minTop, Math.min(top, maxBottom - height));

      let left = anchorRect.left + anchorRect.width / 2 - width / 2;
      left = Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - width - VIEWPORT_PADDING));

      setPosition((prev) => {
        if (
          prev &&
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.left - left) < 0.5 &&
          prev.placement === placement
        ) {
          return prev;
        }
        return { top, left, placement };
      });
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [anchorEl, belowEl, repositionKey, visible, word, entry]);

  if (!visible || !anchorEl) return null;

  const rows = buildRows(entry);
  // 卡片翻到单词上方时，离输入位置最近的变成最下面一行，所以整体顺序反转
  const orderedRows = position?.placement === 'above' ? [...rows].reverse() : rows;

  return (
    <div
      ref={cardRef}
      className="word-tip"
      role="status"
      aria-live="polite"
      aria-label={`${word} 的释义卡片`}
      style={{
        top: position ? `${position.top}px` : '-9999px',
        left: position ? `${position.left}px` : '-9999px',
        opacity: position ? 1 : 0,
      }}
    >
      {orderedRows.map((row) => (
        <div className="word-tip__row" key={row.label}>
          <span className="word-tip__label">{row.label}</span>
          <span
            className={`word-tip__value${row.stacked ? ' word-tip__value--stacked' : ''}${
              row.muted ? ' word-tip__value--muted' : ''
            }`}
          >
            {row.content}
          </span>
        </div>
      ))}
    </div>
  );
}
