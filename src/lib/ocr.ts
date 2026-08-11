import { createWorker, type Worker } from 'tesseract.js';
import { cleanOcrText } from './text';

export interface OcrResult {
  text: string;
  confidence: number;
}

export type ProgressFn = (progress: number, status: string) => void;

/**
 * 既定ではtesseract.jsのCDNからワーカー・wasm・言語データを取得する。
 * 社内ネットワークやオフラインで使う場合は npm run vendor:tesseract で
 * public/tesseract/ に配置し、.env で下の各パスを指定する（README参照）。
 */
const LANG_PATH: string | undefined = import.meta.env.VITE_TESSDATA_PATH || undefined;
const WORKER_PATH: string | undefined = import.meta.env.VITE_TESS_WORKER_PATH || undefined;
const CORE_PATH: string | undefined = import.meta.env.VITE_TESS_CORE_PATH || undefined;
/** 自前で置いた traineddata を展開済み(.gz でない)にする場合は false を指定する。 */
const LANG_GZIP: boolean = import.meta.env.VITE_TESSDATA_GZIP !== 'false';
const LANGS = 'jpn+eng';

/** ワーカーの準備そのものに失敗したときの目印。写真ごとではなく画面全体に一度だけ知らせる。 */
export const ENGINE_ERROR_PREFIX = 'OCRエンジンを準備できませんでした';

let workerPromise: Promise<Worker> | null = null;
/** createWorkerのloggerは生成時に固定されるので、実行中ジョブのコールバックを差し替えて使う。 */
let activeProgress: ProgressFn | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(LANGS, 1, {
      ...(LANG_PATH ? { langPath: LANG_PATH, gzip: LANG_GZIP } : {}),
      ...(WORKER_PATH ? { workerPath: WORKER_PATH } : {}),
      ...(CORE_PATH ? { corePath: CORE_PATH } : {}),
      logger: (m: { status: string; progress: number }) => {
        activeProgress?.(m.progress ?? 0, m.status ?? '');
      },
    }).catch((err) => {
      // 次の実行で作り直せるようにキャッシュを捨てる
      workerPromise = null;
      throw new Error(
        `${ENGINE_ERROR_PREFIX}。` +
          'ワーカー・wasm・言語データのいずれかを取得できていません' +
          '（外部への接続が制限された環境では npm run vendor:tesseract で手元に配置できます）。' +
          `詳細: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
  return workerPromise;
}

/** OCRは同時に走らせても速くならないので、1件ずつ順番に処理する。 */
let queue: Promise<unknown> = Promise.resolve();

export function recognize(image: File | HTMLCanvasElement, onProgress?: ProgressFn): Promise<OcrResult> {
  const run = async (): Promise<OcrResult> => {
    const worker = await getWorker();
    activeProgress = onProgress ?? null;
    try {
      const { data } = await worker.recognize(image);
      return {
        text: cleanOcrText(data.text ?? ''),
        confidence: Math.round(data.confidence ?? 0),
      };
    } finally {
      activeProgress = null;
    }
  };

  const result = queue.then(run, run);
  // 1件失敗しても後続を止めない
  queue = result.catch(() => undefined);
  return result;
}

export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) {
    try {
      (await p).terminate();
    } catch {
      // 後片付けの失敗は無視してよい
    }
  }
}

/**
 * スマホの写真は4000px級で、そのままOCRにかけると遅いだけで精度も上がらない。
 * 長辺を抑えたcanvasに描き直して渡す。
 */
export async function prepareForOcr(file: File, maxEdge = 2200): Promise<HTMLCanvasElement | File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas;
  } catch {
    // createImageBitmapが使えない環境ではファイルをそのまま渡す
    return file;
  }
}
