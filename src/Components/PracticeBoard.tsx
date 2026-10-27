import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Dictionary, DictionaryEntry } from '../data/dictionary';
import { lookupWord } from '../data/dictionary';
import type {
  ArticleToken,
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
  /** 下标对应 line.targets 下标；null 表示这个目标格还没输入 */
  values: Array<string | null>;
  done: boolean;
}

export interface PracticeBoardProps {
  article: ParsedArticle;
  dictionary: Dictionary;
  sourceName: string;
  coverage: Coverage;
  skipSettings: SkipSettings;
  onApplySettings: (next: SkipSettings) => void;
  onFinish: (summary: SessionSummary) => void;
  onRestart: () => void;
  onExit: () => void;
}

function aggregateSummary(model: TypingModel, lineStates: LineState[], elapsedMs: number): SessionSummary {
  let typedChars = 0;
  let correctChars = 0;
  let errors = 0;

  model.lines.forEach((line, index) => {
    const values = lineStates[index]?.values ?? [];
    line.targets.forEach((target, targetIndex) => {
      const value = values[targetIndex];
      if (value === null || value === undefined) return;
      typedChars += 1;
      if (value === target.char) correctChars += 1;
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

function emptyValues(line: TypingLine): Array<string | null> {
  return line.targets.map(() => null);
}

/** 从视觉格 from 开始找下一个可编辑目标格 */
function nextTargetCell(line: TypingLine, from: number): number | null {
  for (let cell = Math.max(0, from); cell < line.chars.length; cell += 1) {
    if (line.chars[cell].targetIndex !== null) return cell;
  }
  return null;
}

/** 从视觉格 from 开始向前找上一个可编辑目标格 */
function previousTargetCell(line: TypingLine, from: number): number | null {
  for (let cell = Math.min(from, line.chars.length - 1); cell >= 0; cell -= 1) {
    if (line.chars[cell].targetIndex !== null) return cell;
  }
  return null;
}

function firstPendingCell(line: TypingLine, values: Array<string | null>): number {
  for (let cell = 0; cell < line.chars.length; cell += 1) {
    const targetIndex = line.chars[cell].targetIndex;
    if (targetIndex !== null && values[targetIndex] === null) return cell;
  }
  return line.chars.length;
}

function newlineCell(line: TypingLine): number {
  return line.chars.findIndex((char) => char.char === '\n');
}

function clearTargetsInRange(
  line: TypingLine,
  values: Array<string | null>,
  start: number,
  end: number,
): Array<string | null> {
  const next = values.slice();
  for (let cell = Math.max(0, start); cell < Math.min(end, line.chars.length); cell += 1) {
    const targetIndex = line.chars[cell].targetIndex;
    if (targetIndex !== null) next[targetIndex] = null;
  }
  return next;
}

function displayTypingChar(value: string): string {
  return value === '\n' ? '↵' : value;
}

export default function PracticeBoard({
  article,
  dictionary,
  sourceName,
  coverage,
  skipSettings,
  onApplySettings,
  onFinish,
  onRestart,
  onExit,
}: PracticeBoardProps) {
  const model = useMemo(() => buildTypingModel(article, skipSettings), [article, skipSettings]);
  const firstLine = useMemo(() => findNextLineWithTargets(model, 0), [model]);

  const [lineIndex, setLineIndex] = useState(() => firstLine);
  const [lineStates, setLineStates] = useState<LineState[]>(() =>
    model.lines.map((line) => ({ values: emptyValues(line), done: line.targets.length === 0 })),
  );
  const [caret, setCaret] = useState(0);
  const [status, setStatus] = useState<'ready' | 'running' | 'finished'>('ready');
  const [focused, setFocused] = useState(true);
  const [cardDismissed, setCardDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState<{ wordIndex: number; anchor: HTMLElement } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<SkipSettings>(skipSettings);
  const [autoAnchor, setAutoAnchor] = useState<HTMLElement | null>(null);

  const lineInputRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const wordRefs = useRef(new Map<number, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);

  const currentLine = lineIndex >= 0 ? model.lines[lineIndex] : undefined;
  const currentState = lineIndex >= 0 ? lineStates[lineIndex] : undefined;
  const currentValues = currentState?.values ?? [];

  const caretCell = currentLine ? nextTargetCell(currentLine, caret) : null;
  const currentTarget =
    currentLine && caretCell !== null
      ? currentLine.targets[currentLine.chars[caretCell].targetIndex as number]
      : undefined;
  const autoWordIndex = currentTarget?.activeWordIndex ?? null;
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
    if (pinned) {
      setAutoAnchor(null);
      return;
    }
    const element = autoWordIndex !== null ? wordRefs.current.get(autoWordIndex) ?? null : null;
    setAutoAnchor(element);
  }, [autoWordIndex, lineIndex, caret, pinned]);

  // 行切换/首次挂载时聚焦当前行的原生 input，并放置光标
  useLayoutEffect(() => {
    if (!currentLine) return;
    const input = lineInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });

    let cell = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (cell === null) {
      cell = firstPendingCell(currentLine, currentValues);
    }
    cell = Math.max(0, Math.min(cell, currentLine.chars.length));
    input.setSelectionRange(cell, cell);
    setCaret(cell);
    // 只在换行时重新定位；行内编辑时由各操作自己维护 selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIndex]);

  useEffect(() => {
    if (status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'finished') return;
    const container = scrollRef.current;
    if (!container) return;

    if (lineIndex <= 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // 完成一行后，把刚完成的行滚到顶部，当前行自然落在它下面一行：
    // 每完成一行只滚动一行，同时始终保留“上一行 + 当前行”可见。
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
  }, [lineIndex, status]);

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
    const end = Date.now();
    const start = startTimeRef.current ?? end;
    const summary = aggregateSummary(model, finalStates, Math.max(0, end - start));
    setLineStates(finalStates);
    setNow(end);
    setStatus('finished');
    onFinish(summary);
  }

  function setInputCaret(cell: number) {
    const input = lineInputRef.current;
    if (!input) return;
    const safe = Math.max(0, Math.min(cell, input.value.length));
    input.setSelectionRange(safe, safe);
    setCaret(safe);
  }

  function updateCurrentValues(values: Array<string | null>) {
    const nextStates = lineStates.slice();
    nextStates[lineIndex] = { values, done: false };
    setLineStates(nextStates);
  }

  function completeCurrentLine(values: Array<string | null>) {
    if (!currentLine) return;
    markStarted();
    setPinned(null);
    setCardDismissed(false);

    const nextStates = lineStates.slice();
    nextStates[currentLine.index] = { values, done: true };

    const nextLine = findNextLineWithTargets(model, currentLine.index + 1);
    if (nextLine < 0) {
      finish(nextStates);
      return;
    }

    setLineStates(nextStates);
    setLineIndex(nextLine);
  }

  function handlePrintableChar(char: string) {
    if (!currentLine || status === 'finished') return;
    const input = lineInputRef.current;
    const start = input?.selectionStart ?? caret;
    const end = input?.selectionEnd ?? start;
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);
    let values = currentValues.slice();

    if (selectionEnd > selectionStart) {
      values = clearTargetsInRange(currentLine, values, selectionStart, selectionEnd);
    }

    const cell = nextTargetCell(currentLine, selectionStart);
    if (cell === null) return;
    const targetIndex = currentLine.chars[cell].targetIndex;
    if (targetIndex === null) return;
    const target = currentLine.targets[targetIndex];
    if (target.char === '\n') return;

    values[targetIndex] = char;

    const nextCell = nextTargetCell(currentLine, cell + 1);
    const nextCaret = nextCell === null ? currentLine.chars.length : nextCell;
    const newlineTarget = newlineCell(currentLine);
    const textFilled = currentLine.targets.every(
      (item, index) => item.char === '\n' || values[index] !== null,
    );
    const complete = values.every((value) => value !== null);

    markStarted();
    setPinned(null);
    setCardDismissed(false);

    if (complete) {
      completeCurrentLine(values);
      return;
    }

    updateCurrentValues(values);
    setInputCaret(newlineTarget >= 0 && textFilled ? newlineTarget : nextCaret);
  }

  function handleBackspace() {
    if (!currentLine || status === 'finished') return;
    const input = lineInputRef.current;
    const start = input?.selectionStart ?? caret;
    const end = input?.selectionEnd ?? start;
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);

    setPinned(null);
    setCardDismissed(false);

    if (selectionEnd > selectionStart) {
      const values = clearTargetsInRange(currentLine, currentValues.slice(), selectionStart, selectionEnd);
      updateCurrentValues(values);
      setInputCaret(selectionStart);
      return;
    }

    const cell = previousTargetCell(currentLine, selectionStart - 1);
    if (cell !== null) {
      const targetIndex = currentLine.chars[cell].targetIndex as number;
      const values = currentValues.slice();
      values[targetIndex] = null;
      updateCurrentValues(values);
      setInputCaret(cell);
      return;
    }

    if (selectionStart > 0) {
      setInputCaret(selectionStart - 1);
      return;
    }

    const previousLine = findPreviousLineWithTargets(model, lineIndex - 1);
    if (previousLine < 0) return;

    // 回到上一行时保留已经打出的 values；只清除末尾换行符，让用户可以重新按 Enter
    const prevLine = model.lines[previousLine];
    const prevValues = (lineStates[previousLine]?.values ?? emptyValues(prevLine)).slice();
    const prevNewline = newlineCell(prevLine);
    if (prevNewline >= 0) {
      const newlineTargetIndex = prevLine.chars[prevNewline].targetIndex;
      if (newlineTargetIndex !== null) prevValues[newlineTargetIndex] = null;
    }

    const nextStates = lineStates.slice();
    nextStates[previousLine] = { values: prevValues, done: false };
    pendingCaretRef.current = prevNewline >= 0 ? prevNewline : prevLine.chars.length;
    setLineStates(nextStates);
    setLineIndex(previousLine);
  }

  function handleDelete() {
    if (!currentLine || status === 'finished') return;
    const input = lineInputRef.current;
    const start = input?.selectionStart ?? caret;
    const end = input?.selectionEnd ?? start;
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);

    setPinned(null);
    setCardDismissed(false);

    if (selectionEnd > selectionStart) {
      const values = clearTargetsInRange(currentLine, currentValues.slice(), selectionStart, selectionEnd);
      updateCurrentValues(values);
      setInputCaret(selectionStart);
      return;
    }

    const cell = nextTargetCell(currentLine, start);
    if (cell === null) {
      if (start < currentLine.chars.length) setInputCaret(start + 1);
      return;
    }
    const targetIndex = currentLine.chars[cell].targetIndex as number;
    const values = currentValues.slice();
    values[targetIndex] = null;
    updateCurrentValues(values);
    setInputCaret(start);
  }

  function handleEnter() {
    if (!currentLine || status === 'finished') return;
    const values = currentValues.slice();
    const newlineTarget = newlineCell(currentLine);

    if (newlineTarget >= 0) {
      const newlineTargetIndex = currentLine.chars[newlineTarget].targetIndex;
      if (newlineTargetIndex !== null) {
        const textFilled = currentLine.targets.every(
          (target, index) => target.char === '\n' || values[index] !== null,
        );
        if (!textFilled) return;
        values[newlineTargetIndex] = '\n';
        completeCurrentLine(values);
        return;
      }
    }

    // 跳过换行符时没有换行目标；如果正文已经完整，Enter 可以直接进入下一行
    if (values.every((value) => value !== null)) {
      completeCurrentLine(values);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || status === 'finished') return;
    const key = event.key;

    if (key === 'Backspace') {
      event.preventDefault();
      handleBackspace();
      return;
    }
    if (key === 'Delete') {
      event.preventDefault();
      handleDelete();
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      handleEnter();
      return;
    }
    if (key === 'Escape') {
      setPinned(null);
      setCardDismissed(true);
      return;
    }
    if (key === 'Tab') {
      event.preventDefault();
      return;
    }

    // Ctrl/Cmd 组合交给原生 input：选择、复制等
    if (event.ctrlKey || event.metaKey) return;

    // ←/→/Home/End/Shift 等移动由原生 input 处理
    if (key.length !== 1) return;

    const category = classifyChar(key);
    if (category !== 'letter' && category !== 'other' && skipSettings[category]) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    handlePrintableChar(key);
  }

  useEffect(() => {
    const input = lineInputRef.current;
    if (!input) return;

    // 允许原生光标/选择，但拦截所有原生文本修改；内容由 values 状态驱动
    const blockNativeEdit = (event: Event) => event.preventDefault();
    input.addEventListener('beforeinput', blockNativeEdit);
    return () => input.removeEventListener('beforeinput', blockNativeEdit);
  }, [lineIndex]);

  function handleInputSelect() {
    const input = lineInputRef.current;
    if (!input) return;
    setCaret(input.selectionStart ?? 0);
  }

  function renderSourceToken(token: ArticleToken, tokenKey: string) {
    if (token.kind === 'gap') {
      return (
        <span className="source-gap" key={tokenKey}>
          {token.text}
        </span>
      );
    }

    const word = token.word;
    const isCurrent = word.index === autoWordIndex;
    const isPinned = pinned?.wordIndex === word.index;

    return (
      <span
        key={tokenKey}
        className={`word${isCurrent ? ' word--current' : ''}${isPinned ? ' word--pinned' : ''}`}
        ref={(element) => {
          if (element) wordRefs.current.set(word.index, element);
          else wordRefs.current.delete(word.index);
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          setPinned({ wordIndex: word.index, anchor: event.currentTarget });
          setCardDismissed(false);
          focusInput();
        }}
      >
        {word.text}
      </span>
    );
  }

  function renderTypedCharacters(line: TypingLine, values: Array<string | null>): ReactNode[] {
    const nodes: ReactNode[] = [];
    line.chars.forEach((char, index) => {
      if (char.skipped) {
        nodes.push(
          <span className="char char--skipped" key={`s-${index}`}>
            {displayTypingChar(char.char)}
          </span>,
        );
        return;
      }

      const targetIndex = char.targetIndex as number;
      const value = values[targetIndex];
      if (value !== null && value !== undefined) {
        nodes.push(
          <span
            key={`c-${index}`}
            className={`char ${value === char.char ? 'char--ok' : 'char--bad'}`}
          >
            {displayTypingChar(value)}
          </span>,
        );
        return;
      }

      // 未输入的位置用隐藏字符占位，保证原文和手写行逐字符一一对应
      nodes.push(
        <span key={`p-${index}`} className="char char--hidden">
          {displayTypingChar(char.char)}
        </span>,
      );
    });
    return nodes;
  }

  function renderTypedLine(line: TypingLine, state: LineState | undefined, isCurrent: boolean): ReactNode {
    const values = state?.values ?? emptyValues(line);
    const nodes = renderTypedCharacters(line, values);

    if (!isCurrent) {
      return <div className="typed-line typed-line--done">{nodes}</div>;
    }

    const inputTemplate = line.chars
      .map((char) => (char.char === '\n' ? '↵' : char.char))
      .join('');

    return (
      <div className="typed-line typed-line--current typed-line--native">
        <div className="typed-line__mirror" aria-hidden="true">
          {nodes}
        </div>
        <input
          ref={lineInputRef}
          className="typed-line__input"
          value={inputTemplate}
          onChange={() => undefined}
          onKeyDown={handleKeyDown}
          onSelect={handleInputSelect}
          onClick={(event) => {
            event.stopPropagation();
            setPinned(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setPinned(null);
            setCardDismissed(true);
          }}
          onPaste={(event) => event.preventDefault()}
          onCut={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="当前行输入"
        />
      </div>
    );
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
    ? (anchorEl.closest('.article-row')?.querySelector('.typed-line') as HTMLElement | null)
    : null;

  return (
    <section className="practice">
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
          {model.skippedChars > 0 ? <span className="skip-chip">跳过 {model.skippedChars} 字符</span> : null}
          <span
            className="coverage-chip"
            title={`不重复单词中，有 ${coverage.covered} 个可在词库查到`}
          >
            词库覆盖 {Math.round(coverage.ratio * 100)}%
          </span>
        </div>
        <div className="practice-toolbar__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setDraftSettings(skipSettings);
              setSettingsOpen((open) => !open);
            }}
            aria-expanded={settingsOpen}
          >
            设置
          </button>
          <button type="button" className="button button--ghost" onClick={onRestart}>
            重新开始
          </button>
          <button type="button" className="button button--text" onClick={onExit}>
            换文章
          </button>

          {settingsOpen ? (
            <div className="settings-popover" role="dialog" aria-label="练习设置">
              <div className="settings-popover__head">
                <strong>练习设置</strong>
                <span>修改后将从开头重新练习</span>
              </div>
              <PracticeSettings value={draftSettings} onChange={setDraftSettings} compact />
              <div className="settings-popover__actions">
                <button
                  type="button"
                  className="button button--text"
                  onClick={() => {
                    setSettingsOpen(false);
                    focusInput();
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => {
                    setSettingsOpen(false);
                    onApplySettings(draftSettings);
                  }}
                >
                  应用并重新开始
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat">
          <span className="stat__label">速度</span>
          <span className="stat__value">{Math.round(stats.wpm)}</span>
          <span className="stat__unit">WPM</span>
        </div>
        <div className="stat">
          <span className="stat__label">正确率</span>
          <span className="stat__value">{Math.round(stats.accuracy * 100)}</span>
          <span className="stat__unit">%</span>
        </div>
        <div className="stat">
          <span className="stat__label">用时</span>
          <span className="stat__value stat__value--time">{formatDuration(elapsedMs)}</span>
        </div>
        <div className="stat stat--progress">
          <span className="stat__label">进度</span>
          <span className="stat__value">
            {stats.typedChars}
            <span className="stat__unit"> / {model.totalTargets}</span>
          </span>
          <div className="progress progress--inline">
            <div className="progress__bar" style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
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
            return (
              <div
                className={`article-row${isCurrent ? ' article-row--current' : ''}${
                  isDone ? ' article-row--done' : ''
                }`}
                data-line-index={line.index}
                key={line.index}
              >
                <div className="source-line">
                  {line.tokens.map((token, index) => renderSourceToken(token, `${line.index}-${index}`))}
                  {line.needsEnter ? (
                    <span
                      className={`newline-marker${skipSettings.newline ? ' newline-marker--skipped' : ''}`}
                      aria-hidden="true"
                    >
                      ↵
                    </span>
                  ) : null}
                </div>
                {isCurrent || isDone ? (
                  renderTypedLine(line, state, isCurrent)
                ) : (
                  <div className="typed-line typed-line--pending" aria-hidden="true" />
                )}
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

      <WordTip
        word={activeWord?.text || ''}
        entry={activeEntry}
        anchorEl={anchorEl}
        belowEl={belowEl}
        repositionKey={`${lineIndex}:${caret}:${status}`}
        visible={focused && !cardDismissed && !settingsOpen && Boolean(anchorEl) && status !== 'finished'}
      />
    </section>
  );
}
