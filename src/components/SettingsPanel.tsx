import { useState } from 'react';
import type { BuildOptions } from '../types';

interface Props {
  options: BuildOptions;
  onChange: (patch: Partial<BuildOptions>) => void;
  apiKey: string;
  onChangeApiKey: (key: string) => void;
}

export default function SettingsPanel({ options, onChange, apiKey, onChangeApiKey }: Props) {
  // キー未設定なら最初から開く。以降は利用者の開閉に任せる
  // （openを毎回計算すると、キーを入力した瞬間に閉じてしまう）。
  const [open, setOpen] = useState(!apiKey);

  return (
    <details
      className="settings"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>まとめ方の設定{apiKey ? '' : '（APIキーの設定が必要です）'}</summary>

      <div className="settings-grid">
        <label className="wide">
          Google Cloud Vision APIキー
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => onChangeApiKey(e.target.value.trim())}
          />
          <span className="hint">
            このブラウザにのみ保存されます（サーバーには送りません）。Google Cloudでキーを作り、
            <strong>Cloud Vision APIだけに制限</strong>し、
            <strong>ウェブサイト制限にこのページのURL</strong>を登録しておくと安全です。
          </span>
        </label>

        <label>
          メモのタイトル
          <input
            type="text"
            value={options.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>

        <label>
          画像の埋め込み方
          <select
            value={options.imageMode}
            onChange={(e) => onChange({ imageMode: e.target.value as BuildOptions['imageMode'] })}
          >
            <option value="files">相対パスで参照（ZIPで書き出す）</option>
            <option value="dataurl">Markdownに直接埋め込む（1ファイルで完結）</option>
          </select>
          <span className="hint">
            {options.imageMode === 'files'
              ? 'ZIPに画像フォルダを同梱します。Obsidianやリポジトリに置く場合はこちら。'
              : '画像をbase64で埋め込むため、.mdファイルだけで完結しますがサイズは大きくなります。'}
          </span>
        </label>

        {options.imageMode === 'files' && (
          <label>
            画像フォルダ名
            <input
              type="text"
              value={options.imageDir}
              onChange={(e) => onChange({ imageDir: e.target.value })}
            />
          </label>
        )}

        <label className="check standalone">
          <input
            type="checkbox"
            checked={options.dropFurigana}
            onChange={(e) => onChange({ dropFurigana: e.target.checked })}
          />
          ふりがな（ルビ）を取り込まない
          <span className="hint">
            ルビは本文より小さく組まれるため、文字の大きさで見分けて落とします。
          </span>
        </label>

        {options.dropFurigana && (
          <label>
            ルビとみなす大きさ
            <span className="range-row">
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.05}
                value={options.rubyRatio}
                onChange={(e) => onChange({ rubyRatio: Number(e.target.value) })}
              />
              <output>いちばん小さい本文の{Math.round(options.rubyRatio * 100)}%未満</output>
            </span>
            <span className="hint">
              ルビが残るなら上げ、本文まで消えるなら下げてください。
              変更しても読み取り直しは起きません。
            </span>
          </label>
        )}

        <label className="check standalone">
          <input
            type="checkbox"
            checked={options.dropEnglishText}
            onChange={(e) => onChange({ dropEnglishText: e.target.checked })}
          />
          英訳を取り込まない
          <span className="hint">
            日本語と英語が併記されたパネルで、英文だけの行を落とします。
            日本語がまじる行や、「H 25.0cm」のような短い表記は残します。
          </span>
        </label>

        <label className="check standalone">
          <input
            type="checkbox"
            checked={options.joinLinesAtSentence}
            onChange={(e) => onChange({ joinLinesAtSentence: e.target.checked })}
          />
          「。」が来るまで改行しない
          <span className="hint">
            パネルの折り返しで切れた文をつなぎ、1文を1行にまとめます。
            外すと読み取ったままの改行になります。
          </span>
        </label>

        <fieldset>
          <legend>載せるもの</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeOcrNotes}
              onChange={(e) => onChange({ includeOcrNotes: e.target.checked })}
            />
            読み取りの注記と写真一覧
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includePhotos}
              onChange={(e) => onChange({ includePhotos: e.target.checked })}
            />
            パネルの写真も載せる
          </label>
        </fieldset>
      </div>
    </details>
  );
}
