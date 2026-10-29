import { useState } from 'react';
import AppHeader from '../Components/AppHeader';
import ImportPanel from '../Components/ImportPanel';
import PracticeBoard from '../Components/PracticeBoard';
import PracticeSettings from '../Components/PracticeSettings';
import type { Dictionary } from '../data/dictionary';
import { loadDictionary } from '../data/dictionary';
import type { Coverage, ParsedArticle, SkipSettings } from '../utils/text';
import { DEFAULT_SKIP_SETTINGS, countCoverage, getArticleMaxChars, parseArticle } from '../utils/text';

type Stage = 'import' | 'practice';

interface ArticleState {
  parsed: ParsedArticle;
  sourceName: string;
  coverage: Coverage;
}

export default function Index() {
  const [stage, setStage] = useState<Stage>('import');
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [article, setArticle] = useState<ArticleState | null>(null);
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
      setSessionKey((key) => key + 1);
      setStage('practice');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '词库加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }

  function handleApplySettings(next: SkipSettings) {
    setSkipSettings(next);
    setSessionKey((key) => key + 1);
  }

  function restartPractice() {
    setSessionKey((key) => key + 1);
  }

  function exitToImport() {
    setStage('import');
  }

  if (stage === 'practice' && article && dictionary) {
    return (
      <PracticeBoard
        key={sessionKey}
        article={article.parsed}
        dictionary={dictionary}
        sourceName={article.sourceName}
        coverage={article.coverage}
        skipSettings={skipSettings}
        onApplySettings={handleApplySettings}
        onRestart={restartPractice}
        onExit={exitToImport}
      />
    );
  }

  return (
    <div className="app-layout app-layout--import">
      <main className="app-main">
        <AppHeader />
        <ImportPanel loading={loading} error={error} onStart={handleStart} />

        <footer className="page-footer">
          <span>本地词库 · 离线可用</span>
          <span className="page-footer__dot">·</span>
          <span>词条数据来自 ECDICT（MIT）与 ecdict-revised（CC BY-SA 4.0）</span>
        </footer>
      </main>

      <aside className="app-sidebar">
        <section className="sidebar-card">
          <div className="sidebar-card__head">
            <h2 className="sidebar-card__title">练习设置</h2>
            <span className="sidebar-card__eyebrow">SETTINGS</span>
          </div>
          <PracticeSettings value={skipSettings} onChange={setSkipSettings} compact />
          <p className="sidebar-hint">
            默认全部关闭。开启跳过后，对应字符会自动填入输入框；中文标点会转成半角，无法输入的字符会替换为空格。
          </p>
        </section>

        <section className="sidebar-card">
          <div className="sidebar-card__head">
            <h2 className="sidebar-card__title">使用提示</h2>
            <span className="sidebar-card__eyebrow">TIPS</span>
          </div>
          <ul className="sidebar-help">
            <li>
              <span className="sidebar-help__num">01</span>
              <p>粘贴文章或导入 .txt，点击「开始练习」。</p>
            </li>
            <li>
              <span className="sidebar-help__num">02</span>
              <p>点击原文中的单词可查看释义；点击任意行可以切回去修改。</p>
            </li>
            <li>
              <span className="sidebar-help__num">03</span>
              <p>完成后成绩会显示在右侧，仍可继续退格修改或查词。</p>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
