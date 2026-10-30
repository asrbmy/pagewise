/**
 * Tiny, dependency-free helpers for embedding images in .docx files:
 *  - decode a data: URL into bytes + mime type
 *  - read pixel dimensions straight from PNG / JPEG / GIF headers (no <canvas>, so it works in tests)
 */

export function parseDataUrl(src) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src || '');
  if (!m) return null;
  const mime = m[1].toLowerCase();
  let bytes;
  if (m[2]) {
    const bin = atob(m[3].replace(/\s/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
  }
  return { mime, bytes };
}

/** @returns {{width:number,height:number}|null} */
export function imageSize(bytes, mime) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mime === 'image/png' && bytes.length > 24) {
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === 'image/gif' && bytes.length > 10) {
      return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
    }
    if ((mime === 'image/jpeg' || mime === 'image/jpg') && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (mime === 'image/bmp' && bytes.length > 26) {
      return { width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
    }
  } catch {
    /* fall through */
  }
  return null;
}
