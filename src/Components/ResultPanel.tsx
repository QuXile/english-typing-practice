import type { SessionSummary } from './PracticeBoard';
import { formatDuration } from '../utils/text';

export interface ResultPanelProps {
  summary: SessionSummary;
  onRestart: () => void;
  onExit: () => void;
}

export default function ResultPanel({ summary, onRestart, onExit }: ResultPanelProps) {
  const accuracy = Math.round(summary.accuracy * 100);
  const wpm = Math.round(summary.wpm);

  return (
    <section className="panel result-panel">
      <span className="result-panel__badge">练习完成</span>
      <h2 className="result-panel__title">这一篇打完了</h2>
      <p className="result-panel__subtitle">
        共 {summary.totalChars.toLocaleString()} 字符，需输入 {summary.requiredChars.toLocaleString()} 字符
        {summary.skippedChars > 0 ? `，按设置跳过 ${summary.skippedChars.toLocaleString()} 字符` : ''}，用时{' '}
        {formatDuration(summary.elapsedMs)}
        {summary.typedChars < summary.requiredChars
          ? `，还有 ${(summary.requiredChars - summary.typedChars).toLocaleString()} 个字符未输入`
          : ''}
      </p>

      <div className="result-grid">
        <div className="result-stat">
          <span className="result-stat__value">{wpm}</span>
          <span className="result-stat__label">WPM 速度</span>
        </div>
        <div className="result-stat">
          <span className="result-stat__value">{accuracy}%</span>
          <span className="result-stat__label">正确率</span>
        </div>
        <div className="result-stat">
          <span className="result-stat__value">{formatDuration(summary.elapsedMs)}</span>
          <span className="result-stat__label">用时</span>
        </div>
        <div className="result-stat">
          <span className="result-stat__value">{summary.errors}</span>
          <span className="result-stat__label">错误字符</span>
        </div>
      </div>

      <div className="result-panel__actions">
        <button type="button" className="button button--primary" onClick={onRestart}>
          再练一次
        </button>
        <button type="button" className="button button--ghost" onClick={onExit}>
          换一篇文章
        </button>
      </div>
    </section>
  );
}
