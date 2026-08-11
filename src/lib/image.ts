import exifr from 'exifr';

export interface ImageMeta {
  takenAt: Date;
  takenAtFromExif: boolean;
  width: number;
  height: number;
}

/**
 * 撮影時刻はEXIFのDateTimeOriginalを最優先で使う。
 * スクリーンショットやEXIFを落とされた画像のために、ファイル更新日時にフォールバックする。
 */
export async function readImageMeta(file: File): Promise<ImageMeta> {
  let takenAt: Date | null = null;
  let width = 0;
  let height = 0;

  try {
    const exif = await exifr.parse(file, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'ModifyDate',
        'ExifImageWidth',
        'ExifImageHeight',
      ],
    });
    if (exif) {
      const candidate = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.ModifyDate;
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        takenAt = candidate;
      }
      width = exif.ExifImageWidth ?? 0;
      height = exif.ExifImageHeight ?? 0;
    }
  } catch {
    // EXIFが無い / 壊れている画像は珍しくないので、黙ってフォールバックする
  }

  if (width === 0 || height === 0) {
    try {
      const size = await readPixelSize(file);
      width = size.width;
      height = size.height;
    } catch {
      // サイズが取れなくても致命的ではない
    }
  }

  return {
    takenAt: takenAt ?? new Date(file.lastModified),
    takenAtFromExif: takenAt !== null,
    width,
    height,
  };
}

function readPixelSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

/** 長辺をmaxEdgeに収まるよう縮小したJPEGのdata URLを作る（Markdownへの埋め込み用）。 */
export async function toDataUrl(file: File, maxEdge = 1600, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('canvasを初期化できませんでした');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
