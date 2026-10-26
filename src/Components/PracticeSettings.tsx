import type { SkipSettings } from '../utils/text';

export interface PracticeSettingsProps {
  value: SkipSettings;
  onChange: (next: SkipSettings) => void;
  compact?: boolean;
}

const ITEMS: Array<{ key: keyof SkipSettings; label: string; desc: string }> = [
  { key: 'space', label: '跳过空格', desc: '行内空格与 Tab 不需要输入' },
  { key: 'punct', label: '跳过标点', desc: '逗号、句号、引号、括号等' },
  { key: 'digit', label: '跳过数字', desc: '0-9 及全角数字等' },
  { key: 'other', label: '跳过其他字符', desc: '中文、emoji、特殊符号等' },
];

/** 四个跳过分类的开关。默认全部关闭，即空格/标点/数字/其他字符都要输入。 */
export default function PracticeSettings({ value, onChange, compact }: PracticeSettingsProps) {
  return (
    <div className={`settings-grid${compact ? ' settings-grid--compact' : ''}`}>
      {ITEMS.map((item) => (
        <label className="setting-item" key={item.key}>
          <input
            className="setting-item__input"
            type="checkbox"
            checked={value[item.key]}
            onChange={(event) => onChange({ ...value, [item.key]: event.target.checked })}
          />
          <span className="setting-item__text">
            <span className="setting-item__label">{item.label}</span>
            <span className="setting-item__desc">{item.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
