import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PhotoCard from './components/PhotoCard';
import SettingsPanel from './components/SettingsPanel';
import OutlinePanel from './components/OutlinePanel';
import { readImageMeta } from './lib/image';
import { loadApiKey, recognize, saveApiKey } from './lib/vision';
import { buildSections } from './lib/group';
import { buildMarkdown, forgetDataUrl } from './lib/markdown';
import { copyToClipboard, downloadMarkdown, downloadZip } from './lib/download';
import { joinBySentence, sanitizeFileName } from './lib/text';
import { defaultBuildOptions, type BuildOptions, type Photo, type PhotoKind } from './types';

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

  /** 解説文として選ばれた写真だけをVision APIに送る。 */
  const runOcr = useCallback(
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
                  rawText: result.text,
                  text: optionsRef.current.joinLinesAtSentence
                    ? joinBySentence(result.text)
                    : result.text,
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

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
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
        // 取り込んだ時点では展示物。解説パネルは利用者が選ぶ。
        kind: 'exhibit',
        status: 'idle',
        text: '',
        rawText: '',
        confidence: 0,
        edited: false,
      });
    }

    setPhotos((prev) => [...prev, ...created].sort(byTime));
  }, []);

  /** 種別の切り替え。解説文にしたら、まだ読んでいなければそのまま読み取る。 */
  const changeKind = useCallback(
    (id: string, kind: PhotoKind) => {
      const target = photosRef.current.find((p) => p.id === id);
      if (!target || target.kind === kind) return;
      patchPhoto(id, { kind });
      if (kind === 'caption' && target.status === 'idle' && !target.text) {
        void runOcr({ ...target, kind });
      }
    },
    [patchPhoto, runOcr],
  );

  const retryOcr = useCallback(
    (id: string) => {
      const target = photosRef.current.find((p) => p.id === id);
      if (target) void runOcr(target);
    },
    [runOcr],
  );

  /** 解説文にしたのに未読のものをまとめて読み取る。 */
  const readAllCaptions = useCallback(async () => {
    const pending = photosRef.current.filter(
      (p) => p.kind === 'caption' && p.status !== 'done' && p.status !== 'reading',
    );
    for (const photo of pending) {
      await runOcr(photo);
    }
  }, [runOcr]);

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
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, text, edited: true } : p)),
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

  const updateApiKey = useCallback((key: string) => {
    setApiKey(key);
    saveApiKey(key);
  }, []);

  // 改行のまとめ方を切り替えたら、手を入れていない本文を組み直す
  useEffect(() => {
    setPhotos((prev) =>
      prev.map((p) =>
        p.edited || !p.rawText
          ? p
          : { ...p, text: options.joinLinesAtSentence ? joinBySentence(p.rawText) : p.rawText },
      ),
    );
  }, [options.joinLinesAtSentence]);

  const sections = useMemo(() => buildSections(photos, options), [photos, options]);

  const captionCount = photos.filter((p) => p.kind === 'caption').length;
  const readingCount = photos.filter((p) => p.status === 'reading').length;
  const unreadCount = photos.filter(
    (p) => p.kind === 'caption' && p.status !== 'done' && p.status !== 'reading' && !p.text,
  ).length;

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
          展示物と解説文の写真をまとめてアップロードし、解説パネルの写真を選ぶと、
          その文字をGoogle Cloud Visionで読み取って、撮影時刻の近い展示物写真を並べた
          Markdownの見学メモを作ります。Googleに送られるのは<strong>解説文に指定した写真だけ</strong>で、
          展示物の写真はブラウザから出ません。
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
          展示物も解説パネルも、まとめて選んで構いません。撮影時刻で自動的に並べます。
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
            <span>
              {photos.length}枚（解説文 {captionCount} / 展示物 {photos.length - captionCount}）・
              {sections.length}項目
            </span>
            {readingCount > 0 && <span className="reading">読み取り中… {readingCount}枚</span>}
            {unreadCount > 0 && readingCount === 0 && (
              <button type="button" onClick={() => void readAllCaptions()}>
                未読の解説文 {unreadCount}枚を読み取る
              </button>
            )}
            <button type="button" className="ghost danger" onClick={clearAll}>
              すべて消す
            </button>
          </div>

          <section>
            <h2>写真（{photos.length}枚）</h2>
            <p className="hint">
              解説パネルの写真を「解説文」に切り替えてください。切り替えた写真だけを読み取ります。
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
          文字の読み取りにはGoogle Cloud Vision API（DOCUMENT_TEXT_DETECTION）を使います。
          APIキーはこのブラウザにのみ保存され、送信先はGoogleだけです。
          HEICなど一部の形式はブラウザが表示できないことがあるため、JPEGやPNGでの取り込みをおすすめします。
        </p>
      </footer>
    </div>
  );
}
