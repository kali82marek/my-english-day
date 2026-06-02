/**
 * Hashowanie haseł na edge (Cloudflare Workers) bez zależności od Node `crypto`.
 *
 * Workers nie udostępniają `bcrypt`/Node `crypto`, więc używamy Web Crypto
 * (`crypto.subtle`) z PBKDF2-HMAC-SHA256. Sól jest losowa per hash i zapisana
 * razem z parametrami w jednym polu, by weryfikacja mogła odtworzyć derivację.
 *
 * Format zapisu: `pbkdf2$<iteracje>$<sól_b64>$<hash_b64>`
 */

const HASH_PREFIX = 'pbkdf2';
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveBits(
  plain: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

/** Porównanie w czasie stałym, by nie wyciekać informacji timingiem. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Hashuje hasło z losową solą; zwraca samodzielny string do zapisu w bazie. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(plain, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

/** Weryfikuje hasło względem zapisanego hasha. Bezpieczne dla zniekształconych danych. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) {
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const derived = await deriveBits(plain, salt, iterations);
  return timingSafeEqual(derived, expected);
}
