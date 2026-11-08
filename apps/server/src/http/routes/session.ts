import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  createWorld,
  humanDynastyOf,
  renameDynasty,
  RULES,
  TRADES,
  withFirstDynasty,
  withNewcomer,
  type NameRefusal,
  type Trade,
  type World,
} from '@brigue/core';

import { closingOf, DynastyAlreadyBoundError, type Player } from '../../identity/players.ts';
import { authenticate, issueToken } from '../../identity/session.ts';
import { drawDynastyIdentity, drawTownName } from '../../town/names.ts';
import { NameInUseError, sessionWorld, UnknownWorldError, type TownInfo } from '../../town/worlds.ts';
import { identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readSessionCookie, sessionCookie } from '../cookies.ts';
import { readBody, sendJson, unauthorized } from '../respond.ts';
import {
  candidateFor,
  humanNamesElsewhere,
  namesInSettledTowns,
  readClaim,
  settledCandidate,
  type Candidate,
} from './name-suggestion.ts';

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

  // The name is the player's, kept from the creation screen. It is judged
  // before anything is founded, so a bad paste costs nothing.
  const claim = await claimed(context, body);
  if (claim === null) {
    sendJson(response, 400, { error: 'invalid_name' });
    return;
  }

  // The cookie is an identity too: an account a reset left without a dynasty
  // takes a new one with the trade it chooses, instead of a second account.
  // The choice is an explicit action; no read ever binds.
  const cookiePlayer = await authenticate(context.deps.store, readSessionCookie(request.headers.cookie));

  if (cookiePlayer !== null) {
    await chooseDynasty(context, response, ip, cookiePlayer, trade as Trade, claim);
    return;
  }

  await joinTown(context, response, ip, trade as Trade, claim);
}

/**
 * The candidate a join writes, resolved lazily: a suggestion is drawn inside
 * the join lock, so it is free against the towns the join will look at. A name
 * the rule refuses is answered with nothing, before any town exists.
 */
async function claimed(context: AppContext, body: unknown): Promise<(() => Promise<Candidate>) | null> {
  const raw = readClaim(body);

  if (raw.kind === 'poisoned') {
    return null;
  }

  // An empty name is a refusal of the suggestion, which the join then keeps.
  const kept = raw.kind === 'claimed' && raw.name !== '' ? settledCandidate(raw, []) : null;
  if (raw.kind === 'claimed' && raw.name !== '' && kept === null) {
    return null;
  }

  return async () => kept ?? candidateFor(undefined, await namesInSettledTowns(context));
}

async function resumeSession(context: AppContext, response: ServerResponse, ip: string, token: string): Promise<void> {
  const player = await authenticate(context.deps.store, token);

  if (player === null) {
    // Unknown and malformed answer the same way: a 401 and nothing.
    context.deps.logger.warn('session.refused', { ip });
    unauthorized(response, context.secureCookies, false);
    return;
  }

  if (closingOf(player, new Date(context.now())).kind === 'due') {
    context.deps.logger.warn('session.deletion_due', { ip, townId: player.townId, dynastyId: player.dynastyId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  context.deps.logger.info('session.opened', { ip, townId: player.townId, dynastyId: player.dynastyId });
  sendJson(response, 200, sessionBody(player), { 'Set-Cookie': sessionCookie(token, context.secureCookies) });
}

/** A join's candidate, drawn once the join lock is held. */
type Claim = () => Promise<Candidate>;

async function joinTown(
  context: AppContext,
  response: ServerResponse,
  ip: string,
  trade: Trade,
  claim: Claim,
): Promise<void> {
  const at = new Date(context.now());

  try {
    // The join is one critical section: two newcomers must not both take the
    // same freed place, nor read an empty database and found two towns.
    const joined = await context.deps.worlds.withJoinLock(async () => {
      const candidate = await claim();
      const elsewhere = await humanNamesElsewhere(context);
      const placed = await takePlace(context, trade, candidate, elsewhere, at);
      const { token } = await issueToken(context.deps.store, placed.town.id, placed.dynastyId, at);

      return { townId: placed.town.id, dynastyId: placed.dynastyId, token };
    });

    context.deps.logger.info('session.joined', { ip, townId: joined.townId, dynastyId: joined.dynastyId });
    sendJson(
      response,
      201,
      { townId: joined.townId, dynastyId: joined.dynastyId, token: joined.token },
      { 'Set-Cookie': sessionCookie(joined.token, context.secureCookies) },
    );
  } catch (error) {
    if (await refusedJoin(context, response, ip, error)) {
      return;
    }
    throw error;
  }
}

/**
 * The trade of an account that already holds a live cookie. A dynasty-less
 * account gets a dynasty back — the token and the player id stay — and a bound
 * one just gets its session again, so a retried tap never opens a second
 * account. Refused while a deletion is scheduled or due, like every route.
 */
async function chooseDynasty(
  context: AppContext,
  response: ServerResponse,
  ip: string,
  player: Player,
  trade: Trade,
  claim: Claim,
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
      if (current.dynastyId !== null) {
        return { kind: 'bound' as const, player: current };
      }

      const candidate = await claim();
      const elsewhere = await humanNamesElsewhere(context);
      const placed = await takePlace(context, trade, candidate, elsewhere, at);
      const rebound = await context.deps.store.rebind(player.tokenHash, placed.town.id, placed.dynastyId, at);

      return rebound === null ? { kind: 'refused' as const } : { kind: 'rebound' as const, player: rebound };
    });
  } catch (error) {
    if (await refusedJoin(context, response, ip, error)) {
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
      dynastyId: outcome.player.dynastyId,
    });
  }
  // No new token: the returning account keeps its own, and there is nothing
  // new to show.
  sendJson(response, 200, sessionBody(outcome.player));
}

/** The two refusals a join answers itself, instead of letting them surface. */
async function refusedJoin(
  context: AppContext,
  response: ServerResponse,
  ip: string,
  error: unknown,
): Promise<boolean> {
  if (error instanceof DynastyAlreadyBoundError) {
    context.deps.logger.warn('session.no_free_dynasty', { ip });
    sendJson(response, 409, { error: 'no_free_dynasty' });
    return true;
  }
  if (error instanceof NameRefusedError) {
    // The suggestion is exhausted and the body carried no name to fall back on.
    context.deps.logger.warn('session.name_missing', { ip });
    sendJson(response, 409, { error: 'name_required' });
    return true;
  }
  if (error instanceof NameTakenError || error instanceof NameInUseError) {
    // The town's own rule, or the index that catches a name a second server
    // slipped in: the screen answers both the same way.
    context.deps.logger.warn('session.name_taken', { ip });
    sendJson(response, 409, { error: 'name_taken' });
    return true;
  }

  return false;
}

/** The name a join kept is one the server already carries, in a human dynasty. */
class NameTakenError extends Error {
  constructor() {
    super('the name is taken');
    this.name = 'NameTakenError';
  }
}

/**
 * The place a join takes: a free dynasty in a town, else a town of its own. The
 * caller holds the join lock, so two joins never take the same place, and the
 * place is written here — before the token, so a failure after it leaves a
 * dynasty the next join takes, under that join's own name. The dynasty it returns
 * is the one written: the place's own id when it waited, the candidate's when
 * it is new.
 */
async function takePlace(
  context: AppContext,
  trade: Trade,
  candidate: Candidate,
  elsewhere: ReadonlySet<string>,
  at: Date,
): Promise<{ town: TownInfo; dynastyId: string }> {
  for (const town of await context.deps.worlds.listTowns()) {
    let placed: string | null;

    try {
      placed = await takePlaceIn(context, town, trade, candidate, elsewhere);
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

    if (placed !== null) {
      return { town, dynastyId: placed };
    }
  }

  const name = drawTownName();
  const world = createWorld(randomSeed());
  const dynastyId = settle(world, trade, candidate, elsewhere, 'first');

  return { town: await context.deps.worlds.createTown(name, world, at), dynastyId };
}

/**
 * The place a newcomer takes in a town: a human dynasty no player has ever taken
 * (the one the town was just created with, or a place whose token was never
 * issued), else a new human dynasty until the town is full. A dynasty a player has
 * taken stays theirs while it is silent — a deleted account does not give it away
 * — until the silence rule deletes it. A full town offers nothing; the join
 * moves on. A town whose last human dynasty has gone is on its way out, and is
 * left alone.
 */
async function takePlaceIn(
  context: AppContext,
  town: TownInfo,
  trade: Trade,
  candidate: Candidate,
  elsewhere: ReadonlySet<string>,
): Promise<string | null> {
  return context.deps.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);

    if (humanDynastyOf(world) === undefined) {
      return null;
    }

    const players = await context.deps.store.listByTown(town.id);
    const taken = new Set(players.map((player) => player.dynastyId));
    const free = Object.values(world.dynasties).find(
      (dynasty) => dynasty.controller === 'human' && !taken.has(dynasty.id),
    );

    if (free !== undefined) {
      // The place waits with the name its first player would have had: the one
      // this player kept takes over, unpaid, as at creation.
      const next = structuredClone(world);
      const outcome = renameDynasty(next, next.dynasties[free.id]!, {
        name: candidate.dynastyName,
        priceCents: 0,
        takenElsewhere: elsewhere,
      });
      if (!outcome.ok) {
        throw refusalOf(outcome.reason, candidate.dynastyName);
      }

      await session.save(next, session.snapshot.hourStartedAt, []);
      return free.id;
    }
    if (Object.keys(world.dynasties).length >= RULES.dynastyCap) {
      return null;
    }

    const next = structuredClone(world);
    const dynastyId = settle(next, trade, candidate, elsewhere, 'newcomer');
    await session.save(next, session.snapshot.hourStartedAt, []);

    return dynastyId;
  }, town.id);
}

/**
 * Adds a dynasty under the name it kept, and gives the world back changed in
 * place: the identity carries an opaque id, the name is the player's, and the
 * person is named after it. The two builders share that shape, and the name is
 * judged here — against the dynasties of the town and the human ones elsewhere —
 * before the caller writes anything. Returns the id the dynasty was written
 * under: the candidate's, unless this world already holds it, in which case a
 * client is replaying a candidate and the dynasty is minted again rather than
 * overwriting the one that carries the id.
 */
function settle(
  world: World,
  trade: Trade,
  candidate: Candidate,
  elsewhere: ReadonlySet<string>,
  kind: 'first' | 'newcomer',
): string {
  const dynastyId = Object.hasOwn(world.dynasties, candidate.id)
    ? drawDynastyIdentity(candidate.dynastyName).id
    : candidate.id;
  const firstName = candidate.personName.split(' ')[0] ?? '';
  const identity = {
    id: dynastyId,
    dynastyName: candidate.dynastyName,
    personName: `${firstName} ${candidate.dynastyName}`.trim(),
  };
  const placed = kind === 'first' ? withFirstDynasty(world, trade, identity) : withNewcomer(world, trade, identity);
  const dynasty = placed.dynasties[dynastyId];
  if (dynasty === undefined) {
    throw new Error(`the dynasty ${dynastyId} was not added to the world`);
  }

  const outcome = renameDynasty(placed, dynasty, {
    name: candidate.dynastyName,
    priceCents: 0,
    takenElsewhere: elsewhere,
  });
  if (!outcome.ok) {
    throw refusalOf(outcome.reason, candidate.dynastyName);
  }

  Object.assign(world, placed);

  return dynastyId;
}

/**
 * A name the town will not keep, said the way a join answers: taken, or not a
 * name at all — the second is the suggestion's pool exhausted, and a client
 * with no field has nothing to write. It is a refusal, not a bug.
 */
function refusalOf(reason: NameRefusal, name: string): Error {
  return reason === 'name_taken' ? new NameTakenError() : new NameRefusedError(name);
}

/** A name the town cannot carry, and nothing a retry of the same body fixes. */
class NameRefusedError extends Error {
  constructor(name: string) {
    super(`the name "${name}" was refused`);
    this.name = 'NameRefusedError';
  }
}

function sessionBody(player: Player): Record<string, unknown> {
  return {
    townId: player.townId,
    dynastyId: player.dynastyId,
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
