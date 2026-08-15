import type { BuildOptions, Photo, Section } from '../types';
import { toDataUrl } from './image';
import {
  escapeMarkdownBlock,
  escapeMarkdownInline,
  formatDate,
  formatDateTime,
  formatTime,
} from './text';

/** data URLの変換は重いので、写真ごとに一度だけ作って作り直しをまたいで使い回す。 */
const dataUrlCache = new Map<string, string>();

/** 画像の参照先を解決する。 */
async function makeSrcResolver(
  photos: Photo[],
  opts: BuildOptions,
): Promise<(photo: Photo) => string> {
  if (opts.imageMode === 'files') {
    const dir = opts.imageDir.replace(/^\/+|\/+$/g, '');
    return (photo) => (dir ? `${dir}/${encodeURI(photo.exportName)}` : encodeURI(photo.exportName));
  }

  for (const photo of photos) {
    if (dataUrlCache.has(photo.id)) continue;
    try {
      dataUrlCache.set(photo.id, await toDataUrl(photo.file));
    } catch {
      dataUrlCache.set(photo.id, encodeURI(photo.exportName));
    }
  }
  return (photo) => dataUrlCache.get(photo.id) ?? encodeURI(photo.exportName);
}

export function forgetDataUrl(photoId: string): void {
  dataUrlCache.delete(photoId);
}

/** 本文が読み取り由来か手入力かを示す補足。信頼度は読み取ったときだけ意味がある。 */
function sourceNote(photo: Photo): string {
  if (photo.status !== 'done') return `手入力: ${photo.exportName}`;
  const detail = photo.edited
    ? `信頼度 ${photo.confidence}% / 手直しあり`
    : `信頼度 ${photo.confidence}%`;
  return `読み取り: ${photo.exportName}（${detail}）`;
}

function imageBlock(photo: Photo, alt: string, src: string, opts: BuildOptions): string {
  const lines = [`![${escapeMarkdownInline(alt)}](${src})`];
  const notes: string[] = [];
  if (opts.includeTimestamps) notes.push(`${formatTime(photo.takenAt)} 撮影`);
  if (opts.imageMode === 'files') notes.push(photo.exportName);
  if (notes.length > 0) lines.push(`*${notes.join(' — ')}*`);
  return lines.join('\n');
}

/** 見学メモ本体を組み立てる。解説文のOCR結果は省略せず全文を入れる。 */
export async function buildMarkdown(
  photos: Photo[],
  sections: Section[],
  opts: BuildOptions,
): Promise<string> {
  const used = sections.flatMap((s) => [
    ...s.before,
    ...s.after,
    ...(s.caption && opts.includeCaptionPhotos ? [s.caption] : []),
  ]);
  const srcOf = await makeSrcResolver(used, opts);

  const blocks: string[] = [];
  blocks.push(`# ${opts.title.trim() || '博物館 見学メモ'}`);

  const sorted = [...photos].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  if (sorted.length > 0) {
    const first = sorted[0].takenAt;
    const last = sorted[sorted.length - 1].takenAt;
    const day =
      formatDate(first) === formatDate(last)
        ? formatDate(first)
        : `${formatDate(first)} 〜 ${formatDate(last)}`;
    const captionCount = photos.filter((p) => p.kind === 'caption').length;
    const meta = [
      `- 訪問日: ${day}（${formatTime(first)}〜${formatTime(last)}）`,
      `- 写真: ${photos.length}枚（解説文 ${captionCount}枚 / 展示物 ${
        photos.length - captionCount
      }枚）`,
      `- 項目: ${sections.length}件`,
    ];
    blocks.push(meta.join('\n'));
  }

  if (opts.includeOcrNotes) {
    blocks.push(
      '> 解説文はCloud Vision APIで読み取ったものです。誤読が残っている場合があります。',
    );
  }

  blocks.push('---');

  sections.forEach((section, index) => {
    const number = index + 1;
    const title = section.title || (section.caption ? `展示 ${number}` : '展示物（解説なし）');
    blocks.push(`## ${number}. ${escapeMarkdownInline(title)}`);

    if (opts.includeTimestamps) {
      blocks.push(`*${formatDateTime(section.startedAt)}*`);
    }

    for (const photo of section.before) {
      blocks.push(imageBlock(photo, title, srcOf(photo), opts));
    }

    if (section.caption) {
      const body = section.caption.text.trim();
      if (body) {
        blocks.push(escapeMarkdownBlock(body));
      } else {
        blocks.push('*（このパネルからは文字を読み取れませんでした）*');
      }
      if (opts.includeOcrNotes) {
        blocks.push(`*${sourceNote(section.caption)}*`);
      }
      if (opts.includeCaptionPhotos) {
        blocks.push(imageBlock(section.caption, `${title}（解説パネル）`, srcOf(section.caption), opts));
      }
    }

    for (const photo of section.after) {
      blocks.push(imageBlock(photo, title, srcOf(photo), opts));
    }
  });

  if (opts.includeOcrNotes && sorted.length > 0) {
    blocks.push('---');
    blocks.push('## 付録: 写真一覧');
    const rows = sorted.map((photo) => {
      const time = `${formatDateTime(photo.takenAt)}${photo.takenAtFromExif ? '' : '（推定）'}`;
      const kind = photo.kind === 'caption' ? '解説文' : '展示物';
      return `| ${photo.exportName} | ${time} | ${kind} |`;
    });
    blocks.push(['| ファイル | 撮影日時 | 種別 |', '| --- | --- | --- |', ...rows].join('\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}
