import type { Photo, Section } from '../types';
import { deriveTitle } from './text';

function byTime(a: Photo, b: Photo): number {
  return a.takenAt.getTime() - b.takenAt.getTime();
}

/** 撮影時刻の順に並べ、パネル1枚を1項目にする。 */
export function buildSections(photos: Photo[]): Section[] {
  return [...photos].sort(byTime).map((photo) => ({
    id: photo.id,
    title: deriveTitle(photo.text),
    photo,
  }));
}
