import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  createWorld,
  humanHouseOf,
  FORMAT_VERSION,
  hashJson,
  PACING,
  RULES,
  TRADES,
  withFirstHouse,
  withNewcomer,
  WorldVersionError,
  type Trade,
  type World,
} from '@brigue/core';

import { ACTION_ID_PATTERN, parseActionSubmission, withHouse } from './actions.ts';
import { clearedSessionCookie, readSessionCookie, sessionCookie } from './cookies.ts';
import type { Logger } from './logger.ts';
import { drawHouseIdentity, drawTownIdentity } from './names.ts';
import { HouseAlreadyBoundError, type Player, type PlayerStore } from './players.ts';
import { applyPresence, removeHouse, type Presence } from './presence.ts';
import { projectWorld } from './projection.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';
import { BodyTooLargeError, methodNotAllowed, readJson, sendJson, unauthorized } from './respond.ts';
import { playDue, type Due } from './scheduler.ts';
import { authenticate, issueToken } from './session.ts';
import { assertWebRoot, serveStatic } from './static.ts';
import {
  DuplicateActionError,
  HOUR_MS,
  UnknownWorldError,
  type JournalPage,
  type StoredAction,
  type TownInfo,
  type WorldSession,
  type WorldStore,
} from './worlds.ts';

const SESSION_ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
/**
 * The action may target the hour being played, or the next one when an hour
 * boundary fell between the client's read and its POST. Further ahead is a
 * client clock that cannot be reconciled with this town.
 */
const QUEUE_AHEAD_HOURS = 1;
/** A read returns at most this many journal entries; the rest is counted. */
const JOURNAL_PAGE = 50;

export interface AppDeps {
  store: PlayerStore;
  worlds: WorldStore;
  logger: Logger;
  /**
   * Readiness: what a readiness probe asks before it sends traffic here. Wired
   * to a database ping in production. Liveness is not this and must never
   * touch it.
   */
  ready: () => Promise<void>;
  /** Directory of the built client. Unset in development, where Vite serves it. */
  webRoot?: string;
  /** Local development only: exposes `POST /api/dev/advance`. Never set in production. */
  devAdvance?: boolean;
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

  if (deps.webRoot !== undefined) {
    assertWebRoot(deps.webRoot);
  }
  const limiter =
    deps.limiter ??
    createRateLimiter(deps.sessionAttemptsPerMinute ?? SESSION_ATTEMPTS_PER_MINUTE, RATE_LIMIT_WINDOW_MS);

  return createServer((request, response) => {
    // Every answer, static or JSON, carries these two: the referrer policy is
    // pinned instead of left to the browser's default or to whatever a future
    // proxy adds, and the server types every response, so nothing may be sniffed.
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');

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

    const cancelMatch = /^\/api\/actions\/([^/]+)$/.exec(path);
    if (cancelMatch !== null) {
      if (request.method !== 'DELETE') {
        methodNotAllowed(response, 'DELETE');
        return;
      }
      await cancelAction(request, response, cancelMatch[1] as string);
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
        await readiness(response);
        return;

      case '/api/session':
        switch (request.method) {
          case 'POST':
            await openSession(request, response);
            return;
          case 'GET':
            await readSession(request, response);
            return;
          default:
            methodNotAllowed(response, 'GET, POST');
            return;
        }

      case '/api/player':
        if (request.method !== 'DELETE') {
          methodNotAllowed(response, 'DELETE');
          return;
        }
        await deletePlayer(request, response);
        return;

      case '/api/world':
        if (request.method !== 'GET') {
          methodNotAllowed(response, 'GET');
          return;
        }
        await readWorld(request, response);
        return;

      case '/api/actions':
        switch (request.method) {
          case 'GET':
            await listActions(request, response);
            return;
          case 'POST':
            await appendAction(request, response);
            return;
          default:
            methodNotAllowed(response, 'GET, POST');
            return;
        }

      case '/api/dev/advance':
        // The route only exists when the server was started for development:
        // in production it is indistinguishable from any unknown path.
        if (deps.devAdvance !== true) {
          sendJson(response, 404, { error: 'not_found' });
          return;
        }
        if (request.method !== 'POST') {
          methodNotAllowed(response, 'POST');
          return;
        }
        await advanceHour(request, response);
        return;

      default:
        // Everything that is not the API and not a probe is the client, when
        // one was mounted. In development Vite serves it, so this stays a 404.
        if (deps.webRoot !== undefined && !path.startsWith('/api')) {
          if (!isReadable(request)) {
            methodNotAllowed(response, 'GET, HEAD');
            return;
          }
          serveStatic(deps.webRoot, path, request, response);
          return;
        }
        sendJson(response, 404, { error: 'not_found' });
    }
  }

  async function readiness(response: ServerResponse): Promise<void> {
    try {
      await deps.ready();
      sendJson(response, 200, { status: 'ok' });
    } catch {
      // Never the error itself: a refused connection is all a probe needs, and
      // and the message may quote the credentials inside DATABASE_URL.
      sendJson(response, 503, { status: 'unavailable' });
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

    // A join carries the trade the player chose. No default: the choice is the
    // screen's, and a missing trade must not silently weave.
    const trade = (body as { trade?: unknown } | null | undefined)?.trade;
    if (typeof trade !== 'string' || !TRADES.includes(trade as Trade)) {
      sendJson(response, 400, { error: 'invalid_trade' });
      return;
    }

    await joinTown(response, ip, trade as Trade);
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

  async function joinTown(response: ServerResponse, ip: string, trade: Trade): Promise<void> {
    const at = new Date(now());

    try {
      // The join is one critical section: two newcomers must not both take the
      // same freed place, nor read an empty database and found two towns.
      const joined = await deps.worlds.withJoinLock(async () => {
        const towns = await deps.worlds.listTowns();
        const names = await deps.worlds.usedTownNames();

        for (const town of towns) {
          let houseId: string | null;

          try {
            houseId = await takePlace(town.id, trade);
          } catch (error) {
            // The town went between the list and its lock, or the scheduler
            // deleted it: the next join will not see it either.
            if (error instanceof UnknownWorldError) {
              continue;
            }
            // A town of another version is refused, and stops the join: the
            // format belongs to the database, not to one town.
            throw error;
          }

          if (houseId !== null) {
            return bind(town, houseId, at);
          }
        }

        return foundTown(names, trade, at);
      });

      deps.logger.info('session.joined', { ip, worldId: joined.town.id, houseId: joined.houseId });
      sendJson(
        response,
        201,
        { worldId: joined.town.id, houseId: joined.houseId, token: joined.token },
        { 'Set-Cookie': sessionCookie(joined.token, secureCookies) },
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

  /**
   * The place a newcomer takes in a town: a human house no player has ever
   * taken (the one the town was just created with, or a place whose token was
   * never issued), else a new human house until the town is full. A house a
   * player has taken stays theirs while it is silent — a revoked token does not
   * give it away — until the silence rule deletes it. A full town offers
   * nothing; the join moves on. A town whose last human house has gone is on
   * its way out, and is left alone.
   */
  async function takePlace(townId: string, trade: Trade): Promise<string | null> {
    return deps.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);

      if (humanHouseOf(world) === undefined) {
        return null;
      }

      const players = await deps.store.listByWorld(townId);
      const taken = new Set(players.map((player) => player.houseId));
      const free = Object.values(world.houses).find((house) => house.controller === 'human' && !taken.has(house.id));

      if (free !== undefined) {
        return free.id;
      }
      if (Object.keys(world.houses).length >= RULES.houseCap) {
        return null;
      }

      const identity = drawHouseIdentity(world);
      await session.save(withNewcomer(world, trade, identity), session.snapshot.hourStartedAt, []);

      return identity.id;
    }, townId);
  }

  /** No town has a free place: the newcomer founds one, named from the places left. */
  async function foundTown(
    names: readonly string[],
    trade: Trade,
    at: Date,
  ): Promise<{ town: TownInfo; houseId: string; token: string }> {
    const town = drawTownIdentity(names);
    const world = createWorld(randomSeed());
    const identity = drawHouseIdentity(world);

    await deps.worlds.createTown(town, withFirstHouse(world, trade, identity), at);

    return bind(town, identity.id, at);
  }

  async function bind(
    town: TownInfo,
    houseId: string,
    at: Date,
  ): Promise<{ town: TownInfo; houseId: string; token: string }> {
    const issued = await issueToken(deps.store, town.id, houseId, at);

    return { town, houseId, token: issued.token };
  }

  async function readSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    sendJson(response, 200, { worldId: player.worldId, houseId: player.houseId });
  }

  /**
   * The player deletes their identity: the house, its queued actions and the
   * token go at once, and the town goes if it was the last human. The silence
   * rule waits thirty days; this is the deliberate exit.
   */
  async function deletePlayer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    const at = new Date(now());

    try {
      await deps.worlds.withWorld(async (session) => {
        const next = structuredClone(sessionWorld(session));
        removeHouse(next, player.houseId);
        await session.cancelHouse(player.houseId, at);

        if (humanHouseOf(next) === undefined) {
          await session.clear();
          return;
        }

        await session.save(next, session.snapshot.hourStartedAt, []);
      }, player.worldId);
    } catch (error) {
      // A town already gone leaves only the row to clean.
      if (!(error instanceof UnknownWorldError)) {
        throw error;
      }
    }

    // The identity dies even when the town could not be written: a failed
    // delete must not leave a working token behind a house that is gone.
    await deps.store.revoke(player.tokenHash, at);
    await deps.store.remove(player.tokenHash);
    deps.logger.info('player.deleted', { worldId: player.worldId, houseId: player.houseId });

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
    const outcome = await catchUpTown(player.worldId, player.houseId, player.cursorEventId ?? 0, at);

    if (outcome.kind === 'gone') {
      // The visit arrived after the house was silent for a month: the world has
      // already deleted it and revoked the token. Clear the dead cookie so the
      // client can take the freed place.
      deps.logger.warn('world.session_expired', { worldId: player.worldId, houseId: player.houseId });
      unauthorized(response, secureCookies, true);
      return;
    }

    const caught = outcome.result;
    await deps.store.touch(player.tokenHash, at);

    if (caught.skipped > 0) {
      deps.logger.warn('world.catch_up_capped', {
        worldId: player.worldId,
        skipped: caught.skipped,
      });
    }
    deps.logger.info('world.read', {
      worldId: player.worldId,
      houseId: player.houseId,
      hour: caught.world.hour,
      hoursPlayed: caught.hours,
      skipped: caught.skipped,
    });

    const projection = projectWorld(outcome.town, caught.world, player.houseId, caught.hourStartedAt);
    await deps.store.advanceCursor(player.tokenHash, outcome.journal.lastId);

    sendJson(response, 200, {
      world: projection,
      events: outcome.journal.events,
      summary: {
        hours: caught.hours,
        skipped: caught.skipped,
        counts: outcome.journal.counts,
        refusals: outcome.journal.refusals,
      },
      // The projected state, not the world: hashing the world would reveal the
      // seed and with it every future the town has not lived yet.
      stateHash: hashJson(projection),
      // Outside the projection on purpose: the hash must not depend on how a
      // deployment was started.
      ...(deps.devAdvance === true ? { dev: true } : {}),
    });
  }

  /**
   * Local development only: plays the next hour now instead of waiting for the
   * hour to pass. The world clock jumps, the wall clock does not.
   */
  async function advanceHour(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    const at = new Date(now());
    const outcome = await advanceTown(player.worldId, player.houseId, player.cursorEventId ?? 0, at);

    if (outcome.kind === 'gone') {
      deps.logger.warn('world.session_expired', { worldId: player.worldId, houseId: player.houseId });
      unauthorized(response, secureCookies, true);
      return;
    }

    const caught = outcome.result;
    await deps.store.touch(player.tokenHash, at);

    deps.logger.info('world.advanced', {
      worldId: player.worldId,
      houseId: player.houseId,
      hour: caught.world.hour,
    });

    const projection = projectWorld(outcome.town, caught.world, player.houseId, caught.hourStartedAt);
    await deps.store.advanceCursor(player.tokenHash, outcome.journal.lastId);

    sendJson(response, 200, {
      world: projection,
      events: outcome.journal.events,
      summary: {
        hours: caught.hours,
        skipped: caught.skipped,
        counts: outcome.journal.counts,
        refusals: outcome.journal.refusals,
      },
      stateHash: hashJson(projection),
      dev: true,
    });
  }

  /** Where a catch-up read would land; the cap bounds what it actually plays. */
  function currentHourOf(world: World, hourStartedAt: Date, at: Date): number {
    const elapsed = Math.max(0, Math.floor((at.getTime() - hourStartedAt.getTime()) / HOUR_MS));

    return world.hour + Math.min(elapsed, PACING.maxCatchUpHours);
  }

  function pendingView(stored: StoredAction): Record<string, unknown> {
    const action = stored.action;

    return {
      id: stored.id,
      hour: stored.playsAt,
      type: action.type,
      ...(action.type === 'market.buy' || action.type === 'market.sell'
        ? { good: action.good, units: action.units }
        : {}),
      ...(action.type === 'council.campaign' ? { seatId: action.seatId } : {}),
    };
  }

  async function listActions(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }

    const actions = await deps.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);
      const queued: StoredAction[] = [];

      queued.push(...(await session.actionsBetween(world.hour, world.hour + QUEUE_AHEAD_HOURS)));

      return queued.filter((action) => action.houseId === player.houseId);
    }, player.worldId);

    sendJson(response, 200, { actions: actions.map(pendingView) });
  }

  async function cancelAction(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
    const player = await identifiedBy(request, response);

    if (player === null) {
      return;
    }
    if (!ACTION_ID_PATTERN.test(id)) {
      sendJson(response, 404, { error: 'unknown_action' });
      return;
    }

    const at = new Date(now());
    const actionId = id.toLowerCase();
    const outcome = await deps.worlds.withWorld(async (session) => {
      const { world, hourStartedAt } = session.snapshot;
      sessionWorld(session);

      const stored = await session.findAction(actionId);
      // Another house's action is indistinguishable from an unknown one.
      if (stored === null || stored.houseId !== player.houseId) {
        return { kind: 'unknown' as const };
      }
      // Idempotent: a cancellation already won is 204, even if the hour has
      // ticked since; the row stays for dedup and replay.
      if (stored.cancelledAt !== null) {
        return { kind: 'cancelled' as const };
      }
      if (stored.playsAt < world.hour) {
        return { kind: 'stale' as const, currentHour: currentHourOf(world, hourStartedAt, at) };
      }

      const currentHour = currentHourOf(world, hourStartedAt, at);
      if (stored.playsAt > currentHour + QUEUE_AHEAD_HOURS) {
        return { kind: 'future' as const, currentHour };
      }

      await session.cancel(actionId, at);

      return { kind: 'cancelled' as const };
    }, player.worldId);

    switch (outcome.kind) {
      case 'unknown':
        sendJson(response, 404, { error: 'unknown_action' });
        return;
      case 'stale':
        sendJson(response, 409, { error: 'stale_hour', currentHour: outcome.currentHour });
        return;
      case 'future':
        sendJson(response, 409, { error: 'future_hour', currentHour: outcome.currentHour });
        return;
      case 'cancelled':
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
    }
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
      outcome = await deps.worlds.withWorld(async (session) => {
        sessionWorld(session);
        const { world, hourStartedAt } = session.snapshot;

        // The action names a hour, not a house: the house is the session's.
        // A hour that already ticked can never be replayed, and the town clock
        // is the upper bound for a hour that has not begun yet.
        const currentHour = currentHourOf(world, hourStartedAt, at);

        if (submission.hour < world.hour) {
          return { kind: 'stale' as const, currentHour };
        }
        if (submission.hour > currentHour + QUEUE_AHEAD_HOURS) {
          return { kind: 'future' as const, currentHour };
        }
        if ((await session.findAction(submission.id)) !== null) {
          return { kind: 'duplicate' as const };
        }

        const stored: StoredAction = {
          id: submission.id,
          houseId: player.houseId,
          playsAt: submission.hour,
          action: withHouse(submission.intent, player.houseId),
          receivedAt: at,
          cancelledAt: null,
        };
        await session.append(stored);

        return { kind: 'appended' as const, stored };
      }, player.worldId);
    } catch (error) {
      // The primary key caught an id another hour already used; the pre-check
      // above covers the common path, this covers a race from another world.
      if (error instanceof DuplicateActionError) {
        sendJson(response, 409, { error: 'duplicate_action' });
        return;
      }
      throw error;
    }

    switch (outcome.kind) {
      case 'stale':
        sendJson(response, 409, { error: 'stale_hour', currentHour: outcome.currentHour });
        return;
      case 'future':
        sendJson(response, 409, { error: 'future_hour', currentHour: outcome.currentHour });
        return;
      case 'duplicate':
        sendJson(response, 409, { error: 'duplicate_action' });
        return;
      case 'appended':
        deps.logger.info('action.appended', {
          worldId: player.worldId,
          houseId: player.houseId,
          hour: outcome.stored.playsAt,
          action: outcome.stored.action.type,
        });
        sendJson(response, 201, {
          id: outcome.stored.id,
          hour: outcome.stored.playsAt,
          houseId: outcome.stored.houseId,
        });
    }
  }

  function catchUpTown(townId: string, houseId: string, cursor: number, at: Date): Promise<TownOutcome> {
    return deps.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);
      const presence = await synchronisePresence(townId, world, at);

      // The last human house went with the silence: the town goes too, and the
      // next join starts a new one. The players and the sealed seasons stay.
      if (humanHouseOf(presence.world) === undefined) {
        await session.clear();
        return { kind: 'gone' as const };
      }

      if (presence.deletedHouseIds.includes(houseId)) {
        // Another human house is gone, but the town remains: the deletion is a
        // real change and must be kept even though nothing is caught up for
        // this reader.
        await session.save(presence.world, session.snapshot.hourStartedAt, []);
        return { kind: 'gone' as const };
      }

      // The reader is the backstop, not the clock: it only wakes a town the
      // scheduler has left more than an hour behind.
      const due = await playDue(
        session,
        { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
        at,
        2,
      );
      // The absence was simulated dormant; the visit itself wakes the house for
      // the hour that follows.
      const woke = wake(due.world, houseId);

      if (due.hours > 0 || presence.changed || woke) {
        await session.save(due.world, due.hourStartedAt, due.events);
      }

      const journal = await session.eventsSince(cursor, JOURNAL_PAGE, houseId);

      return { kind: 'caught' as const, town: session.snapshot.town, result: due, journal };
    }, townId);
  }

  function advanceTown(townId: string, houseId: string, cursor: number, at: Date): Promise<TownOutcome> {
    return deps.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);
      const presence = await synchronisePresence(townId, world, at);

      if (humanHouseOf(presence.world) === undefined) {
        await session.clear();
        return { kind: 'gone' as const };
      }

      if (presence.deletedHouseIds.includes(houseId)) {
        await session.save(presence.world, session.snapshot.hourStartedAt, []);
        return { kind: 'gone' as const };
      }

      // One hour further than the town's own clock, whatever the wall clock
      // says: the click is the hour.
      const forced = new Date(session.snapshot.hourStartedAt.getTime() + HOUR_MS);
      const due = await playDue(
        session,
        { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
        forced,
        1,
      );
      wake(due.world, houseId);
      // The hour was simulated, not lived. Put the next natural hour an hour
      // from the real now, instead of stacking a backlog.
      const savedAt = new Date(now());
      await session.save(due.world, savedAt, due.events);

      const journal = await session.eventsSince(cursor, JOURNAL_PAGE, houseId);

      return {
        kind: 'caught' as const,
        town: session.snapshot.town,
        result: { ...due, hourStartedAt: savedAt },
        journal,
      };
    }, townId);
  }

  async function synchronisePresence(worldId: string, world: World, at: Date): Promise<Presence> {
    const players = await deps.store.listByWorld(worldId);
    const presence = applyPresence(world, players, at.getTime());

    for (const houseId of presence.deletedHouseIds) {
      await deps.store.revokeHouse(worldId, houseId, at);
      deps.logger.warn('world.house_deleted', { worldId, houseId });
    }

    return presence;
  }

  function sessionWorld(session: WorldSession): World {
    // Wake no house and revoke no token before the world is known readable: a
    // format-1 world must be refused without touching its players.
    const world = session.snapshot.world;
    if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
      throw new WorldVersionError(world);
    }

    return world;
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

type TownOutcome = { kind: 'caught'; town: TownInfo; result: Due; journal: JournalPage } | { kind: 'gone' };

type ActionOutcome =
  | { kind: 'stale'; currentHour: number }
  | { kind: 'future'; currentHour: number }
  | { kind: 'duplicate' }
  | { kind: 'appended'; stored: StoredAction };

/** The visit wakes a house the absence had made dormant, for the hour to come. */
function wake(world: World, houseId: string): boolean {
  const house = world.houses[houseId];

  if (house === undefined || !house.dormant) {
    return false;
  }

  house.dormant = false;

  return true;
}

function isReadable(request: IncomingMessage): boolean {
  return request.method === 'GET' || request.method === 'HEAD';
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
