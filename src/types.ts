/** 写真1枚の種別。caption = 解説文のパネル、exhibit = 展示物そのもの。 */
export type PhotoKind = 'caption' | 'exhibit';

export type PhotoStatus = 'pending' | 'reading' | 'done' | 'error';

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
  status: PhotoStatus;
  /** OCRの進捗 0-1 */
  progress: number;
  /** OCRで読み取った全文（整形済み） */
  text: string;
  /** OCRの平均信頼度 0-100 */
  confidence: number;
  /** 本文を手で直したか。直した文には信頼度の低さを理由にした判定を効かせない。 */
  edited: boolean;
  /** 自動判定された種別 */
  autoKind: PhotoKind;
  /** ユーザーが手動で上書きした種別。未指定ならautoKindを使う。 */
  manualKind?: PhotoKind;
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
  /** これ以上の文字数がOCRで取れたら解説文とみなす */
  captionMinChars: number;
  /** 画像の埋め込み方式 */
  imageMode: 'files' | 'dataurl';
  /** 画像を入れるフォルダ名（imageMode === 'files' のとき） */
  imageDir: string;
  /** 撮影時刻を各セクションに書き出すか */
  includeTimestamps: boolean;
  /** OCRの信頼度など、読み取りの補足情報を書き出すか */
  includeOcrNotes: boolean;
  /** 解説文の写真そのものもMarkdownに載せるか（OCRの答え合わせ用） */
  includeCaptionPhotos: boolean;
}

export const defaultBuildOptions: BuildOptions = {
  title: '博物館 見学メモ',
  groupGapMinutes: 5,
  captionMinChars: 30,
  imageMode: 'files',
  imageDir: 'images',
  includeTimestamps: true,
  includeOcrNotes: true,
  includeCaptionPhotos: false,
};

export function kindOf(photo: Photo): PhotoKind {
  return photo.manualKind ?? photo.autoKind;
}

/** 自動判定に使う信頼度。手入力・手直しした本文は信頼できるものとして扱う。 */
export function effectiveConfidence(photo: Pick<Photo, 'confidence' | 'edited'>): number {
  return photo.edited ? 100 : photo.confidence;
}
