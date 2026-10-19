const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toB64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random URL-safe token. 16 bytes for IDs, 32 bytes for secrets. */
export function randomToken(bytes = 32): string {
  return toB64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export const newId = () => randomToken(16);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Short code students can type, e.g. "K7PX-M2QD". */
export function joinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export async function sha256(text: string): Promise<string> {
  return toB64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const actual = await pbkdf2(password, fromB64(saltB64), Number(iter));
  return timingSafeEqual(actual, fromB64(hashB64));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

async function aesKey(secretB64: string): Promise<CryptoKey> {
  const raw = fromB64(secretB64);
  if (raw.length !== 32) throw new Error("KEY_ENCRYPTION_SECRET must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Encrypts a provider API key. `context` (teacher id + provider) is bound as
 * additional data, so a ciphertext copied to another row will not decrypt.
 */
export async function encryptSecret(secretB64: string, plaintext: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(context) },
    await aesKey(secretB64),
    enc.encode(plaintext),
  );
  return { ciphertext: toB64(ct), iv: toB64(iv) };
}

export async function decryptSecret(secretB64: string, ciphertext: string, iv: string, context: string) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv), additionalData: enc.encode(context) },
    await aesKey(secretB64),
    fromB64(ciphertext),
  );
  return dec.decode(pt);
}
