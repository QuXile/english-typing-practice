import { useState } from 'react';
import ImportPanel from '../Components/ImportPanel';
import PracticeBoard from '../Components/PracticeBoard';
import type { SessionSummary } from '../Components/PracticeBoard';
import ResultPanel from '../Components/ResultPanel';
import type { Dictionary } from '../data/dictionary';
import { loadDictionary } from '../data/dictionary';
import type { Coverage, ParsedArticle, SkipSettings } from '../utils/text';
import { DEFAULT_SKIP_SETTINGS, countCoverage, getArticleMaxChars, parseArticle } from '../utils/text';

type Stage = 'import' | 'practice' | 'result';

interface ArticleState {
  parsed: ParsedArticle;
  sourceName: string;
  coverage: Coverage;
}

export default function Index() {
  const [stage, setStage] = useState<Stage>('import');
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [article, setArticle] = useState<ArticleState | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const [skipSettings, setSkipSettings] = useState<SkipSettings>(DEFAULT_SKIP_SETTINGS);

  async function handleStart(payload: { text: string; sourceName: string }) {
    setLoading(true);
    setError(null);
    try {
      const loaded = dictionary ?? (await loadDictionary());
      setDictionary(loaded);
      const parsed = parseArticle(payload.text, getArticleMaxChars());
      if (parsed.words.length === 0) {
        throw new Error('没有识别到英文单词，请检查文章内容。');
      }
      const coverage = countCoverage(parsed.words, loaded);
      setArticle({ parsed, sourceName: payload.sourceName, coverage });
      setSummary(null);
      setSessionKey((key) => key + 1);
      setStage('practice');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '词库加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }

  function handleFinish(result: SessionSummary) {
    setSummary(result);
    setStage('result');
  }

  function handleApplySettings(next: SkipSettings) {
    setSkipSettings(next);
    setSessionKey((key) => key + 1);
  }

  function restartPractice() {
    setSessionKey((key) => key + 1);
    setStage('practice');
  }

  function exitToImport() {
    setStage('import');
    setSummary(null);
  }

  return (
    <div className={`page-shell${stage === 'practice' ? ' page-shell--practice' : ''}`}>
      <header className="page-header">
        <h1 className="page-header__title">English Typing Practice</h1>
        <div className="page-header__eyebrow">Read · Type · Learn</div>
      </header>

      {stage === 'import' ? (
        <>
          <ImportPanel
            loading={loading}
            error={error}
            skipSettings={skipSettings}
            onSkipSettingsChange={setSkipSettings}
            onStart={handleStart}
          />
          <ul className="feature-list">
            <li>
              <span className="feature-list__icon">01</span>
              <div>
                <strong>导入文章</strong>
                <p>粘贴任意英文文本，或读取本地的 .txt 文件。</p>
              </div>
            </li>
            <li>
              <span className="feature-list__icon">02</span>
              <div>
                <strong>逐行对照</strong>
                <p>原文在上、输入框在下，使用同一套等宽排版；正确/错误会标在原文行上。</p>
              </div>
            </li>
            <li>
              <span className="feature-list__icon">03</span>
              <div>
                <strong>点击查词</strong>
                <p>点击原文里的任意单词，查看释义、音标、范围和词频。</p>
              </div>
            </li>
          </ul>
        </>
      ) : null}

      {stage === 'practice' && article && dictionary ? (
        <PracticeBoard
          key={sessionKey}
          article={article.parsed}
          dictionary={dictionary}
          sourceName={article.sourceName}
          coverage={article.coverage}
          skipSettings={skipSettings}
          onApplySettings={handleApplySettings}
          onFinish={handleFinish}
          onRestart={restartPractice}
          onExit={exitToImport}
        />
      ) : null}

      {stage === 'result' && summary ? (
        <ResultPanel summary={summary} onRestart={restartPractice} onExit={exitToImport} />
      ) : null}

      <footer className="page-footer">
        <span>本地词库 · 离线可用</span>
        <span className="page-footer__dot">·</span>
        <span>词条数据来自 ECDICT（MIT）与 ecdict-revised（CC BY-SA 4.0）</span>
      </footer>
    </div>
  );
}
