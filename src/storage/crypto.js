// Password-based encryption for individual documents (Web Crypto: PBKDF2-SHA256 -> AES-GCM 256).
// Nothing here ever leaves the browser, and the password is never stored.

export const DEFAULT_ITERATIONS = 600_000;
export const MAX_ITERATIONS = 2_000_000;
export const MIN_PASSWORD = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && !!crypto.getRandomValues;
}

/** Derive an AES-GCM key from a password. */
export async function deriveKey(password, salt, iterations = DEFAULT_ITERATIONS) {
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new Error('Unsupported key-derivation setting.');
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function newSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** Encrypt JSON with a fresh IV. Returns the storable blob. */
export async function encryptJson(key, value, salt, iterations) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  return { v: 1, salt: toB64(salt), iv: toB64(iv), iterations, data: toB64(data) };
}

/** Decrypt a blob with a key. Throws if the key is wrong or the data was altered. */
export async function decryptJson(key, blob) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.data));
  return JSON.parse(dec.decode(plain));
}

/** Structural check used when restoring a backup. */
export function isValidBlob(b) {
  if (!b || typeof b !== 'object' || b.v !== 1) return false;
  if (!Number.isInteger(b.iterations) || b.iterations < 1 || b.iterations > MAX_ITERATIONS) return false;
  try {
    return fromB64(b.salt).length === 16 && fromB64(b.iv).length === 12 && fromB64(b.data).length >= 16 && fromB64(b.data).length < 200 * 1024 * 1024;
  } catch {
    return false;
  }
}
