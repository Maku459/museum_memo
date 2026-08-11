import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PhotoCard from './components/PhotoCard';
import SettingsPanel from './components/SettingsPanel';
import OutlinePanel from './components/OutlinePanel';
import { readImageMeta } from './lib/image';
import { ENGINE_ERROR_PREFIX, prepareForOcr, recognize } from './lib/ocr';
import { buildSections, classifyPhoto } from './lib/group';
import { buildMarkdown, forgetDataUrl } from './lib/markdown';
import { copyToClipboard, downloadMarkdown, downloadZip } from './lib/download';
import { sanitizeFileName } from './lib/text';
import {
  defaultBuildOptions,
  effectiveConfidence,
  kindOf,
  type BuildOptions,
  type Photo,
  type PhotoKind,
} from './types';

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `photo-${idCounter}`;
}

function uniqueExportName(fileName: string, taken: Set<string>): string {
  const dot = fileName.lastIndexOf('.');
  const base = sanitizeFileName(dot > 0 ? fileName.slice(0, dot) : fileName) || 'photo';
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '.jpg';
  let name = `${base}${ext}`;
  let n = 2;
  while (taken.has(name)) {
    name = `${base}-${n}${ext}`;
    n += 1;
  }
  return name;
}

function byTime(a: Photo, b: Photo): number {
  return a.takenAt.getTime() - b.takenAt.getTime();
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [options, setOptions] = useState<BuildOptions>(defaultBuildOptions);
  const [markdown, setMarkdown] = useState('');
  const [building, setBuilding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  const photosRef = useRef<Photo[]>(photos);
  photosRef.current = photos;
  const optionsRef = useRef<BuildOptions>(options);
  optionsRef.current = options;

  const patchPhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  /** 追加直後の写真はまだstateに反映されていないので、Photoそのものを受け取る。 */
  const runOcr = useCallback(
    async (target: Photo) => {
      const { id } = target;
      patchPhoto(id, { status: 'reading', progress: 0, error: undefined });
      try {
        const image = await prepareForOcr(target.file);
        const result = await recognize(image, (progress, status) => {
          if (status === 'recognizing text') patchPhoto(id, { progress });
        });
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'done',
                  progress: 1,
                  text: result.text,
                  confidence: result.confidence,
                  edited: false,
                  autoKind: classifyPhoto(
                    result.text,
                    result.confidence,
                    optionsRef.current.captionMinChars,
                  ),
                }
              : p,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // エンジンの準備に失敗した場合は全写真で同じ内容になるので、画面上部にまとめて出す
        if (message.startsWith(ENGINE_ERROR_PREFIX)) {
          setNotice(message);
          patchPhoto(id, { status: 'error', error: 'この写真はOCRできませんでした。' });
        } else {
          patchPhoto(id, { status: 'error', error: message });
        }
      }
    },
    [patchPhoto],
  );

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter(
        (f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name),
      );
      if (files.length === 0) {
        setNotice('画像ファイルが見つかりませんでした。');
        return;
      }
      setNotice('');

      const taken = new Set(photosRef.current.map((p) => p.exportName));
      const created: Photo[] = [];
      for (const file of files) {
        const meta = await readImageMeta(file);
        const exportName = uniqueExportName(file.name, taken);
        taken.add(exportName);
        created.push({
          id: nextId(),
          file,
          url: URL.createObjectURL(file),
          exportName,
          takenAt: meta.takenAt,
          takenAtFromExif: meta.takenAtFromExif,
          width: meta.width,
          height: meta.height,
          status: 'pending',
          progress: 0,
          text: '',
          confidence: 0,
          edited: false,
          autoKind: 'exhibit',
        });
      }

      setPhotos((prev) => [...prev, ...created].sort(byTime));
      for (const photo of created) void runOcr(photo);
    },
    [runOcr],
  );

  const retryOcr = useCallback(
    (id: string) => {
      const target = photosRef.current.find((p) => p.id === id);
      if (target) void runOcr(target);
    },
    [runOcr],
  );

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      forgetDataUrl(id);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setPhotos((prev) => {
      for (const p of prev) {
        URL.revokeObjectURL(p.url);
        forgetDataUrl(p.id);
      }
      return [];
    });
    setMarkdown('');
  }, []);

  const changeKind = useCallback(
    (id: string, kind: PhotoKind | undefined) => patchPhoto(id, { manualKind: kind }),
    [patchPhoto],
  );

  const changeText = useCallback((id: string, text: string) => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              text,
              edited: true,
              autoKind: classifyPhoto(text, 100, optionsRef.current.captionMinChars),
            }
          : p,
      ),
    );
  }, []);

  const changeTakenAt = useCallback((id: string, takenAt: Date) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, takenAt, takenAtFromExif: false } : p)).sort(byTime),
    );
  }, []);

  const updateOptions = useCallback((patch: Partial<BuildOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  }, []);

  // 判定のしきい値を動かしたら、読み取り済みの写真を再判定する
  useEffect(() => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.status === 'done' || p.edited
          ? {
              ...p,
              autoKind: classifyPhoto(p.text, effectiveConfidence(p), options.captionMinChars),
            }
          : p,
      ),
    );
  }, [options.captionMinChars]);

  const sections = useMemo(() => buildSections(photos, options), [photos, options]);

  const readingCount = photos.filter((p) => p.status === 'pending' || p.status === 'reading').length;

  // Markdownは入力が変わるたびに組み直す。連続入力で走りすぎないよう少し待つ。
  useEffect(() => {
    if (photos.length === 0) {
      setMarkdown('');
      return;
    }
    let cancelled = false;
    setBuilding(true);
    const timer = setTimeout(() => {
      buildMarkdown(photos, sections, options)
        .then((md) => {
          if (!cancelled) setMarkdown(md);
        })
        .catch((err) => {
          if (!cancelled) setNotice(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setBuilding(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [photos, sections, options]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (photosRef.current.length > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const captionCount = photos.filter((p) => kindOf(p) === 'caption').length;

  return (
    <div className="app">
      <header className="app-head">
        <h1>博物館メモ</h1>
        <p>
          展示物と解説文の写真をまとめてアップロードすると、解説文をOCRで読み取り、
          撮影時刻を手がかりに展示物の写真を並べたMarkdownの見学メモを作ります。
          画像もOCRもブラウザ内で処理するので、写真はどこにも送信されません。
        </p>
      </header>

      <label
        className={`dropzone${dragging ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="dropzone-main">写真をドロップ、またはクリックして選ぶ</span>
        <span className="hint">
          解説パネルの写真と展示物の写真を、まとめて選んで構いません。撮影時刻で自動的に並べます。
        </span>
      </label>

      {notice && <p className="error banner">{notice}</p>}

      {photos.length > 0 && (
        <>
          <div className="statusbar">
            <span>
              {photos.length}枚（解説文 {captionCount} / 展示物 {photos.length - captionCount}）・
              {sections.length}項目
            </span>
            {readingCount > 0 && <span className="reading">OCR中… 残り{readingCount}枚</span>}
            <button type="button" className="ghost danger" onClick={clearAll}>
              すべて消す
            </button>
          </div>

          <SettingsPanel options={options} onChange={updateOptions} />

          <section>
            <h2>写真（{photos.length}枚）</h2>
            <p className="hint">
              種別の判定を間違えていたら切り替えてください。OCRの誤字はその場で直せます。
            </p>
            <ul className="cards">
              {photos.map((photo, index) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  index={index}
                  onChangeKind={changeKind}
                  onChangeText={changeText}
                  onChangeTakenAt={changeTakenAt}
                  onRetry={retryOcr}
                  onRemove={removePhoto}
                />
              ))}
            </ul>
          </section>

          <section>
            <h2>組み立て結果</h2>
            <p className="hint">解説文の前後に、撮影時刻の近い展示物写真を差し込んでいます。</p>
            <OutlinePanel sections={sections} />
          </section>

          <section>
            <div className="md-head">
              <h2>Markdown{building ? '（生成中…）' : ''}</h2>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => {
                    void copyToClipboard(markdown).then(
                      () => setNotice('Markdownをコピーしました。'),
                      () => setNotice('クリップボードにコピーできませんでした。'),
                    );
                  }}
                  disabled={!markdown || building}
                >
                  コピー
                </button>
                <button
                  type="button"
                  onClick={() => downloadMarkdown(markdown, options.title)}
                  disabled={!markdown || building}
                >
                  .md を保存
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void downloadZip(markdown, photos, options).catch((err) =>
                      setNotice(err instanceof Error ? err.message : String(err)),
                    );
                  }}
                  disabled={!markdown || building}
                >
                  ZIP（.md + 画像）
                </button>
              </div>
            </div>
            <textarea className="md-output" value={markdown} readOnly spellCheck={false} />
          </section>
        </>
      )}

      <footer className="app-foot">
        <p className="hint">
          OCRはtesseract.js（日本語＋英語）を使用しています。初回は言語データの読み込みに少し時間がかかります。
          HEICなど一部の形式はブラウザが表示できないことがあるため、JPEGやPNGでの取り込みをおすすめします。
        </p>
      </footer>
    </div>
  );
}
