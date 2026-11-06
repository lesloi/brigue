import type { IncomingMessage, ServerResponse } from 'node:http';

import { clearedSessionCookie } from './cookies.ts';

export const MAX_BODY_BYTES = 4 * 1024;

export class BodyTooLargeError extends Error {}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }

  if (size === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export type BodyRead = { ok: true; body: unknown } | { ok: false };

/** Reads a request body and answers the refusal itself, so a route only sees a body it can use. */
export async function readBody(request: IncomingMessage, response: ServerResponse): Promise<BodyRead> {
  try {
    return { ok: true, body: await readJson(request) };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendJson(response, 413, { error: 'body_too_large' });
      return { ok: false };
    }
    sendJson(response, 400, { error: 'invalid_json' });
    return { ok: false };
  }
}

export function unauthorized(response: ServerResponse, secure: boolean, clearCookie: boolean): void {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (clearCookie) {
    headers['Set-Cookie'] = clearedSessionCookie(secure);
  }

  response.writeHead(401, headers);
  response.end();
}

export function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.writeHead(405, { Allow: allow, 'Cache-Control': 'no-store' });
  response.end();
}
