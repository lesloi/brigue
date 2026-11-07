import type { IncomingMessage, ServerResponse } from 'node:http';

import { AI_HOUSE_NAMES, isValidName, nameKey, sanitizeName } from '@brigue/core';

import { closingOf } from '../../identity/players.ts';
import { authenticate } from '../../identity/session.ts';
import { drawHouseIdentity, suggestHouseName } from '../../town/names.ts';
import type { AppContext } from '../context.ts';
import { readSessionCookie } from '../cookies.ts';
import { sendJson } from '../respond.ts';

/** What a join is made of: an opaque id, and the names the house is written with. */
export interface Candidate {
  /** Opaque, never derived from the name: a retried join keeps the same house. */
  id: string;
  houseName: string;
  personName: string;
}

/**
 * The names no human house of the server may take: the human houses already
 * there, and the three AI houses, which carry the same names in every town.
 * Only a human house is ranked by name across towns, which is why the AI ones
 * are absent from the store's list and present here.
 */
export async function humanNamesElsewhere(context: AppContext): Promise<Set<string>> {
  const humans = await context.deps.worlds.listHumanNames();

  return new Set([...humans, ...AI_HOUSE_NAMES].map((name) => nameKey(name)));
}

/**
 * The names the towns of the server carry: a suggestion the creation screen
 * prefills must be free in the town the join reaches, its AI houses included.
 * The pool already avoids the composition's three, so this matters for a town
 * whose AI names are not the ones the pool expects.
 */
export async function namesInSettledTowns(context: AppContext): Promise<string[]> {
  const names: string[] = [];

  for (const town of await context.deps.worlds.listTowns()) {
    try {
      const carried = await context.deps.worlds.withWorld(
        async (session) => Object.values(session.snapshot.world.houses).map((house) => house.name),
        town.id,
      );
      names.push(...carried);
    } catch {
      // The town went between the list and its lock: the join takes the next
      // one, and the suggestion is drawn for the towns that remain.
    }
  }

  return names;
}

/**
 * The candidate a join is made from. Given no name, one the whole server
 * leaves free is drawn — the creation screen prefills it — and the pool is
 * asked again rather than drawn once, so a fresh town still gets one while the
 * pool is not exhausted. Given a name, only the id and the first name are
 * drawn: the player's name is theirs.
 */
export function candidateFor(kept: string | undefined, taken: readonly string[]): Candidate {
  const elsewhere = new Set(AI_HOUSE_NAMES.map((carried) => nameKey(carried)));
  const identity = drawHouseIdentity(kept ?? suggestHouseName(taken, elsewhere));

  return { id: identity.id, houseName: identity.houseName, personName: identity.personName };
}

/**
 * What a join body claims: the name the player kept, and the id of the
 * candidate the screen prefilled. The name travels on its own — `{ trade, name }`
 * — and the candidate adds its id around it; either may be missing. No name at
 * all is a client from before the field, which asks for the suggestion; an
 * empty one is a name someone typed and deleted, and is refused like any other
 * bad one. Any other shape is poisoned, and the caller founds nothing for it.
 */
export function readClaim(
  body: unknown,
): { kind: 'none' } | { kind: 'poisoned' } | { kind: 'claimed'; id: string | null; name: string } {
  const claim = body as { candidate?: { id?: unknown } | null; name?: unknown } | null | undefined;
  const rawId = typeof claim?.candidate === 'object' && claim.candidate !== null ? claim.candidate.id : undefined;
  const rawName = claim?.name;

  if (rawId !== undefined && (typeof rawId !== 'string' || !/^house-[0-9a-f-]{36}$/.test(rawId))) {
    return { kind: 'poisoned' };
  }
  if (rawName !== undefined && typeof rawName !== 'string') {
    return { kind: 'poisoned' };
  }
  if (rawId === undefined && rawName === undefined) {
    return { kind: 'none' };
  }

  return { kind: 'claimed', id: typeof rawId === 'string' ? rawId : null, name: sanitizeName(rawName ?? '') };
}

/**
 * The candidate a claim makes, with the name kept judged by the rule before
 * any town exists: a name the rule refuses never reaches one. `null` is that
 * refusal.
 */
export function settledCandidate(
  claim: { id: string | null; name: string },
  taken: readonly string[],
): Candidate | null {
  if (claim.name !== '' && !isValidName(claim.name)) {
    return null;
  }
  const kept = claim.name === '' ? undefined : claim.name;

  const candidate = candidateFor(kept, kept === undefined ? taken : []);

  return { ...candidate, id: claim.id ?? candidate.id };
}

/**
 * `GET /api/house/name`: the candidate the creation screen prefills, and a free
 * name for the Maison screen. Drawn on the server — the screen computes no rule
 * — and written nowhere. The read is rate-limited like a join, because it is
 * the first half of one, and an account between towns asks with its cookie: a
 * closing identity gets nothing, like everywhere else.
 */
export async function readCandidate(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const ip = clientAddress(request, context.trustProxy);
  const decision = context.limiter.take(ip, context.now());

  if (!decision.allowed) {
    context.deps.logger.warn('house.name_rate_limited', { ip });
    response.writeHead(429, { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) });
    response.end();
    return;
  }

  const player = await authenticate(context.deps.store, readSessionCookie(request.headers.cookie));

  if (player !== null && closingOf(player, new Date(context.now())).kind !== 'none') {
    sendJson(response, 409, { error: 'deletion_pending' });
    return;
  }

  const kept = queryName(request);
  const taken = kept !== null ? [] : await namesInSettledTowns(context);

  sendJson(response, 200, candidateFor(kept ?? undefined, taken), { 'Cache-Control': 'no-store' });
}

function queryName(request: IncomingMessage): string | null {
  const name = new URL(request.url ?? '/', 'http://localhost').searchParams.get('name');

  return name === null ? null : sanitizeName(name);
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
