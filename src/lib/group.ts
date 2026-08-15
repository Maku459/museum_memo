import type { BuildOptions, Photo, Section } from '../types';
import { deriveTitle } from './text';

function byTime(a: Photo, b: Photo): number {
  return a.takenAt.getTime() - b.takenAt.getTime();
}

/**
 * 撮影時刻をもとに、展示物の写真をいちばん近い解説文に寄せてセクションを組み立てる。
 * どの解説文からも離れている写真は、連続するものどうしでひとまとめにする。
 */
export function buildSections(photos: Photo[], opts: BuildOptions): Section[] {
  const sorted = [...photos].sort(byTime);
  const captions = sorted.filter((p) => p.kind === 'caption');
  const exhibits = sorted.filter((p) => p.kind === 'exhibit');
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
