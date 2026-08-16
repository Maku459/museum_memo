import type { Photo, Section } from '../types';
import { splitHeading } from './text';

function byTime(a: Photo, b: Photo): number {
  return a.takenAt.getTime() - b.takenAt.getTime();
}

/** 撮影時刻の順に並べ、パネル1枚を1項目にする。先頭行は見出しに回す。 */
export function buildSections(photos: Photo[]): Section[] {
  return [...photos].sort(byTime).map((photo) => {
    const { heading, body } = splitHeading(photo.text);
    return { id: photo.id, title: heading, body, photo };
  });
}
