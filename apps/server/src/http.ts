import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createWorld, FORMAT_VERSION, hashJson, PACING, RULES, WorldVersionError } from '@brigue/core';

import { parseActionSubmission, withHouse } from './actions.ts';
import { catchUp, WEEK_MS, type CatchUpResult } from './catch-up.ts';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './cookies.ts';
import type { Logger } from './logger.ts';
import { HouseAlreadyBoundError, type Player, type PlayerStore } from './players.ts';
import { projectWorld } from './projection.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';
import { BodyTooLargeError, methodNotAllowed, readJson, sendJson, unauthorized } from './respond.ts';
import { authenticate, issueToken } from './session.ts';
import {
  DuplicateActionError,
  FIRST_HOUSE_ID,
  UnknownWorldError,
  WORLD_ID,
  type StoredAction,
  type WorldStore,
} from './worlds.ts';

const SESSION_ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
/**
 * The action may target the week being played, or the next one when an hour
 * boundary fell between the client's read and its POST. Further ahead is a
 * client clock that cannot be reconciled with this town.
 */
const QUEUE_AHEAD_WEEKS = 1;

export interface AppDeps {
  store: PlayerStore;
  worlds: WorldStore;
  logger: Logger;
  now?: () => number;
  secureCookies?: boolean;
  trustProxy?: boolean;
  limiter?: RateLimiter;
  sessionAttemptsPerMinute?: number;
}

export function createApp(deps: AppDeps): Server {
  const now = deps.now ?? Date.now;
  const secureCookies = deps.secureCookies ?? true;
  const trustProxy = deps.trustProxy ?? false;
  const limiter =
    deps.limiter ??
    createRateLimiter(deps.sessionAttemptsPerMinute ?? SESSION_ATTEMPTS_PER_MINUTE, RATE_LIMIT_WINDOW_MS);

  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
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

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    switch (path) {
      case '/api/session':
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
            methodNotAllowed(response, 'GET, POST, DELETE');
            return;
        }

      case '/api/world':
        if (request.method !== 'GET') {
          methodNotAllowed(response, 'GET');
          return;
        }
        await readWorld(request, response);
        return;

      case '/api/actions':
        if (request.method !== 'POST') {
          methodNotAllowed(response, 'POST');
          return;
        }
        await appendAction(request, response);
        return;

      default:
        sendJson(response, 404, { error: 'not_found' });
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

    const read = await readBody(request, response);
    if (!read.ok) {
      return;
    }
    const body = read.body;

    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      sendJson(response, 400, { error: 'invalid_json' });
      return;
    }

    const candidate = (body as { token?: unknown } | null | undefined)?.token;
    if (candidate !== undefined) {
      if (typeof candidate !== 'string') {
        sendJson(response, 400, { error: 'invalid_token' });
        return;
      }

      await resumeSession(response, ip, candidate);
      return;
    }

    await joinTown(response, ip);
  }

  async function resumeSession(response: ServerResponse, ip: string, token: string): Promise<void> {
    const player = await authenticate(deps.store, token);

    if (player === null) {
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

  async function joinTown(response: ServerResponse, ip: string): Promise<void> {
    const at = new Date(now());

    try {
      // One town, created by the first player; the next ones find it and only
      // take the house binding.
      await deps.worlds.createIfAbsent(WORLD_ID, createWorld(randomSeed()), at, at);
      await assertWorldVersion();

      const issued = await issueToken(deps.store, WORLD_ID, FIRST_HOUSE_ID, at);
      deps.logger.info('session.joined', { ip, worldId: WORLD_ID, houseId: FIRST_HOUSE_ID });
      sendJson(
        response,
        201,
        { worldId: WORLD_ID, houseId: FIRST_HOUSE_ID, token: issued.token },
        { 'Set-Cookie': sessionCookie(issued.token, secureCookies) },
      );
    } catch (error) {
      if (error instanceof HouseAlreadyBoundError) {
        deps.logger.warn('session.no_free_house', { ip });
        sendJson(response, 409, { error: 'no_free_house' });
        return;
      }
      throw error;
    }
  }

  async function readSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    sendJson(response, 200, { worldId: player.worldId, houseId: player.houseId });
  }

  async function closeSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
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

  async function readWorld(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    const at = new Date(now());
    const caught = await catchUpTown(player.worldId, at);

    if (caught.summary.skippedWeeks > 0) {
      deps.logger.warn('world.catch_up_capped', {
        worldId: player.worldId,
        skippedWeeks: caught.summary.skippedWeeks,
      });
    }
    deps.logger.info('world.read', {
      worldId: player.worldId,
      houseId: player.houseId,
      week: caught.world.week,
      weeksPlayed: caught.summary.weeksPlayed,
      skippedWeeks: caught.summary.skippedWeeks,
    });

    const projection = projectWorld(caught.world, player.houseId, caught.weekStartedAt);

    sendJson(response, 200, {
      world: projection,
      events: caught.events,
      summary: caught.summary,
      // The projected state, not the world: hashing the world would reveal the
      // seed and with it every future the town has not lived yet.
      stateHash: hashJson(projection),
    });
  }

  async function appendAction(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    const read = await readBody(request, response);
    if (!read.ok) {
      return;
    }

    const submission = parseActionSubmission(read.body);
    if (!submission.ok) {
      sendJson(response, 400, { error: submission.error });
      return;
    }

    const at = new Date(now());
    let outcome: ActionOutcome;
    try {
      outcome = await deps.worlds.withWorld(player.worldId, async (session) => {
        const { world, weekStartedAt } = session.snapshot;
        if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
          throw new WorldVersionError(world);
        }

        // The action names a week, not a house: the house is the session's.
        // A week that already ticked can never be replayed, and the town clock
        // is the upper bound for a week that has not begun yet.
        const elapsed = Math.max(0, Math.floor((at.getTime() - weekStartedAt.getTime()) / WEEK_MS));
        // Where a catch-up read would land: the cap bounds how many weeks it
        // will actually play, and skipping does not advance the town's week.
        const currentWeek = world.week + Math.min(elapsed, PACING.maxCatchUpWeeks);

        if (submission.week < world.week) {
          return { kind: 'stale' as const, currentWeek };
        }
        if (submission.week > currentWeek + QUEUE_AHEAD_WEEKS) {
          return { kind: 'future' as const, currentWeek };
        }
        if ((await session.findAction(submission.id)) !== null) {
          return { kind: 'duplicate' as const };
        }

        const stored: StoredAction = {
          id: submission.id,
          houseId: player.houseId,
          week: submission.week,
          action: withHouse(submission.intent, player.houseId),
          receivedAt: at,
        };
        await session.append(stored);

        return { kind: 'appended' as const, stored };
      });
    } catch (error) {
      // The primary key caught an id another week already used; the pre-check
      // above covers the common path, this covers a race from another world.
      if (error instanceof DuplicateActionError) {
        sendJson(response, 409, { error: 'duplicate_action' });
        return;
      }
      throw error;
    }

    switch (outcome.kind) {
      case 'stale':
        sendJson(response, 409, { error: 'stale_week', currentWeek: outcome.currentWeek });
        return;
      case 'future':
        sendJson(response, 409, { error: 'future_week', currentWeek: outcome.currentWeek });
        return;
      case 'duplicate':
        sendJson(response, 409, { error: 'duplicate_action' });
        return;
      case 'appended':
        deps.logger.info('action.appended', {
          worldId: player.worldId,
          houseId: player.houseId,
          week: outcome.stored.week,
          action: outcome.stored.action.type,
        });
        sendJson(response, 201, {
          id: outcome.stored.id,
          week: outcome.stored.week,
          houseId: outcome.stored.houseId,
        });
    }
  }

  function catchUpTown(worldId: string, at: Date): Promise<CatchUpResult> {
    return deps.worlds.withWorld(worldId, async (session) => {
      const caught = await catchUp({
        world: session.snapshot.world,
        weekStartedAt: session.snapshot.weekStartedAt,
        lastEvents: session.snapshot.lastEvents,
        now: at,
        actionsFor: (week) => session.actionsFor(week),
      });

      if (caught.summary.weeksPlayed > 0 || caught.summary.skippedWeeks > 0) {
        await session.save(caught.world, caught.weekStartedAt, caught.events, at);
      }

      return caught;
    });
  }

  async function assertWorldVersion(): Promise<void> {
    await deps.worlds.withWorld(WORLD_ID, async (session) => {
      const world = session.snapshot.world;

      if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
        throw new WorldVersionError(world);
      }
    });
  }

  async function identifiedBy(request: IncomingMessage, response: ServerResponse): Promise<Player | null> {
    const player = await authenticate(deps.store, readSessionCookie(request.headers.cookie));

    if (player === null) {
      unauthorized(response, secureCookies, true);
    }

    return player;
  }

  async function readBody(request: IncomingMessage, response: ServerResponse): Promise<BodyRead> {
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
}

type BodyRead = { ok: true; body: unknown } | { ok: false };

type ActionOutcome =
  | { kind: 'stale'; currentWeek: number }
  | { kind: 'future'; currentWeek: number }
  | { kind: 'duplicate' }
  | { kind: 'appended'; stored: StoredAction };

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

function randomSeed(): number {
  return randomInt(1, 2_147_483_646);
}

function versionRefusal(error: WorldVersionError): Record<string, unknown> {
  return {
    error: 'world_version',
    formatVersion: error.formatVersion,
    rulesetVersion: error.rulesetVersion,
    expected: { formatVersion: FORMAT_VERSION, rulesetVersion: RULES.version },
  };
}
