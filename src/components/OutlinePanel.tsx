import type { Section } from '../types';
import { formatTime } from '../lib/text';

interface Props {
  sections: Section[];
}

/** どの展示物写真がどの解説文の前後に入ったかを、並び順のまま確認するためのパネル。 */
export default function OutlinePanel({ sections }: Props) {
  if (sections.length === 0) return null;

  return (
    <ol className="outline">
      {sections.map((section, index) => {
        const title = section.title || (section.caption ? `展示 ${index + 1}` : '展示物（解説なし）');
        return (
          <li key={section.id}>
            <div className="outline-head">
              <span className="outline-title">{title}</span>
              <span className="hint">{formatTime(section.startedAt)}</span>
            </div>
            <div className="outline-strip">
              {section.before.map((photo) => (
                <img key={photo.id} src={photo.url} alt="" title={`展示物 ${formatTime(photo.takenAt)}`} />
              ))}
              {section.caption && (
                <span className="outline-text" title={section.caption.text.slice(0, 200)}>
                  解説文 {section.caption.text.length}字
                </span>
              )}
              {section.after.map((photo) => (
                <img key={photo.id} src={photo.url} alt="" title={`展示物 ${formatTime(photo.takenAt)}`} />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
