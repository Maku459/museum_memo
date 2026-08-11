import type { BuildOptions } from '../types';

interface Props {
  options: BuildOptions;
  onChange: (patch: Partial<BuildOptions>) => void;
}

export default function SettingsPanel({ options, onChange }: Props) {
  return (
    <details className="settings">
      <summary>まとめ方の設定</summary>

      <div className="settings-grid">
        <label>
          メモのタイトル
          <input
            type="text"
            value={options.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        </label>

        <label>
          展示物を解説文に紐づける時間差
          <span className="range-row">
            <input
              type="range"
              min={1}
              max={30}
              value={options.groupGapMinutes}
              onChange={(e) => onChange({ groupGapMinutes: Number(e.target.value) })}
            />
            <output>{options.groupGapMinutes}分</output>
          </span>
          <span className="hint">
            解説文の写真からこの時間内に撮った展示物写真を、同じ項目にまとめます。
          </span>
        </label>

        <label>
          解説文とみなす文字数
          <span className="range-row">
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={options.captionMinChars}
              onChange={(e) => onChange({ captionMinChars: Number(e.target.value) })}
            />
            <output>{options.captionMinChars}字</output>
          </span>
          <span className="hint">
            これ以上の文字が読み取れた写真を解説パネルと判定します。個別に上書きもできます。
          </span>
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

        <fieldset>
          <legend>載せるもの</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeTimestamps}
              onChange={(e) => onChange({ includeTimestamps: e.target.checked })}
            />
            撮影時刻
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeOcrNotes}
              onChange={(e) => onChange({ includeOcrNotes: e.target.checked })}
            />
            OCRの補足情報と写真一覧
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={options.includeCaptionPhotos}
              onChange={(e) => onChange({ includeCaptionPhotos: e.target.checked })}
            />
            解説パネルの写真も載せる
          </label>
        </fieldset>
      </div>
    </details>
  );
}
