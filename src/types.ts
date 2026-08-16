/** idle = まだ読み取っていない。 */
export type PhotoStatus = 'idle' | 'reading' | 'done' | 'error';

/** 取り込んだ解説パネルの写真1枚。 */
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
  /** 表示・出力に使う本文。rawTextに設定を適用したもの。 */
  text: string;
  /** 読み取った直後の文章。設定を変えたときに組み直す元になる。 */
  rawText: string;
  /** Visionの信頼度 0-100 */
  confidence: number;
  /** 本文を手で直した／手入力したか */
  edited: boolean;
  error?: string;
}

/** メモの1項目。パネル1枚がそのまま1項目になる。 */
export interface Section {
  id: string;
  /** 見出しに使う先頭行。引き上げられなかった場合は空。 */
  title: string;
  /** 見出しを取り除いた本文。 */
  body: string;
  photo: Photo;
}

export interface BuildOptions {
  /** メモのタイトル */
  title: string;
  /** 画像の埋め込み方式 */
  imageMode: 'files' | 'dataurl';
  /** 画像を入れるフォルダ名（imageMode === 'files' のとき） */
  imageDir: string;
  /** 「。」などの文末まで改行せずにまとめるか */
  joinLinesAtSentence: boolean;
  /** 漢字に振られたふりがなの行を落とすか */
  dropFurigana: boolean;
  /** 日本語と併記された英文を落とすか */
  dropEnglishText: boolean;
  /** 読み取りの補足情報と写真一覧を書き出すか */
  includeOcrNotes: boolean;
  /** パネルの写真もMarkdownに載せるか */
  includePhotos: boolean;
}

export const defaultBuildOptions: BuildOptions = {
  title: '博物館 見学メモ',
  imageMode: 'files',
  imageDir: 'images',
  joinLinesAtSentence: true,
  dropFurigana: true,
  dropEnglishText: true,
  includeOcrNotes: true,
  includePhotos: false,
};
