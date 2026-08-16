import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PhotoCard from './components/PhotoCard';
import SettingsPanel from './components/SettingsPanel';
import OutlinePanel from './components/OutlinePanel';
import { readImageMeta } from './lib/image';
import { extractText, loadApiKey, recognize, saveApiKey } from './lib/vision';
import { buildSections } from './lib/group';
import { buildMarkdown, forgetDataUrl } from './lib/markdown';
import { copyToClipboard, downloadMarkdown, downloadZip } from './lib/download';
import { formatCaption, sanitizeFileName } from './lib/text';
import { defaultBuildOptions, type BuildOptions, type Photo } from './types';

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

/**
 * 読み取り結果から本文を作る。設定を変えたときはここを通し直すだけでよく、
 * Vision APIを呼び直す必要はない。
 */
function deriveText(photo: Pick<Photo, 'annotation' | 'rawText'>, opts: BuildOptions): string {
  const base = photo.annotation
    ? extractText(photo.annotation, { dropRuby: opts.dropFurigana, rubyRatio: opts.rubyRatio })
    : photo.rawText;
  return formatCaption(base, opts);
}

export default function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [options, setOptions] = useState<BuildOptions>(defaultBuildOptions);
  const [apiKey, setApiKey] = useState<string>(() => loadApiKey());
  const [markdown, setMarkdown] = useState('');
  const [building, setBuilding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  const photosRef = useRef<Photo[]>(photos);
  photosRef.current = photos;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const patchPhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const readPhoto = useCallback(
    async (target: Photo) => {
      const key = apiKeyRef.current;
      if (!key) {
        setNotice('先にVision APIのキーを設定してください（「まとめ方の設定」の中にあります）。');
        return;
      }
      const { id } = target;
      patchPhoto(id, { status: 'reading', error: undefined });
      try {
        const result = await recognize(target.file, key);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'done',
                  annotation: result.annotation,
                  rawText: extractText(result.annotation, {
                    dropRuby: false,
                    rubyRatio: optionsRef.current.rubyRatio,
                  }),
                  text: deriveText(
                    { annotation: result.annotation, rawText: '' },
                    optionsRef.current,
                  ),
                  confidence: result.confidence,
                  edited: false,
                }
              : p,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setNotice(message);
        patchPhoto(id, { status: 'error', error: message });
      }
    },
    [patchPhoto],
  );

  /** まだ読み取っていない写真を順に処理する。 */
  const readPending = useCallback(
    async (targets: Photo[]) => {
      for (const photo of targets) {
        if (!apiKeyRef.current) return;
        await readPhoto(photo);
      }
    },
    [readPhoto],
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
          status: 'idle',
          text: '',
          rawText: '',
          annotation: null,
          confidence: 0,
          edited: false,
        });
      }

      setPhotos((prev) => [...prev, ...created].sort(byTime));
      // 取り込んだものはすべて解説パネルなので、そのまま読み取りに進む
      void readPending(created);
    },
    [readPending],
  );

  const retryRead = useCallback(
    (id: string) => {
      const target = photosRef.current.find((p) => p.id === id);
      if (target) void readPhoto(target);
    },
    [readPhoto],
  );

  const readAll = useCallback(() => {
    void readPending(
      photosRef.current.filter((p) => p.status === 'idle' || p.status === 'error'),
    );
  }, [readPending]);

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

  const changeText = useCallback((id: string, text: string) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, text, edited: true } : p)));
  }, []);

  const changeTakenAt = useCallback((id: string, takenAt: Date) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, takenAt, takenAtFromExif: false } : p)).sort(byTime),
    );
  }, []);

  const updateOptions = useCallback((patch: Partial<BuildOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateApiKey = useCallback((key: string) => {
    setApiKey(key);
    saveApiKey(key);
  }, []);

  // 整形の設定を変えたら、手を入れていない本文を組み直す（読み取り直しは不要）
  useEffect(() => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.edited || (!p.annotation && !p.rawText)
          ? p
          : { ...p, text: deriveText(p, optionsRef.current) },
      ),
    );
  }, [
    options.dropFurigana,
    options.rubyRatio,
    options.dropEnglishText,
    options.joinLinesAtSentence,
  ]);

  const sections = useMemo(() => buildSections(photos), [photos]);

  const readingCount = photos.filter((p) => p.status === 'reading').length;
  const unreadCount = photos.filter((p) => p.status === 'idle' || p.status === 'error').length;

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

  return (
    <div className="app">
      <header className="app-head">
        <h1>博物館メモ</h1>
        <p>
          博物館で撮った解説パネルの写真をまとめてアップロードすると、
          Google Cloud Visionで文字を読み取り、撮影時刻の順に並べたMarkdownの見学メモを作ります。
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
        <span className="dropzone-main">解説パネルの写真をドロップ、またはクリックして選ぶ</span>
        <span className="hint">
          取り込んだ写真はすべて読み取ります。撮影時刻の順に並べるので、順番は気にしなくて構いません。
        </span>
      </label>

      {notice && <p className="error banner">{notice}</p>}

      {/* 写真を入れる前にAPIキーを設定できるよう、常に出しておく */}
      <SettingsPanel
        options={options}
        onChange={updateOptions}
        apiKey={apiKey}
        onChangeApiKey={updateApiKey}
      />

      {photos.length > 0 && (
        <>
          <div className="statusbar">
            <span>{photos.length}枚</span>
            {readingCount > 0 && <span className="reading">読み取り中… {readingCount}枚</span>}
            {unreadCount > 0 && readingCount === 0 && (
              <button type="button" onClick={readAll}>
                未読の{unreadCount}枚を読み取る
              </button>
            )}
            <button type="button" className="ghost danger" onClick={clearAll}>
              すべて消す
            </button>
          </div>

          <section>
            <h2>解説パネル（{photos.length}枚）</h2>
            <p className="hint">読み取りの誤字はその場で直せます。直した内容はすぐ反映されます。</p>
            <ul className="cards">
              {photos.map((photo, index) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  index={index}
                  onChangeText={changeText}
                  onChangeTakenAt={changeTakenAt}
                  onRetry={retryRead}
                  onRemove={removePhoto}
                />
              ))}
            </ul>
          </section>

          <section>
            <h2>組み立て結果</h2>
            <p className="hint">撮影時刻の順に、1枚を1項目として並べています。</p>
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
          文字の読み取りにはGoogle Cloud Vision API（DOCUMENT_TEXT_DETECTION）を使います。
          APIキーはこのブラウザにのみ保存され、送信先はGoogleだけです。
          HEICなど一部の形式はブラウザが表示できないことがあるため、JPEGやPNGでの取り込みをおすすめします。
        </p>
      </footer>
    </div>
  );
}
