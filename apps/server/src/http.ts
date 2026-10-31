import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { authenticate } from './session.ts';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './cookies.ts';
import type { Logger } from './logger.ts';
import type { PlayerStore } from './players.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';

const MAX_BODY_BYTES = 4 * 1024;
const SESSION_ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface AppDeps {
  store: PlayerStore;
  logger: Logger;
  now?: () => number;
  secureCookies?: boolean;
  trustProxy?: boolean;
  limiter?: RateLimiter;
  sessionAttemptsPerMinute?: number;
}

class BodyTooLargeError extends Error {}

export function createApp(deps: AppDeps): Server {
  const now = deps.now ?? Date.now;
  const secureCookies = deps.secureCookies ?? true;
  const trustProxy = deps.trustProxy ?? false;
  const limiter =
    deps.limiter ??
    createRateLimiter(deps.sessionAttemptsPerMinute ?? SESSION_ATTEMPTS_PER_MINUTE, RATE_LIMIT_WINDOW_MS);

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      // Never the URL: a token put in a query string must not reach the log.
      deps.logger.warn('http.error', {
        method: request.method,
        error: error instanceof Error ? error.message : 'unknown',
      });

      if (!response.headersSent) {
        response.writeHead(500, { 'Cache-Control': 'no-store' });
      }
      response.end();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (path !== '/session') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }

    switch (request.method) {
      case 'POST':
        await openSession(request, response);
        return;
      case 'GET':
        await readSession(request, response);
        return;
      case 'DELETE':
        await closeSession(request, response);
        return;
      default:
        response.writeHead(405, { Allow: 'GET, POST, DELETE', 'Cache-Control': 'no-store' });
        response.end();
    }
  }

  async function openSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const ip = clientAddress(request, trustProxy);
    const decision = limiter.take(ip, now());

    if (!decision.allowed) {
      deps.logger.warn('session.rate_limited', { ip });
      response.writeHead(429, {
        'Cache-Control': 'no-store',
        'Retry-After': String(decision.retryAfterSeconds),
      });
      response.end();
      return;
    }

    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { error: 'body_too_large' });
        return;
      }
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }

    const token = tokenFrom(body);
    const player = await authenticate(deps.store, token);

    if (player === null || token === undefined) {
      // Unknown, revoked and malformed answer the same way: a 401 and nothing.
      deps.logger.warn('session.refused', { ip });
      unauthorized(response, secureCookies, false);
      return;
    }

    deps.logger.info('session.opened', { ip, worldId: player.worldId, houseId: player.houseId });
    sendJson(
      response,
      200,
      { worldId: player.worldId, houseId: player.houseId },
      { 'Set-Cookie': sessionCookie(token, secureCookies) },
    );
  }

  async function readSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await authenticate(deps.store, readSessionCookie(request.headers.cookie));

    if (player === null) {
      unauthorized(response, secureCookies, true);
      return;
    }

    sendJson(response, 200, { worldId: player.worldId, houseId: player.houseId });
  }

  async function closeSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await authenticate(deps.store, readSessionCookie(request.headers.cookie));

    if (player === null) {
      unauthorized(response, secureCookies, true);
      return;
    }

    await deps.store.revoke(player.tokenHash, new Date(now()));
    deps.logger.info('session.revoked', { worldId: player.worldId, houseId: player.houseId });

    response.writeHead(204, {
      'Cache-Control': 'no-store',
      'Set-Cookie': clearedSessionCookie(secureCookies),
    });
    response.end();
  }
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
    // The ingress appends the address it saw; the leftmost entries are whatever
    // the client chose to send. Trust the rightmost one, not the client's claim.
    const last = raw?.split(',').at(-1)?.trim();
    if (last) {
      return last;
    }
  }

  return request.socket.remoteAddress ?? 'unknown';
}

async function readJson(request: IncomingMessage): Promise<unknown> {
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

function tokenFrom(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as { token?: unknown }).token;

  return typeof value === 'string' ? value : undefined;
}

function unauthorized(response: ServerResponse, secure: boolean, clearCookie: boolean): void {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (clearCookie) {
    headers['Set-Cookie'] = clearedSessionCookie(secure);
  }

  response.writeHead(401, headers);
  response.end();
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}
