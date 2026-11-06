import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createWorld, humanHouseOf, RULES, TRADES, withFirstHouse, withNewcomer, type Trade } from '@brigue/core';

import { closingOf, HouseAlreadyBoundError, type Player } from '../../identity/players.ts';
import { authenticate, issueToken } from '../../identity/session.ts';
import { drawHouseIdentity, drawTownName } from '../../town/names.ts';
import { type TownInfo, sessionWorld, UnknownWorldError } from '../../town/worlds.ts';
import { identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readSessionCookie, sessionCookie } from '../cookies.ts';
import { readBody, sendJson, unauthorized } from '../respond.ts';

export async function readSession(context: AppContext, request: IncomingMessage, response: ServerResponse) {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  if (closingOf(player, new Date(context.now())).kind === 'due') {
    unauthorized(response, context.secureCookies, true);
    return;
  }

  sendJson(response, 200, sessionBody(player));
}

export async function openSession(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const ip = clientAddress(request, context.trustProxy);
  const decision = context.limiter.take(ip, context.now());

  if (!decision.allowed) {
    context.deps.logger.warn('session.rate_limited', { ip });
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

    await resumeSession(context, response, ip, candidate);
    return;
  }

  // A join carries the trade the player chose. No default: the choice is the
  // screen's, and a missing trade must not silently weave.
  const trade = (body as { trade?: unknown } | null | undefined)?.trade;
  if (typeof trade !== 'string' || !TRADES.includes(trade as Trade)) {
    sendJson(response, 400, { error: 'invalid_trade' });
    return;
  }

  // The cookie is an identity too: an account a reset left without a house
  // takes a new one with the trade it chooses, instead of a second account.
  // The choice is an explicit action; no read ever binds.
  const cookiePlayer = await authenticate(context.deps.store, readSessionCookie(request.headers.cookie));

  if (cookiePlayer !== null) {
    await chooseHouse(context, response, ip, cookiePlayer, trade as Trade);
    return;
  }

  await joinTown(context, response, ip, trade as Trade);
}

async function resumeSession(context: AppContext, response: ServerResponse, ip: string, token: string): Promise<void> {
  const player = await authenticate(context.deps.store, token);

  if (player === null) {
    // Unknown, revoked and malformed answer the same way: a 401 and nothing.
    context.deps.logger.warn('session.refused', { ip });
    unauthorized(response, context.secureCookies, false);
    return;
  }

  if (closingOf(player, new Date(context.now())).kind === 'due') {
    context.deps.logger.warn('session.deletion_due', { ip, townId: player.townId, houseId: player.houseId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  context.deps.logger.info('session.opened', { ip, townId: player.townId, houseId: player.houseId });
  sendJson(response, 200, sessionBody(player), { 'Set-Cookie': sessionCookie(token, context.secureCookies) });
}

async function joinTown(context: AppContext, response: ServerResponse, ip: string, trade: Trade): Promise<void> {
  const at = new Date(context.now());

  try {
    // The join is one critical section: two newcomers must not both take the
    // same freed place, nor read an empty database and found two towns.
    const joined = await context.deps.worlds.withJoinLock(async () => {
      const placed = await takePlaceAnywhere(context, trade, at);
      const issued = await issueToken(context.deps.store, placed.town.id, placed.houseId, at);

      return { ...placed, token: issued.token };
    });

    context.deps.logger.info('session.joined', { ip, townId: joined.town.id, houseId: joined.houseId });
    sendJson(
      response,
      201,
      { townId: joined.town.id, houseId: joined.houseId, token: joined.token },
      { 'Set-Cookie': sessionCookie(joined.token, context.secureCookies) },
    );
  } catch (error) {
    if (error instanceof HouseAlreadyBoundError) {
      context.deps.logger.warn('session.no_free_house', { ip });
      sendJson(response, 409, { error: 'no_free_house' });
      return;
    }
    throw error;
  }
}

/**
 * The trade of an account that already holds a live cookie. A house-less
 * account gets a house back — the token and the player id stay — and a bound
 * one just gets its session again, so a retried tap never opens a second
 * account. Refused while a deletion is scheduled or due, like every route.
 */
async function chooseHouse(
  context: AppContext,
  response: ServerResponse,
  ip: string,
  player: Player,
  trade: Trade,
): Promise<void> {
  const at = new Date(context.now());
  const closing = closingOf(player, at);

  if (closing.kind === 'due') {
    context.deps.logger.warn('session.deletion_due', { ip, playerId: player.playerId });
    unauthorized(response, context.secureCookies, true);
    return;
  }
  if (closing.kind === 'pending') {
    sendJson(response, 409, { error: 'deletion_pending', deleteAfter: closing.after.toISOString() });
    return;
  }

  let outcome: { kind: 'answered' } | { kind: 'refused' } | { kind: 'bound' | 'rebound'; player: Player };

  try {
    outcome = await context.deps.worlds.withJoinLock(async () => {
      // Re-read under the lock: another request may have bound the account
      // already, or scheduled its deletion, and no place should be spent on a
      // choice that cannot land.
      const current = await context.deps.store.findByTokenHash(player.tokenHash);

      if (current === null) {
        return { kind: 'refused' as const };
      }
      if (refuseClosing(context, current, response, at)) {
        return { kind: 'answered' as const };
      }
      if (current.revokedAt !== null) {
        return { kind: 'refused' as const };
      }
      if (current.houseId !== null) {
        return { kind: 'bound' as const, player: current };
      }

      const placed = await takePlaceAnywhere(context, trade, at);
      const rebound = await context.deps.store.rebind(player.tokenHash, placed.town.id, placed.houseId, at);

      return rebound === null ? { kind: 'refused' as const } : { kind: 'rebound' as const, player: rebound };
    });
  } catch (error) {
    if (error instanceof HouseAlreadyBoundError) {
      context.deps.logger.warn('session.no_free_house', { ip });
      sendJson(response, 409, { error: 'no_free_house' });
      return;
    }
    throw error;
  }

  if (outcome.kind === 'answered') {
    // The deletion check inside the lock already answered, with the same
    // refusal the first check would have given.
    return;
  }
  if (outcome.kind === 'refused') {
    context.deps.logger.warn('session.refused', { ip });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  if (outcome.kind === 'rebound') {
    context.deps.logger.info('session.rebound', {
      ip,
      playerId: outcome.player.playerId,
      townId: outcome.player.townId,
      houseId: outcome.player.houseId,
    });
  }
  // No new token: the returning account keeps its own, and there is nothing
  // new to show.
  sendJson(response, 200, sessionBody(outcome.player));
}

/**
 * The place a join takes: a free house in a town, else a town of its own. The
 * caller holds the join lock, so two joins never take the same place.
 */
async function takePlaceAnywhere(
  context: AppContext,
  trade: Trade,
  at: Date,
): Promise<{ town: TownInfo; houseId: string }> {
  for (const town of await context.deps.worlds.listTowns()) {
    let houseId: string | null;

    try {
      houseId = await takePlace(context, town.id, trade);
    } catch (error) {
      // The town went between the list and its lock, or the scheduler deleted
      // it: the next join will not see it either.
      if (error instanceof UnknownWorldError) {
        continue;
      }
      // A town of another version is refused, and stops the join: the format
      // belongs to the database, not to one town.
      throw error;
    }

    if (houseId !== null) {
      return { town, houseId };
    }
  }

  return foundTown(context, trade, at);
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
async function takePlace(context: AppContext, townId: number, trade: Trade): Promise<string | null> {
  return context.deps.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);

    if (humanHouseOf(world) === undefined) {
      return null;
    }

    const players = await context.deps.store.listByTown(townId);
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
async function foundTown(context: AppContext, trade: Trade, at: Date): Promise<{ town: TownInfo; houseId: string }> {
  const name = drawTownName();
  const world = createWorld(randomSeed());
  const identity = drawHouseIdentity(world);
  const town = await context.deps.worlds.createTown(name, withFirstHouse(world, trade, identity), at);

  return { town, houseId: identity.id };
}

function sessionBody(player: Player): Record<string, unknown> {
  return {
    townId: player.townId,
    houseId: player.houseId,
    deletionAfter: player.deleteAfter?.toISOString() ?? null,
  };
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
