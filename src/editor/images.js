/** Image helpers: images are embedded as data URLs so documents stay self-contained and private. */

export const MAX_IMAGE_EDGE = 1600; // px – larger images are scaled down to keep storage small
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image file.'));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be decoded as an image.'));
    img.src = src;
  });
}

/**
 * Convert an image File to a data URL, downscaling big raster images.
 * GIF and SVG are embedded untouched (re-encoding would drop animation / vectors).
 */
export async function fileToImageDataUrl(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`"${file.name || 'This file'}" is not a supported image type (use PNG, JPEG, GIF, WebP or SVG).`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('This image is larger than 15 MB. Please choose a smaller one.');
  }
  const original = await readAsDataUrl(file);
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { src: original, width: null };

  const img = await loadImage(original);
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= MAX_IMAGE_EDGE) return { src: original, width: img.naturalWidth };

  const scale = MAX_IMAGE_EDGE / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { src: canvas.toDataURL(type, 0.9), width: canvas.width };
}

export function isImageFile(file) {
  return file && file.type && file.type.startsWith('image/');
}
