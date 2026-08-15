import type { Photo, PhotoKind } from '../types';
import { formatDateTime, pad2 } from '../lib/text';

interface Props {
  photo: Photo;
  index: number;
  onChangeKind: (id: string, kind: PhotoKind) => void;
  onChangeText: (id: string, text: string) => void;
  onChangeTakenAt: (id: string, takenAt: Date) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

export default function PhotoCard({
  photo,
  index,
  onChangeKind,
  onChangeText,
  onChangeTakenAt,
  onRetry,
  onRemove,
}: Props) {
  const isCaption = photo.kind === 'caption';

  return (
    <li className={`card kind-${photo.kind}`}>
      <div className="card-media">
        <img src={photo.url} alt={photo.file.name} loading="lazy" />
        <span className="card-index">{index + 1}</span>
      </div>

      <div className="card-body">
        <div className="card-head">
          <strong className="card-name" title={photo.file.name}>
            {photo.file.name}
          </strong>
          <button type="button" className="ghost danger" onClick={() => onRemove(photo.id)}>
            削除
          </button>
        </div>

        <div className="card-row">
          <label>
            撮影日時
            <input
              type="datetime-local"
              value={toLocalInputValue(photo.takenAt)}
              onChange={(e) => {
                const next = new Date(e.target.value);
                if (!Number.isNaN(next.getTime())) onChangeTakenAt(photo.id, next);
              }}
            />
          </label>
          <span className="hint">
            {photo.takenAtFromExif ? 'EXIFから取得' : 'EXIFなし → ファイル日時'}
          </span>
        </div>

        <div className="card-row">
          <div className="segmented" role="group" aria-label="この写真の種別">
            <button
              type="button"
              className={!isCaption ? 'on' : ''}
              onClick={() => onChangeKind(photo.id, 'exhibit')}
            >
              展示物
            </button>
            <button
              type="button"
              className={isCaption ? 'on' : ''}
              onClick={() => onChangeKind(photo.id, 'caption')}
            >
              解説文
            </button>
          </div>
          {!isCaption && <span className="hint">読み取りません</span>}
        </div>

        {isCaption && (
          <>
            {photo.status === 'reading' && <p className="hint">読み取り中…</p>}
            {photo.status === 'error' && (
              <p className="error">
                {photo.error}下の欄に直接入力しても同じようにまとめられます。
              </p>
            )}

            {photo.status !== 'reading' && (
              <>
                <label className="text-label">
                  {photo.status === 'done' ? '読み取った文字（修正できます）' : '解説文'}
                  <textarea
                    value={photo.text}
                    rows={8}
                    placeholder={
                      photo.status === 'done'
                        ? '文字は読み取れませんでした'
                        : 'ここに解説文を入力するか、右の「読み取る」を押してください'
                    }
                    onChange={(e) => onChangeText(photo.id, e.target.value)}
                  />
                </label>
                <p className="hint">
                  {photo.status === 'done'
                    ? `信頼度 ${photo.confidence}%${photo.edited ? '（手直しあり）' : ''} ・ `
                    : ''}
                  {formatDateTime(photo.takenAt)}
                  <button type="button" className="ghost" onClick={() => onRetry(photo.id)}>
                    {photo.status === 'done' ? '読み取り直す' : '読み取る'}
                  </button>
                </p>
              </>
            )}
          </>
        )}
      </div>
    </li>
  );
}
