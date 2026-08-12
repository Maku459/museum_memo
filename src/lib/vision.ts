/**
 * Google Cloud Vision API（DOCUMENT_TEXT_DETECTION）で解説パネルの文字を読み取る。
 *
 * このアプリはサーバーを持たないため、APIキーは利用者が画面から入力し、
 * ブラウザのlocalStorageにだけ保存する。ビルドに埋め込むことは絶対にしない
 * （公開サイトに置くとキーがそのまま漏れるため）。
 */
import { cleanOcrText } from './text';

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const STORAGE_KEY = 'museum-memo.vision-api-key';

export interface OcrResult {
  text: string;
  /** 0-100。Visionのページ単位の信頼度をならしたもの。 */
  confidence: number;
}

export function loadApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // プライベートモードなどで保存できなくても、その回の実行は続けられる
  }
}

/** 送信量を抑えるため、長辺を落としたJPEGのbase64（data: URLの接頭辞なし）にする。 */
async function toBase64Jpeg(file: File, maxEdge = 1800, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('画像を変換できませんでした。');
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
}

interface VisionPage {
  confidence?: number;
}

interface VisionResponse {
  fullTextAnnotation?: { text?: string; pages?: VisionPage[] };
  error?: { code?: number; message?: string; status?: string };
}

/** 返ってきたエラーを、利用者が次に何をすればいいか分かる日本語にする。 */
function describeError(status: number, message: string): string {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(message)) {
    return 'APIキーが正しくありません。設定を確認してください。';
  }
  if (status === 403) {
    if (/referer|referrer|blocked/i.test(message)) {
      return `APIキーの制限でこのサイトからの呼び出しが拒否されました。Google Cloudでキーのウェブサイト制限に、このページのURLを追加してください。（${message}）`;
    }
    if (/has not been used|disabled|SERVICE_DISABLED/i.test(message)) {
      return `プロジェクトでCloud Vision APIが有効になっていません。Google Cloudコンソールで有効化してください。（${message}）`;
    }
    return `APIキーの権限が足りません。（${message}）`;
  }
  if (status === 429) {
    return '呼び出し回数の上限に達しました。しばらく待つか、Google Cloudの割り当てを確認してください。';
  }
  return message || `Vision APIの呼び出しに失敗しました（HTTP ${status}）。`;
}

/** 解説パネル1枚を読み取る。 */
export async function recognize(
  file: File,
  apiKey: string,
  signal?: AbortSignal,
): Promise<OcrResult> {
  if (!apiKey) throw new Error('Vision APIのキーが設定されていません。');

  const content = await toBase64Jpeg(file);

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      requests: [
        {
          image: { content },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          // 解説パネルは縦書きや旧字体も多いので、日本語を明示して英語も許す
          imageContext: { languageHints: ['ja', 'en'] },
        },
      ],
    }),
  });

  const body = (await res.json().catch(() => null)) as
    | { responses?: VisionResponse[]; error?: { code?: number; message?: string } }
    | null;

  if (!res.ok) {
    throw new Error(describeError(res.status, body?.error?.message ?? ''));
  }

  const first = body?.responses?.[0];
  if (first?.error) {
    throw new Error(describeError(first.error.code ?? res.status, first.error.message ?? ''));
  }

  const annotation = first?.fullTextAnnotation;
  const pages = annotation?.pages ?? [];
  const confidences = pages.map((p) => p.confidence).filter((c): c is number => typeof c === 'number');
  const confidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
      : 0;

  return { text: cleanOcrText(annotation?.text ?? ''), confidence };
}
