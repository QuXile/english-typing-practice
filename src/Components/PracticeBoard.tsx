import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Dictionary, DictionaryEntry } from '../data/dictionary';
import { lookupWord } from '../data/dictionary';
import type {
  Coverage,
  ParsedArticle,
  SkipSettings,
  TypingLine,
  TypingModel,
} from '../utils/text';
import {
  buildTypingModel,
  classifyChar,
  findNextLineWithTargets,
  findPreviousLineWithTargets,
  formatDuration,
} from '../utils/text';
import AppHeader from './AppHeader';
import PracticeSettings from './PracticeSettings';
import WordTip from './WordTip';

export interface SessionSummary {
  /** 源文本字符数（不含换行） */
  totalChars: number;
  /** 需要输入的字符数（排除按设置跳过的字符） */
  requiredChars: number;
  /** 按设置自动跳过的字符数 */
  skippedChars: number;
  /** 已输入的需要输入字符数（含打错的） */
  typedChars: number;
  correctChars: number;
  errors: number;
  elapsedMs: number;
  wpm: number;
  accuracy: number;
}

interface LineState {
  /** 已输入字符，下标与 line.chars 的视觉位置一一对应（包含自动跳过的字符和 ↵） */
  typed: string;
  done: boolean;
}

interface CompletionInfo extends SessionSummary {
  finishedAt: number;
}

export interface PracticeBoardProps {
  article: ParsedArticle;
  dictionary: Dictionary;
  sourceName: string;
  coverage: Coverage;
  skipSettings: SkipSettings;
  onApplySettings: (next: SkipSettings) => void;
  onRestart: () => void;
  onExit: () => void;
}

function leadingSkippedText(line: TypingLine): string {
  let text = '';
  for (const char of line.chars) {
    if (!char.skipped) break;
    text += displaySourceChar(char.char);
  }
  return text;
}

/** 把当前位置之后连续的“跳过字符”自动补进输入值 */
function appendSkippedText(line: TypingLine, typed: string): string {
  let value = typed.slice(0, line.chars.length);
  let position = value.length;
  while (position < line.chars.length && line.chars[position].skipped) {
    value += displaySourceChar(line.chars[position].char);
    position += 1;
  }
  return value;
}

/** 光标附近的单词序号，用于原文单词高亮和释义卡片 */
function wordIndexAtCaret(line: TypingLine, caret: number): number | null {
  const start = Math.max(0, Math.min(caret, line.chars.length - 1));
  if (line.chars[start]?.wordIndex !== null && line.chars[start]?.wordIndex !== undefined) {
    return line.chars[start].wordIndex;
  }
  for (let i = start - 1; i >= 0; i -= 1) {
    if (line.chars[i].wordIndex !== null) return line.chars[i].wordIndex;
  }
  for (let i = start + 1; i < line.chars.length; i += 1) {
    if (line.chars[i].wordIndex !== null) return line.chars[i].wordIndex;
  }
  return null;
}

function aggregateSummary(model: TypingModel, lineStates: LineState[], elapsedMs: number): SessionSummary {
  let typedChars = 0;
  let correctChars = 0;
  let errors = 0;

  model.lines.forEach((line, index) => {
    const state = lineStates[index];
    if (!state) return;

    line.chars.forEach((char, cell) => {
      if (char.skipped) return;
      if (cell >= state.typed.length) return;
      typedChars += 1;
      if (state.typed[cell] === displaySourceChar(char.char)) correctChars += 1;
      else errors += 1;
    });
  });

  const wpm = elapsedMs > 0 ? correctChars / 5 / (elapsedMs / 60000) : 0;
  const accuracy = typedChars > 0 ? correctChars / typedChars : 1;

  return {
    totalChars: model.totalChars,
    requiredChars: model.totalTargets,
    skippedChars: model.skippedChars,
    typedChars,
    correctChars,
    errors,
    elapsedMs,
    wpm,
    accuracy,
  };
}

function displaySourceChar(char: string): string {
  return char === '\n' ? '↵' : char;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function PracticeBoard({
  article,
  dictionary,
  sourceName,
  coverage,
  skipSettings,
  onApplySettings,
  onRestart,
  onExit,
}: PracticeBoardProps) {
  const model = useMemo(() => buildTypingModel(article, skipSettings), [article, skipSettings]);
  const firstLine = useMemo(() => findNextLineWithTargets(model, 0), [model]);

  const [lineIndex, setLineIndex] = useState(() => firstLine);
  const [lineStates, setLineStates] = useState<LineState[]>(() =>
    model.lines.map((line) => ({
      typed: '',
      done: line.targets.length === 0,
    })),
  );
  const [caret, setCaret] = useState(0);
  const [status, setStatus] = useState<'ready' | 'running' | 'finished'>('ready');
  const [focused, setFocused] = useState(true);
  const [cardDismissed, setCardDismissed] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState<{ wordIndex: number; anchor: HTMLElement } | null>(null);
  const [draftSettings, setDraftSettings] = useState<SkipSettings>(skipSettings);
  const [autoAnchor, setAutoAnchor] = useState<HTMLElement | null>(null);
  const [completion, setCompletion] = useState<CompletionInfo | null>(null);

  const lineInputRef = useRef<HTMLInputElement>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const wordRefs = useRef(new Map<number, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);
  const completionRef = useRef<CompletionInfo | null>(null);

  const currentLine = lineIndex >= 0 ? model.lines[lineIndex] : undefined;
  const currentState = lineIndex >= 0 ? lineStates[lineIndex] : undefined;
  const autoWordIndex = currentLine ? wordIndexAtCaret(currentLine, caret) : null;
  const activeWordIndex = pinned?.wordIndex ?? autoWordIndex;
  const activeWord = activeWordIndex !== null ? model.words[activeWordIndex] : undefined;
  const activeEntry: DictionaryEntry | undefined = activeWord
    ? lookupWord(dictionary, activeWord.key)
    : undefined;
  const anchorEl = pinned?.anchor ?? autoAnchor;

  const elapsedMs = startTimeRef.current === null ? 0 : Math.max(0, now - startTimeRef.current);
  const stats = useMemo(
    () => aggregateSummary(model, lineStates, elapsedMs),
    [model, lineStates, elapsedMs],
  );

  useLayoutEffect(() => {
    const input = lineInputRef.current;
    if (!input || !currentLine) return;
    const pending = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    input.focus({ preventScroll: true });
    setFocused(true);
    const typedLength = currentState?.typed.length ?? 0;
    const requested = pending === null ? typedLength : Math.min(pending, typedLength);
    const position = Math.min(requested, input.value.length);
    input.setSelectionRange(position, position);
    setCaret(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIndex]);

  // 自定义输入/自动跳过字符后，把原生光标放到正确的字符位
  useLayoutEffect(() => {
    const input = lineInputRef.current;
    const position = pendingSelectionRef.current;
    if (!input || position === null) return;
    pendingSelectionRef.current = null;
    input.setSelectionRange(position, position);
    setCaret(position);
  }, [lineStates, lineIndex]);

  useLayoutEffect(() => {
    if (pinned) {
      setAutoAnchor(null);
      return;
    }
    const element = autoWordIndex !== null ? wordRefs.current.get(autoWordIndex) ?? null : null;
    setAutoAnchor(element);
  }, [autoWordIndex, lineIndex, caret, pinned]);

  useEffect(() => {
    if (status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (lineIndex <= 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const prev = container.querySelector<HTMLElement>(`[data-line-index="${lineIndex - 1}"]`);
    if (!prev) return;

    const containerRect = container.getBoundingClientRect();
    const prevRect = prev.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const prevOffsetTop = prevRect.top - containerRect.top + currentTop;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const padding = 6;
    const target = Math.max(0, Math.min(maxScroll, prevOffsetTop - padding));

    if (Math.abs(target - currentTop) > 1) {
      container.scrollTo({ top: target, behavior: 'smooth' });
    }
  }, [lineIndex]);

  function focusInput() {
    lineInputRef.current?.focus();
  }

  function markStarted() {
    if (startTimeRef.current !== null) return;
    startTimeRef.current = Date.now();
    setNow(Date.now());
    setStatus('running');
  }

  function finish(finalStates: LineState[]) {
    setLineStates(finalStates);
    if (completionRef.current) return;

    const end = Date.now();
    const start = startTimeRef.current ?? end;
    const summary = aggregateSummary(model, finalStates, Math.max(0, end - start));
    const info: CompletionInfo = { ...summary, finishedAt: end };
    completionRef.current = info;
    setCompletion(info);
    setNow(end);
    setStatus('finished');
  }

  function completeLine(typed: string) {
    if (!currentLine) return;
    markStarted();
    setPinned(null);
    setCardDismissed(false);
    pendingSelectionRef.current = null;

    const nextStates = lineStates.slice();
    nextStates[currentLine.index] = { typed, done: true };
    const nextLine = findNextLineWithTargets(model, currentLine.index + 1);
    if (nextLine < 0) {
      finish(nextStates);
      return;
    }
    setLineStates(nextStates);
    setLineIndex(nextLine);
  }

  function applyTyped(typed: string, selection: number) {
    if (!currentLine) return;
    const value = typed.slice(0, currentLine.chars.length);
    markStarted();
    setPinned(null);
    setCardDismissed(false);

    if (value.length >= currentLine.chars.length) {
      completeLine(value);
      return;
    }

    const nextStates = lineStates.slice();
    nextStates[currentLine.index] = { typed: value, done: false };
    const position = Math.max(0, Math.min(selection, value.length));
    pendingSelectionRef.current = position;
    setLineStates(nextStates);
    setCaret(position);
  }

  /**
   * 统一处理输入：
   * - 第一笔输入时自动补上行首的跳过字符；
   * - 自动补上当前位置后面连续的跳过字符；
   * - 输入长度达到整行视觉字符数后自动进入下一行。
   */
  function normalizeInput(raw: string, caret: number, atEnd: boolean) {
    if (!currentLine) return;
    let typed = raw.slice(0, currentLine.chars.length);
    let position = caret;

    if ((currentState?.typed.length ?? 0) === 0) {
      const prefix = leadingSkippedText(currentLine);
      if (prefix && !typed.startsWith(prefix)) {
        typed = prefix + typed;
        position += prefix.length;
      }
    }

    const beforeAuto = typed.length;
    typed = appendSkippedText(currentLine, typed);
    if (atEnd || position >= beforeAuto) {
      position = typed.length;
    }

    applyTyped(typed, Math.min(position, typed.length));
  }

  function handleNativeInput(value: string, caret: number) {
    if (!currentLine) return;
    normalizeInput(value, caret, caret >= value.length);
  }

  function handleInputSelect() {
    const input = lineInputRef.current;
    if (!input) return;
    setCaret(input.selectionStart ?? 0);
  }

  function activateLine(targetIndex: number, requestedCaret?: number) {
    if (targetIndex === lineIndex || targetIndex < 0 || targetIndex >= model.lines.length) return;
    const targetState = lineStates[targetIndex];
    const targetLength = targetState?.typed.length ?? 0;
    pendingSelectionRef.current =
      requestedCaret === undefined ? targetLength : Math.min(requestedCaret, targetLength);
    setPinned(null);
    setCardDismissed(false);
    setFocused(true);
    setLineIndex(targetIndex);
  }

  function moveLine(direction: -1 | 1) {
    const target =
      direction < 0
        ? findPreviousLineWithTargets(model, lineIndex - 1)
        : findNextLineWithTargets(model, lineIndex + 1);
    if (target < 0) return;
    const requested = lineInputRef.current?.selectionStart ?? currentState?.typed.length ?? 0;
    activateLine(target, requested);
  }

  function goToPreviousLine() {
    if (!currentLine) return;
    const previousLine = findPreviousLineWithTargets(model, lineIndex - 1);
    if (previousLine < 0) return;
    const previousState = lineStates[previousLine];
    const previousLineModel = model.lines[previousLine];
    let previousTyped = previousState?.typed ?? '';
    let position = previousTyped.length;
    do {
      if (position <= 0) break;
      const wasSkipped = Boolean(previousLineModel.chars[position - 1]?.skipped);
      previousTyped = previousTyped.slice(0, position - 1) + previousTyped.slice(position);
      position -= 1;
      if (!wasSkipped) break;
    } while (position > 0);

    const nextStates = lineStates.slice();
    nextStates[previousLine] = {
      typed: previousTyped,
      done: false,
    };
    pendingSelectionRef.current = null;
    setLineStates(nextStates);
    setLineIndex(previousLine);
  }

  function handleBackspace() {
    if (!currentLine) return;
    const input = lineInputRef.current;
    const start = input?.selectionStart ?? 0;
    const end = input?.selectionEnd ?? start;
    const typed = currentState?.typed ?? '';

    if (start !== end) {
      const nextTyped = typed.slice(0, start) + typed.slice(end);
      applyTyped(nextTyped, start);
      return;
    }

    if (start === 0) {
      if (typed.length === 0) goToPreviousLine();
      return;
    }

    // 如果被退格的字符是自动跳过的，继续退格，直到退掉一个正常字符
    let nextTyped = typed;
    let position = start;
    do {
      const index = position - 1;
      if (index < 0) break;
      const wasSkipped = Boolean(currentLine.chars[index]?.skipped);
      nextTyped = nextTyped.slice(0, index) + nextTyped.slice(index + 1);
      position = index;
      if (!wasSkipped) break;
    } while (position > 0);

    applyTyped(nextTyped, position);
  }

  function handleDelete() {
    if (!currentLine) return;
    const input = lineInputRef.current;
    const start = input?.selectionStart ?? 0;
    const end = input?.selectionEnd ?? start;
    const typed = currentState?.typed ?? '';

    if (start === end && start >= typed.length) return;
    const nextTyped = typed.slice(0, start) + typed.slice(end);
    applyTyped(nextTyped, start);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !currentLine) return;

    const input = lineInputRef.current;
    const start = input?.selectionStart ?? 0;
    const end = input?.selectionEnd ?? start;
    const typed = currentState?.typed ?? '';

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveLine(event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (skipSettings.newline) return;
      const raw = typed.slice(0, start) + '↵' + typed.slice(end);
      normalizeInput(raw, start + 1, end >= typed.length);
      return;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      handleBackspace();
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      handleDelete();
      return;
    }

    if (event.key === 'Escape') {
      setPinned(null);
      setCardDismissed(true);
      return;
    }

    if (event.ctrlKey || event.metaKey) return;
    if (event.key.length !== 1) return;

    const category = classifyChar(event.key);
    if (
      category !== 'letter' &&
      category !== 'other' &&
      category !== 'newline' &&
      skipSettings[category]
    ) {
      // 已经设置为跳过的字符会自动填入，不重复接受手动输入
      event.preventDefault();
      return;
    }

    event.preventDefault();
    // 回到已完成的整行修改时，光标处直接覆盖，避免把整行往后挤
    const overwrite =
      typed.length >= currentLine.chars.length && start === end && start < typed.length;
    const raw = overwrite
      ? typed.slice(0, start) + event.key + typed.slice(start + 1)
      : typed.slice(0, start) + event.key + typed.slice(end);
    normalizeInput(raw, start + 1, end >= typed.length);
  }

  function sourceCharClass(line: TypingLine, state: LineState, index: number): string {
    const char = line.chars[index];
    if (char.skipped) return 'source-char source-char--skipped';

    const value = state.typed[index];
    if (value === undefined) return 'source-char';
    return value === displaySourceChar(char.char)
      ? 'source-char source-char--ok'
      : 'source-char source-char--bad';
  }

  function renderSourceChar(line: TypingLine, state: LineState, index: number): ReactNode {
    const char = line.chars[index];
    return (
      <span key={`src-${index}`} className={sourceCharClass(line, state, index)}>
        {displaySourceChar(char.char)}
      </span>
    );
  }

  function renderSourceLine(line: TypingLine, state: LineState): ReactNode[] {
    const nodes: ReactNode[] = [];
    let index = 0;

    while (index < line.chars.length) {
      const char = line.chars[index];
      if (char.wordIndex === null) {
        nodes.push(renderSourceChar(line, state, index));
        index += 1;
        continue;
      }

      const wordIndex = char.wordIndex;
      const chars: ReactNode[] = [];
      while (index < line.chars.length && line.chars[index].wordIndex === wordIndex) {
        chars.push(renderSourceChar(line, state, index));
        index += 1;
      }

      const word = model.words[wordIndex];
      const isCurrentWord = wordIndex === autoWordIndex;
      const isPinned = pinned?.wordIndex === wordIndex;
      nodes.push(
        <span
          key={`word-${wordIndex}`}
          className={`word${isCurrentWord ? ' word--current' : ''}${isPinned ? ' word--pinned' : ''}`}
          ref={(element) => {
            if (element) wordRefs.current.set(wordIndex, element);
            else wordRefs.current.delete(wordIndex);
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            const row = event.currentTarget.closest('.article-row');
            const targetIndex = row ? Number(row.getAttribute('data-line-index')) : -1;
            if (targetIndex >= 0 && targetIndex !== lineIndex) {
              activateLine(targetIndex);
            } else {
              focusInput();
            }
            setPinned({ wordIndex, anchor: event.currentTarget });
            setCardDismissed(false);
          }}
        >
          {chars}
        </span>,
      );
    }

    return nodes;
  }

  if (!currentLine) {
    return (
      <section className="practice">
        <div className="panel article-panel">
          <p className="empty-practice">这篇文章没有可输入的字符。</p>
        </div>
      </section>
    );
  }

  const progress = model.totalTargets > 0 ? (stats.typedChars / model.totalTargets) * 100 : 0;
  const belowEl = anchorEl && anchorEl.isConnected
    ? (anchorEl.closest('.article-row')?.querySelector('.line-input') as HTMLElement | null)
    : null;

  return (
    <div className="app-layout app-layout--practice">
      <main className="app-main app-main--practice">
        <AppHeader compact />

        <div className="practice">
          <div className="practice-toolbar">
            <div className="practice-toolbar__meta">
              <span className="source-name" title={sourceName}>
                {sourceName}
              </span>
              <span className="line-counter">
                第 {lineIndex + 1} / {model.lines.length} 行
              </span>
              <span className="char-counter">
                {stats.typedChars} / {model.totalTargets} 字符
              </span>
              {model.skippedChars > 0 ? (
                <span className="skip-chip">跳过 {model.skippedChars} 字符</span>
              ) : null}
              <span
                className="coverage-chip"
                title={`不重复单词中，有 ${coverage.covered} 个可在词库查到`}
              >
                词库覆盖 {Math.round(coverage.ratio * 100)}%
              </span>
            </div>
          </div>

          <div className="panel article-panel">
            <div
              ref={scrollRef}
              className={`article-lines${focused ? '' : ' article-lines--inactive'}`}
              onClick={() => {
                setPinned(null);
                setCardDismissed(true);
                focusInput();
              }}
              role="presentation"
            >
              {model.lines.map((line) => {
                if (line.text.trim() === '') {
                  return (
                    <div
                      className="article-row article-row--blank"
                      data-line-index={line.index}
                      key={line.index}
                    />
                  );
                }

                const state = lineStates[line.index];
                const isCurrent = line.index === lineIndex;
                const isDone = Boolean(state?.done);
                const max = line.chars.length;

                return (
                  <div
                    className={`article-row${isCurrent ? ' article-row--current' : ''}${
                      isDone ? ' article-row--done' : ''
                    }`}
                    data-line-index={line.index}
                    key={line.index}
                    onClick={(event) => {
                      if (isCurrent) return;
                      event.stopPropagation();
                      const target = event.target as HTMLElement;
                      const clickedInput = target.closest('.line-input') as HTMLInputElement | null;
                      activateLine(line.index, clickedInput?.selectionStart ?? undefined);
                    }}
                  >
                    <div className="source-line">{renderSourceLine(line, state)}</div>
                    <input
                      ref={isCurrent ? lineInputRef : undefined}
                      className={`line-input${isCurrent ? ' line-input--current' : isDone ? ' line-input--done' : ' line-input--pending'}`}
                      type="text"
                      value={state?.typed ?? ''}
                      maxLength={max}
                      readOnly={!isCurrent}
                      tabIndex={isCurrent ? 0 : -1}
                      onChange={
                        isCurrent
                          ? (event) => {
                              const input = event.currentTarget;
                              handleNativeInput(input.value, input.selectionStart ?? input.value.length);
                            }
                          : undefined
                      }
                      onKeyDown={isCurrent ? handleInputKeyDown : undefined}
                      onSelect={isCurrent ? handleInputSelect : undefined}
                      onFocus={isCurrent ? () => setFocused(true) : undefined}
                      onBlur={
                        isCurrent
                          ? () => {
                              setFocused(false);
                              setPinned(null);
                              setCardDismissed(true);
                            }
                          : undefined
                      }
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={isCurrent ? '当前行输入' : '已输入内容'}
                    />
                  </div>
                );
              })}
            </div>

            {!focused ? (
              <button type="button" className="focus-hint" onClick={focusInput}>
                点击文章继续输入
              </button>
            ) : null}
          </div>
        </div>
      </main>

      <aside className="app-sidebar app-sidebar--practice">
        <section className={`sidebar-card sidebar-card--status${completion ? ' sidebar-card--completed' : ''}`}>
          <div className="sidebar-status-head">
            <span className="sidebar-card__eyebrow">TYPING</span>
            <span
              className={`status-pill${completion ? ' status-pill--done' : status === 'running' ? ' status-pill--running' : ''}`}
            >
              {completion ? '已完成' : status === 'running' ? '计时中' : '准备中'}
            </span>
          </div>

          {completion ? (
            <div className="completion-card">
              <div className="completion-card__title">
                <span aria-hidden="true">✓</span>
                打字完成
              </div>
              <p className="completion-card__note">时间与成绩已锁定</p>
              <div className="completion-card__grid">
                <div>
                  <span>用时</span>
                  <strong>{formatDuration(completion.elapsedMs)}</strong>
                </div>
                <div>
                  <span>速度</span>
                  <strong>
                    {Math.round(completion.wpm)}
                    <em>WPM</em>
                  </strong>
                </div>
                <div>
                  <span>正确率</span>
                  <strong>
                    {Math.round(completion.accuracy * 100)}
                    <em>%</em>
                  </strong>
                </div>
                <div>
                  <span>错误</span>
                  <strong>{completion.errors}</strong>
                </div>
              </div>
              <div className="completion-card__foot">
                完成于 {formatClock(completion.finishedAt)}
              </div>
              <p className="completion-card__tip">仍可继续退格修改，或点击单词查词。</p>
            </div>
          ) : (
            <div className="sidebar-stats">
              <div className="sidebar-stat">
                <span>速度</span>
                <strong>{Math.round(stats.wpm)}</strong>
                <em>WPM</em>
              </div>
              <div className="sidebar-stat">
                <span>正确率</span>
                <strong>{Math.round(stats.accuracy * 100)}</strong>
                <em>%</em>
              </div>
              <div className="sidebar-stat">
                <span>用时</span>
                <strong>{formatDuration(elapsedMs)}</strong>
              </div>
              <div className="sidebar-stat">
                <span>错误</span>
                <strong>{stats.errors}</strong>
              </div>
            </div>
          )}

          <div className="sidebar-progress">
            <div className="sidebar-progress__head">
              <span>{completion ? '当前进度' : '进度'}</span>
              <strong>
                {stats.typedChars} / {model.totalTargets}
              </strong>
            </div>
            <div className="progress progress--inline">
              <div className="progress__bar" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
          </div>
        </section>

        <section className="sidebar-card">
          <div className="sidebar-card__head">
            <h2 className="sidebar-card__title">练习设置</h2>
            <span className="sidebar-card__eyebrow">SETTINGS</span>
          </div>
          <p className="sidebar-hint">修改后将从文章开头重新计时。</p>
          <PracticeSettings value={draftSettings} onChange={setDraftSettings} compact />
          <button
            type="button"
            className="button button--ghost sidebar-apply"
            onClick={() => onApplySettings(draftSettings)}
          >
            应用并重新开始
          </button>
        </section>

        <section className="sidebar-card sidebar-card--actions">
          <button type="button" className="button button--ghost" onClick={onRestart}>
            重新开始
          </button>
          <button type="button" className="button button--text" onClick={onExit}>
            换一篇文章
          </button>
        </section>
      </aside>

      <WordTip
        word={activeWord?.text || ''}
        entry={activeEntry}
        anchorEl={anchorEl}
        belowEl={belowEl}
        repositionKey={`${lineIndex}:${caret}:${status}`}
        visible={focused && !cardDismissed && Boolean(anchorEl)}
      />
    </div>
  );
}
