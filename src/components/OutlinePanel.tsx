import type { Section } from '../types';
import { formatTime } from '../lib/text';

interface Props {
  sections: Section[];
}

/** メモの並び順と、各項目の分量をひと目で確認するためのパネル。 */
export default function OutlinePanel({ sections }: Props) {
  if (sections.length === 0) return null;

  return (
    <ol className="outline">
      {sections.map((section, index) => (
        <li key={section.id}>
          <div className="outline-head">
            <span className="outline-title">{section.title || `解説 ${index + 1}`}</span>
            <span className="hint">{formatTime(section.photo.takenAt)}</span>
          </div>
          <div className="outline-strip">
            <img src={section.photo.url} alt="" />
            <span className="outline-text" title={section.photo.text.slice(0, 200)}>
              {section.photo.text.length}字
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
