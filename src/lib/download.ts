import JSZip from 'jszip';
import type { BuildOptions, Photo } from '../types';
import { sanitizeFileName } from './text';

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // クリック直後に revoke するとダウンロードが始まらないブラウザがある
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function memoFileName(title: string): string {
  const base = sanitizeFileName(title.trim() || '博物館メモ');
  return `${base}.md`;
}

export function downloadMarkdown(markdown: string, title: string): void {
  saveBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), memoFileName(title));
}

/** Markdownと写真をまとめてZIPにする。相対パス参照のまま他の場所へ持ち出せる。 */
export async function downloadZip(
  markdown: string,
  photos: Photo[],
  opts: BuildOptions,
): Promise<void> {
  const zip = new JSZip();
  zip.file(memoFileName(opts.title), markdown);

  const dir = opts.imageDir.replace(/^\/+|\/+$/g, '') || 'images';
  for (const photo of photos) {
    zip.file(`${dir}/${photo.exportName}`, photo.file);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const base = sanitizeFileName(opts.title.trim() || '博物館メモ');
  saveBlob(blob, `${base}.zip`);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
