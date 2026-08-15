/** OCR結果の後処理と、日本語まじりテキストの小物ユーティリティ。 */

const CJK = '\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef';
const CJK_SPACE_RE = new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g');
const MEANINGFUL_RE = new RegExp(`[${CJK}0-9A-Za-z]`, 'g');

/**
 * Tesseractの日本語結果は文字ごとに空白が入りやすいので、
 * 全角・かな・漢字のあいだの空白を詰めたうえで行を整える。
 */
export function cleanOcrText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      let s = line.replace(/[ \t ]+/g, ' ').trim();
      // 「縄 文 土 器」→「縄文土器」。1回では隣接ペアを取りこぼすので繰り返す。
      let prev: string;
      do {
        prev = s;
        s = s.replace(CJK_SPACE_RE, '$1');
      } while (s !== prev);
      return s;
    });

  // 3行以上の空行は2行までに畳む
  const out: string[] = [];
  let blank = 0;
  for (const line of lines) {
    if (line === '') {
      blank += 1;
      if (blank > 1) continue;
    } else {
      blank = 0;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

/** 行をつなぐ。英数字どうしのときだけ空白を入れ、日本語はそのまま詰める。 */
export function concatLines(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const needsSpace = /[0-9A-Za-z]$/.test(left) && /^[0-9A-Za-z]/.test(right);
  return left + (needsSpace ? ' ' : '') + right;
}

/** 文の終わり。閉じ括弧が続くこともある。 */
const SENTENCE_END_RE = /[。．.！？!?…]["'」』）)】〕]*$/;
/** 箇条書きや番号で始まる行は、前の文につながずに独立させる。 */
const LIST_START_RE = /^([-–—・･*●○■□◆◇▲△※]|\(?\d+[.)．、）])/;
/** 見出しが本文とくっつかないよう、短い行はつなぎ元にしない。 */
const MIN_CHARS_TO_MERGE = 15;

/**
 * 「。」などの文末が来るまで改行しないようにまとめる。
 * パネルの折り返しで切れた文が、1文＝1行になる。
 */
export function joinBySentence(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const prev = out[out.length - 1];
    const mergeable =
      prev !== undefined &&
      prev !== '' &&
      line !== '' &&
      !SENTENCE_END_RE.test(prev) &&
      meaningfulCharCount(prev) >= MIN_CHARS_TO_MERGE &&
      !LIST_START_RE.test(line);

    if (mergeable) out[out.length - 1] = concatLines(prev, line);
    else out.push(line);
  }
  return out.join('\n');
}

/** 空白や記号を除いた「意味のある文字」の数。 */
export function meaningfulCharCount(text: string): number {
  return (text.match(MEANINGFUL_RE) ?? []).length;
}

/**
 * 解説文の1行目などから見出しを作る。
 * パネルの枠線や汚れが記号として読まれることが多いので、行頭の記号は落とす。
 */
const LEADING_NOISE_RE =
  /^[\s|｜│┃[\]{}()<>"'`*_#=+~^\\/—–\-.,:;、。・･「」『』【】〔〕［］（）〈〉…]+/;

export function deriveTitle(text: string, maxLen = 40): string {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(LEADING_NOISE_RE, '').trim();
    if (meaningfulCharCount(line) < 2) continue;
    return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
  }
  return '';
}

/** Markdownの見出しや強調として解釈されない形に整える。 */
export function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

/**
 * 本文としてMarkdownに埋め込むとき、行頭が見出し・リスト・引用に化けないようにする。
 * 本文中の記号は読みやすさのためそのまま残す。
 */
export function escapeMarkdownBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s*)([#>]|[-*+](?=\s)|\d+\.(?=\s))/, '$1\\$2'))
    .join('\n');
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${formatTime(d)}`;
}

/** ファイル名として安全な形に。日本語はそのまま残す。 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#\s]+/g, '_').replace(/_+/g, '_');
}
