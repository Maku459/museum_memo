/** 写真1枚の種別。caption = 解説文のパネル、exhibit = 展示物そのもの。 */
export type PhotoKind = 'caption' | 'exhibit';

/** idle = 読み取っていない（展示物はここで止まる）。 */
export type PhotoStatus = 'idle' | 'reading' | 'done' | 'error';

export interface Photo {
  id: string;
  file: File;
  /** プレビュー・Markdown埋め込み用のObject URL */
  url: string;
  /** Markdown / ZIP 内で使うファイル名（重複しないように調整済み） */
  exportName: string;
  /** EXIFの撮影日時。取れなければファイルの更新日時。 */
  takenAt: Date;
  /** 撮影日時をEXIFから取得できたか（falseならファイル更新日時のフォールバック） */
  takenAtFromExif: boolean;
  width: number;
  height: number;
  /** 展示物か解説文か。取り込み時は展示物で、利用者が解説文に切り替える。 */
  kind: PhotoKind;
  status: PhotoStatus;
  /** 読み取った全文（整形済み）。表示・出力に使うのはこちら。 */
  text: string;
  /** 読み取った直後の文章。設定を変えたときに組み直す元になる。 */
  rawText: string;
  /** Visionの信頼度 0-100 */
  confidence: number;
  /** 本文を手で直した／手入力したか */
  edited: boolean;
  error?: string;
}

/** 解説文1枚と、それに紐づく展示物写真のまとまり。 */
export interface Section {
  id: string;
  /** 見出し（解説文の1行目など）。 */
  title: string;
  /** 解説文の写真。展示物だけのセクションではnull。 */
  caption: Photo | null;
  /** 解説文より前に撮られた展示物写真 */
  before: Photo[];
  /** 解説文より後に撮られた展示物写真 */
  after: Photo[];
  /** セクション内で最初に撮影された時刻 */
  startedAt: Date;
}

export interface BuildOptions {
  /** メモのタイトル */
  title: string;
  /** 展示物写真を解説文に紐づける最大の時間差（分） */
  groupGapMinutes: number;
  /** 画像の埋め込み方式 */
  imageMode: 'files' | 'dataurl';
  /** 画像を入れるフォルダ名（imageMode === 'files' のとき） */
  imageDir: string;
  /** 「。」などの文末まで改行せずにまとめるか */
  joinLinesAtSentence: boolean;
  /** 撮影時刻を各セクションに書き出すか */
  includeTimestamps: boolean;
  /** OCRの信頼度など、読み取りの補足情報を書き出すか */
  includeOcrNotes: boolean;
  /** 解説文の写真そのものもMarkdownに載せるか（読み取りの答え合わせ用） */
  includeCaptionPhotos: boolean;
}

export const defaultBuildOptions: BuildOptions = {
  title: '博物館 見学メモ',
  groupGapMinutes: 5,
  imageMode: 'files',
  imageDir: 'images',
  joinLinesAtSentence: true,
  includeTimestamps: true,
  includeOcrNotes: true,
  includeCaptionPhotos: false,
};
