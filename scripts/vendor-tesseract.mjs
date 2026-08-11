/**
 * OCRの実行ファイル一式を public/tesseract/ にコピーする。
 *
 * 既定ではtesseract.jsがCDNからワーカーとwasmを取りに行くため、
 * 外部への接続が制限された環境ではOCRが動かない。
 * このスクリプトで手元に配置し、.env で参照先を切り替える（README参照）。
 *
 *   node scripts/vendor-tesseract.mjs
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const outDir = join(root, 'public', 'tesseract');
const coreDir = join(root, 'node_modules', 'tesseract.js-core');
const workerFile = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');

await mkdir(outDir, { recursive: true });
await copyFile(workerFile, join(outDir, 'worker.min.js'));
console.log('copied worker.min.js');

const coreFiles = (await readdir(coreDir)).filter((f) => /^tesseract-core.*\.(js|wasm)$/.test(f));
for (const file of coreFiles) {
  await copyFile(join(coreDir, file), join(outDir, file));
}
console.log(`copied ${coreFiles.length} core files`);

console.log(`
言語データは別途ダウンロードして public/tessdata/ に置いてください:

  mkdir -p public/tessdata
  curl -L -o public/tessdata/jpn.traineddata.gz https://tessdata.projectnaptha.com/4.0.0/jpn.traineddata.gz
  curl -L -o public/tessdata/eng.traineddata.gz https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz

そのうえで .env に次を書きます:

  VITE_TESS_WORKER_PATH=./tesseract/worker.min.js
  VITE_TESS_CORE_PATH=./tesseract
  VITE_TESSDATA_PATH=./tessdata
`);
