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
  typed: string;
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

function aggregateSummary(
  model: TypingModel,
  lineStates: LineState[],
  currentLine: number,
  currentTyped: string,
  elapsedMs: number,
): SessionSummary {
  let typedChars = 0;
  let correctChars = 0;
  let errors = 0;

  model.lines.forEach((line, index) => {
    const state = lineStates[index];
    const text = state?.done ? state.typed : index === currentLine ? currentTyped : '';
    typedChars += text.length;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === line.targets[i]?.char) correctChars += 1;
      else errors += 1;
    }
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
    model.lines.map((line) => ({ typed: '', done: line.targets.length === 0 })),
  );
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<'ready' | 'running' | 'finished'>('ready');
  const [focused, setFocused] = useState(true);
  const [cardDismissed, setCardDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState<{ wordIndex: number; anchor: HTMLElement } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<SkipSettings>(skipSettings);
  const [autoAnchor, setAutoAnchor] = useState<HTMLElement | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const wordRefs = useRef(new Map<number, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);

  const currentLine = lineIndex >= 0 ? model.lines[lineIndex] : undefined;
  const currentTargets = currentLine?.targets ?? [];
  const currentTarget = currentTargets[typed.length];
  const autoWordIndex = currentTarget?.activeWordIndex ?? null;
  const activeWordIndex = pinned?.wordIndex ?? autoWordIndex;
  const activeWord = activeWordIndex !== null ? model.words[activeWordIndex] : undefined;
  const activeEntry: DictionaryEntry | undefined = activeWord
    ? lookupWord(dictionary, activeWord.key)
    : undefined;
  const anchorEl = pinned?.anchor ?? autoAnchor;

  const elapsedMs = startTimeRef.current === null ? 0 : Math.max(0, now - startTimeRef.current);
  const stats = useMemo(
    () => aggregateSummary(model, lineStates, lineIndex, typed, elapsedMs),
    [model, lineStates, lineIndex, typed, elapsedMs],
  );

  useLayoutEffect(() => {
    if (pinned) {
      setAutoAnchor(null);
      return;
    }
    const element = autoWordIndex !== null ? wordRefs.current.get(autoWordIndex) ?? null : null;
    setAutoAnchor(element);
  }, [autoWordIndex, lineIndex, typed.length, pinned]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
    inputRef.current?.focus();
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
    const summary = aggregateSummary(model, finalStates, -1, '', Math.max(0, end - start));
    setLineStates(finalStates);
    setNow(end);
    setStatus('finished');
    onFinish(summary);
  }

  function completeLine(finalTyped: string) {
    if (!currentLine) return;
    const nextStates = lineStates.slice();
    nextStates[currentLine.index] = { typed: finalTyped, done: true };
    const nextLine = findNextLineWithTargets(model, currentLine.index + 1);
    if (nextLine < 0) {
      finish(nextStates);
      return;
    }
    setLineStates(nextStates);
    setLineIndex(nextLine);
    setTyped('');
  }

  function appendChar(char: string) {
    if (!currentLine || status === 'finished') return;
    if (currentTarget?.category === 'newline' && char !== '\n') return;
    setPinned(null);
    setCardDismissed(false);
    markStarted();
    const nextTyped = typed + char;
    if (nextTyped.length >= currentLine.targets.length) {
      completeLine(nextTyped);
    } else {
      setTyped(nextTyped);
    }
  }

  function handleBackspace() {
    setPinned(null);
    setCardDismissed(false);
    if (typed.length > 0) {
      setTyped(typed.slice(0, -1));
      return;
    }
    const previousLine = findPreviousLineWithTargets(model, lineIndex - 1);
    if (previousLine < 0) return;

    // 回到上一行时保留已经打出的内容，只去掉行尾的换行符；
    // 如果上一行没有换行符（或跳过了换行），则退掉最后一个正文字符。
    const previousState = lineStates[previousLine];
    let restored = previousState?.typed ?? '';
    const previousTargets = model.lines[previousLine].targets.length;
    if (restored.length >= previousTargets) {
      restored = restored.slice(0, -1);
    }

    const nextStates = lineStates.slice();
    nextStates[previousLine] = { typed: restored, done: false };
    setLineStates(nextStates);
    setLineIndex(previousLine);
    setTyped(restored);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || status === 'finished') return;

    if (event.key === 'Backspace') {
      event.preventDefault();
      handleBackspace();
      return;
    }
    if (currentTarget?.category === 'newline') {
      event.preventDefault();
      if (event.key === 'Enter') {
        appendChar('\n');
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      setPinned(null);
      setCardDismissed(true);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      if (currentTarget && currentTarget.char === '\t' && !skipSettings.space) {
        appendChar('\t');
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) return;
    if (event.key.length !== 1) return;

    const char = event.key;
    const category = classifyChar(char);
    if (category !== 'letter' && category !== 'other' && skipSettings[category]) {
      // 已设置为跳过的类别，按键不进入错误统计
      event.preventDefault();
      return;
    }
    event.preventDefault();
    appendChar(char);
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

  function displayTypingChar(value: string): string {
    return value === '\n' ? '↵' : value;
  }

  function renderTypedLine(line: TypingLine, typedText: string, isCurrent: boolean): ReactNode {
    const nodes: ReactNode[] = [];

    line.chars.forEach((char, index) => {
      if (char.skipped) {
        const passed = char.requiredBefore <= typedText.length;
        nodes.push(
          <span
            key={`s-${index}`}
            className={`char char--skipped${passed ? '' : ' char--hidden'}`}
          >
            {displayTypingChar(char.char)}
          </span>,
        );
        return;
      }

      const targetIndex = char.targetIndex as number;
      if (targetIndex < typedText.length) {
        const actual = typedText[targetIndex];
        nodes.push(
          <span key={`c-${index}`} className={`char ${actual === char.char ? 'char--ok' : 'char--bad'}`}>
            {displayTypingChar(actual)}
          </span>,
        );
        return;
      }

      if (isCurrent && targetIndex === typedText.length) {
        nodes.push(<span key={`caret-${index}`} className="caret" aria-hidden="true" />);
      }
      // 未输入的位置用隐藏字符占位，保证原文和手写行逐字符一一对应
      nodes.push(
        <span key={`p-${index}`} className="char char--hidden">
          {displayTypingChar(char.char)}
        </span>,
      );
    });

    return (
      <div
        className={`typed-line${isCurrent ? ' typed-line--current' : ' typed-line--done'}`}
        onClick={(event) => {
          event.stopPropagation();
          setPinned(null);
          focusInput();
        }}
      >
        {nodes}
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
            const typedText = isDone ? state!.typed : isCurrent ? typed : '';
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
                  renderTypedLine(line, typedText, isCurrent)
                ) : (
                  <div className="typed-line typed-line--pending" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>

        <input
          ref={inputRef}
          className="typing-input"
          value=""
          onChange={() => undefined}
          onKeyDown={handleKeyDown}
          onPaste={(event) => event.preventDefault()}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setPinned(null);
            setCardDismissed(true);
          }}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="逐行打字输入框"
        />

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
        repositionKey={`${lineIndex}:${typed.length}:${status}`}
        visible={focused && !cardDismissed && !settingsOpen && Boolean(anchorEl) && status !== 'finished'}
      />
    </section>
  );
}
