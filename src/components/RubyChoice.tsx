import type { BuildOptions } from '../types';

interface Props {
  options: BuildOptions;
  onChange: (patch: Partial<BuildOptions>) => void;
}

/**
 * 読み取る前に、パネルにルビが振られているかを選んでもらう。
 *
 * ルビの判定は文字の大きさで見分けるため、ルビの無いパネルにかけると
 * 小さめに組まれた本文まで巻き添えになる。「ルビなし」を選んだときは
 * 判定そのものを行わず、読み取った文字をそのまま使う。
 */
export default function RubyChoice({ options, onChange }: Props) {
  return (
    <div className="ruby-choice">
      <div className="ruby-choice-head">
        <span className="ruby-choice-label">解説パネルのルビ（ふりがな）</span>
        <div className="segmented" role="group" aria-label="ルビの有無">
          <button
            type="button"
            className={!options.hasRuby ? 'on' : ''}
            onClick={() => onChange({ hasRuby: false })}
          >
            ルビなし
          </button>
          <button
            type="button"
            className={options.hasRuby ? 'on' : ''}
            onClick={() => onChange({ hasRuby: true })}
          >
            ルビあり
          </button>
        </div>
      </div>

      <p className="hint">
        {options.hasRuby
          ? '本文より小さい、かなだけの語をルビとみなして落とします。本文まで消えるときは下のつまみを下げてください。'
          : '読み取った文字をそのまま使います。ルビを落とす判定は行いません。'}
      </p>

      {options.hasRuby && (
        <label className="ruby-ratio">
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
            ルビが残るなら上げ、本文まで消えるなら下げてください。読み取り直しは起きません。
          </span>
        </label>
      )}
    </div>
  );
}
