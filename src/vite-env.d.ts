/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 言語データ(*.traineddata)の取得元。未設定ならtesseract.jsの既定（CDN）を使う。 */
  readonly VITE_TESSDATA_PATH?: string;
  /** OCRワーカー(worker.min.js)のURL。 */
  readonly VITE_TESS_WORKER_PATH?: string;
  /** tesseract.js-core(wasm)を置いたディレクトリのURL。 */
  readonly VITE_TESS_CORE_PATH?: string;
  /** 自前の traineddata が .gz でない場合は 'false' を指定する。 */
  readonly VITE_TESSDATA_GZIP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
