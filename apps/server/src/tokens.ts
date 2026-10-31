import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX = 'bgk_';
export const TOKEN_BYTES = 32;

/** 32 bytes in base64url are 43 characters. */
const TOKEN_PATTERN = /^bgk_[A-Za-z0-9_-]{43}$/;
const TOKEN_IN_TEXT = /bgk_[A-Za-z0-9_-]{43}/g;

/**
 * The token is the whole identity and is shown once. It is base64url so it can
 * travel in a cookie without escaping, and prefixed so a leaked one is
 * recognisable in a bug report or a secret scanner.
 */
export function mintToken(bytes: (size: number) => Buffer = randomBytes): string {
  return `${TOKEN_PREFIX}${bytes(TOKEN_BYTES).toString('base64url')}`;
}

export function isTokenShaped(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

/** SHA-256 of the whole token, prefix included, as lowercase hex. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Both sides must be 64-character hex. The length check keeps
 * `timingSafeEqual` from throwing on a malformed stored value; a real hash
 * always has the same length, so it does not open a timing path.
 */
export function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A miss still runs one comparison against a fixed digest, so "no such token"
 * and "wrong token" cost the same amount of work.
 */
export const DUMMY_DIGEST = hashToken(`${TOKEN_PREFIX}${'x'.repeat(43)}`);

/** Belt and braces for the "never in a log" rule: scrub token-shaped strings. */
export function redactTokens(line: string): string {
  return line.replace(TOKEN_IN_TEXT, `${TOKEN_PREFIX}[redacted]`);
}
