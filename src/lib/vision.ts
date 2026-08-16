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

// ---- Visionの応答（必要なところだけ） ----

type BreakType = 'SPACE' | 'SURE_SPACE' | 'EOL_SURE_SPACE' | 'LINE_BREAK' | 'HYPHEN' | 'UNKNOWN';

interface BoundingPoly {
  vertices?: { x?: number; y?: number }[];
}

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

interface VisionPage {
  confidence?: number;
  blocks?: VisionBlock[];
}

export interface VisionAnnotation {
  text?: string;
  pages?: VisionPage[];
}

interface VisionResponse {
  fullTextAnnotation?: VisionAnnotation;
  error?: { code?: number; message?: string; status?: string };
}

// ---- ルビの判定 ----

/** ルビとみなす大きさの既定値。いちばん小さい本文の何割未満なら落とすか。 */
export const DEFAULT_RUBY_RATIO = 0.7;

/**
 * 「いちばん小さい本文」を採るときの位置。最小値そのものだと、
 * かすれや汚れを1文字と誤認したときに基準が壊れるので、少し内側から採る。
 */
const SMALLEST_TEXT_PERCENTILE = 0.1;

/** ルビはかなで振られる。漢字・英数字を含む語は、小さくてもルビとみなさない。 */
const KANA_ONLY_RE = /^[ぁ-ゖァ-ヺーゝゞヽヾ・･、。\s]+$/;
/** かなが1文字も無い語（「、」「。」だけの語など）はルビではない。 */
const KANA_RE = /[ぁ-ゖァ-ヺ]/;
/** 大きさの基準に使う文字。ほぼ正方形に組まれるので比べやすい。 */
const KANJI_RE = /[㐀-䶿一-鿿]/;
/** 英文とみなすのに必要なアルファベットの数。単位や記号だけの行を巻き込まないための下限。 */
const MIN_LATIN_LETTERS = 8;
/** 日本語がまじる行は英文とみなさない。 */
const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿]/;

function isEnglishLine(line: string): boolean {
  if (JAPANESE_RE.test(line)) return false;
  return (line.match(/[A-Za-z]/g) ?? []).length >= MIN_LATIN_LETTERS;
}

export interface ExtractOptions {
  /** ルビを落とすか */
  dropRuby: boolean;
  /** いちばん小さい本文の何割未満をルビとみなすか（0-1） */
  rubyRatio: number;
  /** 英文だけの行を落とすか */
  dropEnglish: boolean;
}

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
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

function symbolsOf(page: VisionPage): VisionSymbol[] {
  return (page.blocks ?? []).flatMap((b) =>
    (b.paragraphs ?? []).flatMap((p) => (p.words ?? []).flatMap((w) => w.symbols ?? [])),
  );
}

/**
 * 語の太さ。文字ごとの太さの**最大**を採り、無ければ語の枠から拾う。
 *
 * 「、」「。」は字面が小さく、枠も小さく返ってくる。平均や中央値だと
 * 「た。」のような語がその分だけ細く見え、本文なのにルビ扱いされてしまう。
 * ルビの語はどの文字も小さいので、最大を見ても取りこぼさない。
 */
function wordThickness(word: VisionWord): number {
  const perSymbol = (word.symbols ?? [])
    .map((s) => boxThickness(s.boundingBox))
    .filter((v) => v > 0);
  if (perSymbol.length > 0) return Math.max(...perSymbol);
  return boxThickness(word.boundingBox);
}

function wordText(word: VisionWord): string {
  return (word.symbols ?? []).map((s) => s.text ?? '').join('');
}

/**
 * ページ内で**いちばん小さい本文**の文字の大きさ。ルビはこれよりさらに小さい。
 *
 * 漢字だけを見るのが要点。
 * - ルビは必ずかなで振られるので、漢字はすべて本文（見出し・奥付を含む）。
 * - ラテン文字は字ごとに縦横比が違い（`i` と `m`）、短辺が字幅になるため基準に使えない。
 *   漢字はほぼ正方形なので比べやすい。
 *
 * 中央値ではなく下側から採る。パネルには見出し・本文・奥付と大きさの違う文が並び、
 * 小さめの文（奥付など）が多いと中央値が下がって、ルビとの差が無くなってしまう。
 * 「いちばん小さい本文より、さらに小さいか」で見れば、どの大きさの文とも取り違えない。
 */
function smallestTextThickness(page: VisionPage): number {
  const symbols = symbolsOf(page).filter((s) => (s.text ?? '').trim() !== '');
  const thickness = (s: VisionSymbol) => boxThickness(s.boundingBox);

  const kanji = symbols
    .filter((s) => KANJI_RE.test(s.text ?? ''))
    .map(thickness)
    .filter((v) => v > 0);
  if (kanji.length > 0) return percentile(kanji, SMALLEST_TEXT_PERCENTILE);

  // 漢字が無いパネルでは基準を作れないので、全文字から採る
  return percentile(symbols.map(thickness).filter((v) => v > 0), SMALLEST_TEXT_PERCENTILE);
}

/**
 * fullTextAnnotation.text はパネルの見た目の1行ごとに改行が入っている。
 * Visionは行末（EOL_SURE_SPACE）と段落末（LINE_BREAK）を区別しているので、
 * 構造をたどり直して「段落＝1行」の形に組み直す。
 *
 * あわせて、本文より小さく組まれたかなだけの語（ルビ）を落とす。
 * 語ごと落としても行や段落の区切りは残すので、文のつながりは崩れない。
 */
export function extractText(
  annotation: VisionAnnotation | null | undefined,
  opts: ExtractOptions,
): string {
  const paragraphs: string[] = [];

  for (const page of annotation?.pages ?? []) {
    const rubyLimit = smallestTextThickness(page) * opts.rubyRatio;

    const isRuby = (word: VisionWord): boolean => {
      if (!opts.dropRuby || rubyLimit <= 0) return false;
      const thickness = wordThickness(word);
      if (thickness <= 0 || thickness >= rubyLimit) return false;
      // かなを含み、かつかなと句読点しか含まない語だけをルビとする。
      // 「、」「。」だけの語は字面が小さいが、本文の一部なので落とさない。
      const text = wordText(word);
      return KANA_RE.test(text) && KANA_ONLY_RE.test(text);
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
        // 和文と英文が同じ段落に入っていることがあるので、つなぐ前に行ごとに捨てる
        const kept = opts.dropEnglish ? lines.filter((l) => !isEnglishLine(l)) : lines;
        const joined = joinWrappedLines(kept);
        if (joined) paragraphs.push(joined);
      }
    }
  }

  // 構造が取れないときは素のテキストで妥協する
  return cleanOcrText(paragraphs.length > 0 ? paragraphs.join('\n') : (annotation?.text ?? ''));
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

// ---- 呼び出し ----

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

export interface OcrResult {
  /** 読み取った構造。設定を変えたらこれから組み直すので、読み取り直さずに済む。 */
  annotation: VisionAnnotation | null;
  /** 0-100。Visionのページ単位の信頼度をならしたもの。 */
  confidence: number;
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

  const annotation = first?.fullTextAnnotation ?? null;
  const confidences = (annotation?.pages ?? [])
    .map((p) => p.confidence)
    .filter((c): c is number => typeof c === 'number');
  const confidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
      : 0;

  return { annotation, confidence };
}
