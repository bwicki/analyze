// Browser-side preparation of a photo for upload: EXIF, orientation-corrected resize (long edge
// 2000 px, JPEG 0.85) and a thumbnail (360 px). Keeps uploads small (≈ 300–600 KB) and the viewer fast.

import { readExif } from './exif.js';

const LONG = 2000, THUMB = 360;

async function bitmapOf(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { return createImageBitmap(file); }
}
function draw(bmp, long, quality) {
  const scale = Math.min(1, long / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve) => c.toBlob((b) => resolve({ blob: b, w, h }), 'image/jpeg', quality));
}

/** @returns {{image: Blob, thumb: Blob, width, height, exif, cameraTime, exifTz}} */
export async function prepareUpload(file) {
  const buf = await file.arrayBuffer();
  const exif = readExif(buf);
  const bmp = await bitmapOf(file);
  const img = await draw(bmp, LONG, 0.85), th = await draw(bmp, THUMB, 0.8);
  bmp.close && bmp.close();
  let cameraTime = NaN, exifTz = null;
  if (exif && exif.dateTimeOriginal) {
    const m = exif.dateTimeOriginal.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) cameraTime = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + (exif.subSec ? Math.round(parseFloat('0.' + exif.subSec.replace(/\D/g, '')) * 1000) || 0 : 0);
    if (exif.offsetTime) { const z = exif.offsetTime.match(/^([+-])(\d{2}):?(\d{2})$/); if (z) exifTz = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]); }
  }
  if (Number.isNaN(cameraTime) && file.lastModified) cameraTime = NaN;   // no guessing from the file date – the user sets it
  return { image: img.blob, thumb: th.blob, width: img.w, height: img.h, exif, cameraTime, exifTz };
}
