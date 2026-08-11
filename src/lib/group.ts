import { kindOf, type BuildOptions, type Photo, type PhotoKind, type Section } from '../types';
import { deriveTitle, meaningfulCharCount } from './text';

/**
 * 解説文のパネルか、展示物そのものかを文字量で判定する。
 * 展示物の写真にもキャプションの端が写り込むことがあるので、
 * 読み取れた文字が少ないもの・信頼度が低くて短いものは展示物とみなす。
 */
export function classifyPhoto(text: string, confidence: number, minChars: number): PhotoKind {
  const chars = meaningfulCharCount(text);
  if (chars < minChars) return 'exhibit';
  if (confidence < 35 && chars < minChars * 2) return 'exhibit';
  return 'caption';
}

function byTime(a: Photo, b: Photo): number {
  return a.takenAt.getTime() - b.takenAt.getTime();
}

/**
 * 撮影時刻をもとに、展示物の写真をいちばん近い解説文に寄せてセクションを組み立てる。
 * どの解説文からも離れている写真は、連続するものどうしでひとまとめにする。
 */
export function buildSections(photos: Photo[], opts: BuildOptions): Section[] {
  const sorted = [...photos].sort(byTime);
  const captions = sorted.filter((p) => kindOf(p) === 'caption');
  const exhibits = sorted.filter((p) => kindOf(p) === 'exhibit');
  const gapMs = Math.max(0, opts.groupGapMinutes) * 60_000;

  const before = new Map<string, Photo[]>();
  const after = new Map<string, Photo[]>();
  const orphans: Photo[] = [];

  for (const exhibit of exhibits) {
    let nearest: Photo | null = null;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (const caption of captions) {
      const delta = Math.abs(caption.takenAt.getTime() - exhibit.takenAt.getTime());
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearest = caption;
      }
    }

    if (nearest && nearestDelta <= gapMs) {
      const bucket = exhibit.takenAt.getTime() <= nearest.takenAt.getTime() ? before : after;
      const list = bucket.get(nearest.id) ?? [];
      list.push(exhibit);
      bucket.set(nearest.id, list);
    } else {
      orphans.push(exhibit);
    }
  }

  const sections: Section[] = captions.map((caption) => {
    const beforeList = (before.get(caption.id) ?? []).sort(byTime);
    const afterList = (after.get(caption.id) ?? []).sort(byTime);
    const startedAt = beforeList[0]?.takenAt ?? caption.takenAt;
    return {
      id: caption.id,
      title: deriveTitle(caption.text),
      caption,
      before: beforeList,
      after: afterList,
      startedAt,
    };
  });

  // 解説文に紐づかなかった展示物は、撮影が続いているものどうしでまとめる
  let cluster: Photo[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    sections.push({
      id: `orphan-${cluster[0].id}`,
      title: '',
      caption: null,
      before: cluster,
      after: [],
      startedAt: cluster[0].takenAt,
    });
    cluster = [];
  };
  for (const photo of orphans) {
    const last = cluster[cluster.length - 1];
    if (last && photo.takenAt.getTime() - last.takenAt.getTime() > gapMs) flush();
    cluster.push(photo);
  }
  flush();

  return sections.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

export function sectionPhotos(section: Section): Photo[] {
  return [...section.before, ...(section.caption ? [section.caption] : []), ...section.after];
}
