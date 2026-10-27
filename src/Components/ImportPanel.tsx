import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { SkipSettings } from '../utils/text';
import { MAX_ARTICLE_CHARS, MAX_ARTICLE_WORDS, parseArticle } from '../utils/text';
import PracticeSettings from './PracticeSettings';

export interface ImportPayload {
  text: string;
  sourceName: string;
}

export interface ImportPanelProps {
  loading: boolean;
  error?: string | null;
  skipSettings: SkipSettings;
  onSkipSettingsChange: (next: SkipSettings) => void;
  onStart: (payload: ImportPayload) => void;
}

const MAX_FILE_BYTES = 1024 * 1024;

const SAMPLE_ARTICLE = `The North Wind and the Sun were disputing which was the stronger, when a traveller came along wrapped in a warm cloak.
They agreed that the one who first succeeded in making the traveller take his cloak off should be considered stronger than the other.
Then the North Wind blew as hard as he could, but the more he blew, the more closely did the traveller fold his cloak around him; and at last the North Wind gave up the attempt.
Then the Sun shined out warmly, and immediately the traveller took off his cloak.
And so the North Wind was obliged to confess that the Sun was the stronger of the two.`;

type ImportMode = 'paste' | 'file';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ImportPanel({
  loading,
  error,
  skipSettings,
  onSkipSettingsChange,
  onStart,
}: ImportPanelProps) {
  const [mode, setMode] = useState<ImportMode>('paste');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [localError, setLocalError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseArticle(text) : null), [text]);
  const stats = useMemo(
    () => ({ words: parsed?.words.length ?? 0, chars: parsed?.charCount ?? 0 }),
    [parsed],
  );

  const shownError = localError || error || '';

  function readFile(file: File) {
    setLocalError('');
    if (!/\.txt$/i.test(file.name) && file.type !== 'text/plain') {
      setLocalError('请选择 .txt 文本文件。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setLocalError(`文件过大（${formatBytes(file.size)}），请选择 1MB 以内的 txt。`);
      return;
    }
    file
      .text()
      .then((value) => {
        setText(value.replace(/^\uFEFF/, ''));
        setFileName(file.name);
      })
      .catch(() => setLocalError('文件读取失败，请重新选择。'));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files && event.target.files[0];
    if (file) readFile(file);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      setMode('file');
      readFile(file);
    }
  }

  function validate(): string {
    const trimmed = text.trim();
    if (!trimmed) return '请先粘贴或导入一篇文章。';
    if (trimmed.length > MAX_ARTICLE_CHARS) {
      return `文章过长（${stats.chars.toLocaleString()} 字符），请控制在 ${MAX_ARTICLE_CHARS.toLocaleString()} 字符以内。`;
    }
    if (stats.words === 0) return '没有识别到英文单词，请检查文章内容。';
    if (stats.words > MAX_ARTICLE_WORDS) {
      return `文章单词过多（${stats.words.toLocaleString()} 个），请控制在 ${MAX_ARTICLE_WORDS.toLocaleString()} 个以内。`;
    }
    return '';
  }

  function handleStart() {
    const message = validate();
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError('');
    const name = mode === 'file' && fileName ? fileName : '粘贴文本';
    onStart({ text: text.trim(), sourceName: name });
  }

  function loadSample() {
    setMode('paste');
    setText(SAMPLE_ARTICLE);
    setFileName('');
    setLocalError('');
  }

  return (
    <section className="panel import-panel">
      <div className="tabs" role="tablist" aria-label="文章导入方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          className={`tab${mode === 'paste' ? ' tab--active' : ''}`}
          onClick={() => setMode('paste')}
        >
          粘贴文本
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'file'}
          className={`tab${mode === 'file' ? ' tab--active' : ''}`}
          onClick={() => setMode('file')}
        >
          导入 TXT
        </button>
      </div>

      {mode === 'paste' ? (
        <textarea
          className="import-textarea"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setLocalError('');
          }}
          placeholder="把一段英文文章粘贴到这里，例如新闻、故事、阅读材料……"
          spellCheck={false}
        />
      ) : (
        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileChange}
          />
          <div className="dropzone__icon" aria-hidden="true">
            TXT
          </div>
          <p className="dropzone__title">{fileName || '把 .txt 文件拖到这里，或点击选择'}</p>
          <p className="dropzone__hint">支持 UTF-8 文本，最大 1MB{fileName ? ` · ${formatBytes(new Blob([text]).size)}` : ''}</p>
        </div>
      )}

      <div className="settings-inline">
        <div className="settings-inline__head">
          <strong>练习设置</strong>
          <span>默认全部关闭：空格、标点、数字和换行符都需要自己输入。中文标点会自动转成半角，无法输入的字符会替换为空格。</span>
        </div>
        <PracticeSettings value={skipSettings} onChange={onSkipSettingsChange} />
      </div>

      <div className="import-meta">
        <div className="import-meta__counts">
          {stats.words > 0 ? (
            <>
              <span>
                共 <strong>{stats.words.toLocaleString()}</strong> 个英文单词
              </span>
              <span className="dot">·</span>
              <span>{stats.chars.toLocaleString()} 字符</span>
              {mode === 'file' && fileName ? <span className="file-chip">{fileName}</span> : null}
            </>
          ) : (
            <span className="import-meta__empty">还没有内容</span>
          )}
        </div>
        <div className="import-meta__actions">
          <button type="button" className="link-button" onClick={loadSample}>
            载入示例文章
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={handleStart}
            disabled={loading || stats.words === 0}
          >
            {loading ? '词库加载中…' : '开始练习'}
          </button>
        </div>
      </div>

      {shownError ? <p className="error-text">{shownError}</p> : null}
    </section>
  );
}
