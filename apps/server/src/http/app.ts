import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { FORMAT_VERSION, RULES, WorldVersionError } from '@brigue/core';

import { UnknownWorldError } from '../town/worlds.ts';
import { type AppContext, type AppDeps } from './context.ts';
import { createRateLimiter } from './rate-limit.ts';
import { methodNotAllowed, sendJson } from './respond.ts';
import { appendAction, cancelAction, listActions } from './routes/actions.ts';
import { renameFamilyRoute } from './routes/dynasty.ts';
import { readCandidate } from './routes/name-suggestion.ts';
import { cancelDeletion, requestDeletion } from './routes/player.ts';
import { openSession, readSession } from './routes/session.ts';
import { advanceHour, deleteMessage, markMessageRead, readWorld } from './routes/world.ts';
import { assertWebRoot, serveStatic } from './static.ts';

const SESSION_ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export type { AppDeps } from './context.ts';

export function createApp(deps: AppDeps): Server {
  const context: AppContext = {
    deps,
    now: deps.now ?? Date.now,
    secureCookies: deps.secureCookies ?? true,
    trustProxy: deps.trustProxy ?? false,
    limiter:
      deps.limiter ??
      createRateLimiter(deps.sessionAttemptsPerMinute ?? SESSION_ATTEMPTS_PER_MINUTE, RATE_LIMIT_WINDOW_MS),
  };

  if (deps.webRoot !== undefined) {
    assertWebRoot(deps.webRoot);
  }

  return createServer((request, response) => {
    // Every answer, static or JSON, carries these two: the referrer policy is
    // pinned instead of left to the browser's default or to whatever a future
    // proxy adds, and the server types every response, so nothing may be sniffed.
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    handle(context, request, response).catch((error: unknown) => {
      // A wrong version is a refusal the client can act on, and it must never
      // reach a replay: catch-up checks it before the first tick.
      if (error instanceof WorldVersionError) {
        deps.logger.warn('world.version_refused', {
          formatVersion: error.formatVersion,
          rulesetVersion: error.rulesetVersion,
        });
        sendJson(response, 409, versionRefusal(error));
        return;
      }

      if (error instanceof UnknownWorldError) {
        // A token whose world vanished: broken state, and nothing to catch up.
        deps.logger.warn('world.unknown', { method: request.method });
        sendJson(response, 404, { error: 'unknown_world' });
        return;
      }

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
}

async function handle(context: AppContext, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  const readMessageMatch = /^\/api\/messages\/(\d+)\/read$/.exec(path);
  if (readMessageMatch !== null) {
    if (request.method !== 'POST') {
      methodNotAllowed(response, 'POST');
      return;
    }
    await markMessageRead(context, request, response, readMessageMatch[1] as string);
    return;
  }

  const messageMatch = /^\/api\/messages\/(\d+)$/.exec(path);
  if (messageMatch !== null) {
    if (request.method !== 'DELETE') {
      methodNotAllowed(response, 'DELETE');
      return;
    }
    await deleteMessage(context, request, response, messageMatch[1] as string);
    return;
  }

  const cancelMatch = /^\/api\/actions\/([^/]+)$/.exec(path);
  if (cancelMatch !== null) {
    if (request.method !== 'DELETE') {
      methodNotAllowed(response, 'DELETE');
      return;
    }
    await cancelAction(context, request, response, cancelMatch[1] as string);
    return;
  }

  switch (path) {
    case '/healthz':
      if (!isReadable(request)) {
        methodNotAllowed(response, 'GET, HEAD');
        return;
      }
      sendJson(response, 200, { status: 'ok' });
      return;

    case '/readyz':
      if (!isReadable(request)) {
        methodNotAllowed(response, 'GET, HEAD');
        return;
      }
      await readiness(context, response);
      return;

    case '/api/session':
      switch (request.method) {
        case 'POST':
          await openSession(context, request, response);
          return;
        case 'GET':
          await readSession(context, request, response);
          return;
        default:
          methodNotAllowed(response, 'GET, POST');
          return;
      }

    case '/api/player/deletion':
      switch (request.method) {
        case 'POST':
          await requestDeletion(context, request, response);
          return;
        case 'DELETE':
          await cancelDeletion(context, request, response);
          return;
        default:
          methodNotAllowed(response, 'POST, DELETE');
          return;
      }

    case '/api/dynasty/name':
      switch (request.method) {
        case 'GET':
          // The creation screen asks for the identity it prefills, and the
          // Maison screen for a free name: one read, one answer, and nothing
          // written.
          await readCandidate(context, request, response);
          return;
        case 'PUT':
          await renameFamilyRoute(context, request, response);
          return;
        default:
          methodNotAllowed(response, 'GET, PUT');
          return;
      }

    case '/api/world':
      if (request.method !== 'GET') {
        methodNotAllowed(response, 'GET');
        return;
      }
      await readWorld(context, request, response);
      return;

    case '/api/actions':
      switch (request.method) {
        case 'GET':
          await listActions(context, request, response);
          return;
        case 'POST':
          await appendAction(context, request, response);
          return;
        default:
          methodNotAllowed(response, 'GET, POST');
          return;
      }

    case '/api/dev/advance':
      // The route only exists when the server was started for development:
      // in production it is indistinguishable from any unknown path.
      if (context.deps.devAdvance !== true) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      if (request.method !== 'POST') {
        methodNotAllowed(response, 'POST');
        return;
      }
      await advanceHour(context, request, response);
      return;

    default:
      // Everything that is not the API and not a probe is the client, when
      // one was mounted. In development Vite serves it, so this stays a 404.
      if (context.deps.webRoot !== undefined && !path.startsWith('/api')) {
        if (!isReadable(request)) {
          methodNotAllowed(response, 'GET, HEAD');
          return;
        }
        serveStatic(context.deps.webRoot, path, request, response);
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
  }
}

async function readiness(context: AppContext, response: ServerResponse): Promise<void> {
  try {
    await context.deps.ready();
    sendJson(response, 200, { status: 'ok' });
  } catch {
    // Never the error itself: a refused connection is all a probe needs, and
    // and the message may quote the credentials inside DATABASE_URL.
    sendJson(response, 503, { status: 'unavailable' });
  }
}

function isReadable(request: IncomingMessage): boolean {
  return request.method === 'GET' || request.method === 'HEAD';
}

function versionRefusal(error: WorldVersionError): Record<string, unknown> {
  return {
    error: 'world_version',
    formatVersion: error.formatVersion,
    rulesetVersion: error.rulesetVersion,
    expected: { formatVersion: FORMAT_VERSION, rulesetVersion: RULES.version },
  };
}
