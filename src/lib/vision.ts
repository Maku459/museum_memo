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
  /** 読み取った全文（ルビを含む） */
  text: string;
  /** 本文より小さく組まれたかな（ルビ）を落とした全文 */
  textWithoutRuby: string;
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

type BreakType = 'SPACE' | 'SURE_SPACE' | 'EOL_SURE_SPACE' | 'LINE_BREAK' | 'HYPHEN' | 'UNKNOWN';

interface VisionSymbol {
  text?: string;
  boundingBox?: BoundingPoly;
  property?: { detectedBreak?: { type?: BreakType } };
}

interface VisionWord {
  symbols?: VisionSymbol[];
  boundingBox?: BoundingPoly;
}

interface VisionParagraph {
  words?: VisionWord[];
}

interface VisionBlock {
  paragraphs?: VisionParagraph[];
}

interface BoundingPoly {
  vertices?: { x?: number; y?: number }[];
}

interface VisionPage {
  confidence?: number;
  blocks?: VisionBlock[];
}

interface VisionAnnotation {
  text?: string;
  pages?: VisionPage[];
}

interface VisionResponse {
  fullTextAnnotation?: VisionAnnotation;
  error?: { code?: number; message?: string; status?: string };
}

/** ルビは本文より小さく組まれる。本文の何割より細ければルビとみなすか。 */
const RUBY_THICKNESS_RATIO = 0.6;
/** ルビはかなで振られる。漢字や英数字を含む語は、小さくてもルビとみなさない。 */
const KANA_ONLY_RE = /^[ぁ-ゖァ-ヺーゝゞヽヾ\s]+$/;

/**
 * 文字の「太さ」。縦書きは幅、横書きは高さが文字の大きさを表すので、短い方の辺を採る。
 * Visionは書字方向を返さないが、縦書きの語は縦長・横書きの語は横長になるため、
 * 短辺を見れば両方を同じ尺度で比べられる。
 */
function boxThickness(box: BoundingPoly | undefined): number {
  const vertices = box?.vertices ?? [];
  if (vertices.length === 0) return 0;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.min(width, height);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function wordsOf(page: VisionPage): VisionWord[] {
  return (page.blocks ?? []).flatMap((b) => (b.paragraphs ?? []).flatMap((p) => p.words ?? []));
}

/** 語の太さ。boundingBoxが無ければ文字の太さから拾う。 */
function wordThickness(word: VisionWord): number {
  const t = boxThickness(word.boundingBox);
  if (t > 0) return t;
  return median((word.symbols ?? []).map((s) => boxThickness(s.boundingBox)).filter((v) => v > 0));
}

function wordText(word: VisionWord): string {
  return (word.symbols ?? []).map((s) => s.text ?? '').join('');
}

/**
 * fullTextAnnotation.text はパネルの見た目の1行ごとに改行が入っている。
 * Visionは行末（EOL_SURE_SPACE）と段落末（LINE_BREAK）を区別しているので、
 * 構造をたどり直して「段落＝1行」の形に組み直す。
 *
 * `skipRuby` を立てると、本文より小さく組まれたかなだけの語（ルビ）を落とす。
 * 語ごと落としても行や段落の区切りは残すので、文のつながりは崩れない。
 */
function textFromAnnotation(annotation: VisionAnnotation | undefined, skipRuby: boolean): string {
  const paragraphs: string[] = [];

  for (const page of annotation?.pages ?? []) {
    // ページごとに本文の文字の太さを見積もる（見出しやルビに引っぱられにくい中央値）
    const thicknesses = wordsOf(page)
      .map(wordThickness)
      .filter((t) => t > 0);
    const bodyThickness = median(thicknesses);
    const rubyLimit = bodyThickness * RUBY_THICKNESS_RATIO;

    const isRuby = (word: VisionWord): boolean => {
      if (!skipRuby || rubyLimit <= 0) return false;
      const thickness = wordThickness(word);
      if (thickness <= 0 || thickness >= rubyLimit) return false;
      // かなだけの語に限る。小さく組まれた注記（漢字や数字を含む）は残す。
      const text = wordText(word);
      return text.trim() !== '' && KANA_ONLY_RE.test(text);
    };

    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        const lines: string[] = [];
        let line = '';
        for (const word of paragraph.words ?? []) {
          const drop = isRuby(word);
          for (const symbol of word.symbols ?? []) {
            if (!drop) line += symbol.text ?? '';
            switch (symbol.property?.detectedBreak?.type) {
              case 'SPACE':
              case 'SURE_SPACE':
                if (!drop) line += ' ';
                break;
              case 'EOL_SURE_SPACE':
              case 'LINE_BREAK':
                lines.push(line);
                line = '';
                break;
              case 'HYPHEN':
                // 行またぎのハイフンは落として続きをつなぐ
                line = line.replace(/[-‐-]$/, '');
                lines.push(line);
                line = '';
                break;
              default:
                break;
            }
          }
        }
        if (line) lines.push(line);
        const joined = joinWrappedLines(lines);
        if (joined) paragraphs.push(joined);
      }
    }
  }

  // 構造が取れないときは素のテキストで妥協する
  return paragraphs.length > 0 ? paragraphs.join('\n') : (annotation?.text ?? '');
}

/** 折り返しでできた行をつなぐ。英単語どうしのときだけ空白を入れる。 */
function joinWrappedLines(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .reduce((acc, line) => {
      if (!acc) return line;
      const left = acc[acc.length - 1];
      const right = line[0];
      const needsSpace = /[0-9A-Za-z]/.test(left) && /[0-9A-Za-z]/.test(right);
      return acc + (needsSpace ? ' ' : '') + line;
    }, '');
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

  return {
    text: cleanOcrText(textFromAnnotation(annotation, false)),
    textWithoutRuby: cleanOcrText(textFromAnnotation(annotation, true)),
    confidence,
  };
}
