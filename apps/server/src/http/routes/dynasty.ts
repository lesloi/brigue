import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidName, NAME_PRICE, nameKey, renamePerson, sanitizeName } from '@brigue/core';

import { applyPresence } from '../../town/presence.ts';
import { NameInUseError, sessionWorld } from '../../town/worlds.ts';
import { NameAlreadyBoundError, type BoundPlayer, type Player } from '../../identity/players.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readBody, sendJson } from '../respond.ts';
import { humanNamesElsewhere } from './name-suggestion.ts';

/**
 * The family name, changed at once rather than queued.
 *
 * The name lives on the account; the person carries a display name that follows
 * it. A name is identity, not trade: the player who pays for it should not read
 * the old one until the next hour, and a queued rename would reserve a name for
 * an hour in front of every other account. The account takes the name first,
 * and its unique index is the only atomic check; the town is written after it,
 * and a town that refuses gives the old name back, so the account and the
 * person never stay apart.
 *
 * The name's rules are the core's: two names that differ by case or by accent
 * are one name, and a name another account carries is refused with 409. The
 * database compares bytes, so the write to the account is the check that counts.
 */
export async function renameFamilyRoute(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  const at = new Date(context.now());

  if (refuseClosing(context, player, response, at)) {
    return;
  }

  const bound = boundPlayerOf(context, player, response);

  if (bound === null) {
    return;
  }

  const read = await readBody(request, response);
  if (!read.ok) {
    return;
  }

  const name = readName(read.body);
  if (name === undefined) {
    sendJson(response, 400, { error: 'invalid_name' });
    return;
  }
  const cleaned = sanitizeName(name);
  if (!isValidName(cleaned)) {
    sendJson(response, 400, { error: 'invalid_name' });
    return;
  }

  try {
    // The accounts are the source of truth for the family name, and their unique
    // index is the only atomic check: the name is taken first, so a name another
    // account carries is refused before the person is renamed or the town
    // charged. This read only spares that round trip in the common case.
    const elsewhere = await humanNamesElsewhere(context, player.name);
    if (elsewhere.has(nameKey(cleaned))) {
      sendJson(response, 409, { error: 'name_taken' });
      return;
    }

    await context.deps.store.renameName(player.tokenHash, cleaned);

    let outcome: RenameOutcome;
    try {
      outcome = await renameInTown(context, bound, player.name, cleaned);
    } catch (error) {
      await giveNameBack(context, player, cleaned);
      throw error;
    }

    // The town can still refuse — a purse an hour spent, a person gone silent —
    // and the account must not carry a name the person does not.
    if (outcome.kind !== 'renamed') {
      await giveNameBack(context, player, cleaned);
    }

    answer(response, context, bound, outcome.kind, outcome.kind === 'renamed' ? outcome.name : undefined);
  } catch (error) {
    if (error instanceof NameInUseError || error instanceof NameAlreadyBoundError) {
      sendJson(response, 409, { error: 'name_taken' });
      return;
    }
    throw error;
  }
}

/**
 * Puts the old name back after a town refused the rename the account had already
 * taken. Only the name this request took comes back: a later rename may have
 * landed in the window, and an older request must not overwrite it. The revert
 * can still fail — the old name was free, and another account may have taken it
 * meanwhile — and the display name is then behind the account until the next
 * rename reads the account again, which is better than a name nobody paid for.
 *
 * No transaction spans the account and the town, so a process that dies between
 * the two writes leaves the same gap open.
 */
async function giveNameBack(context: AppContext, player: Player, taken: string): Promise<void> {
  if (nameKey(player.name) === nameKey(taken)) {
    return;
  }

  const current = await context.deps.store.findByTokenHash(player.tokenHash);
  if (current === null || nameKey(current.name) !== nameKey(taken)) {
    return;
  }

  try {
    await context.deps.store.renameName(player.tokenHash, player.name);
  } catch (error) {
    context.deps.logger.warn('player.name_not_given_back', {
      name: taken,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}

type RenameOutcome = { kind: 'renamed'; name: string } | { kind: 'taken' | 'dormant' | 'poor' | 'invalid' | 'lost' };

async function renameInTown(
  context: AppContext,
  bound: BoundPlayer,
  before: string,
  name: string,
): Promise<RenameOutcome> {
  return context.deps.worlds.withWorld(async (session) => {
    const { world } = session.snapshot;
    sessionWorld(session);

    const person = world.people[bound.personId];
    if (person === undefined) {
      return { kind: 'lost' as const };
    }
    // Silence is a fact about the account, not the world: it is read here the
    // same way the catch-up reads it. Past the deletion threshold the person is
    // already gone, and a rename must not slip into the snapshot before the
    // next read removes it.
    const players = await context.deps.store.listByTown(bound.townId);
    const presence = applyPresence(world, players, context.now());
    if (presence.deletedPersonIds.includes(person.id)) {
      return { kind: 'lost' as const };
    }
    if (presence.dormant.has(person.id)) {
      return { kind: 'dormant' as const };
    }

    const next = presence.world;
    const renamed = next.people[person.id];
    if (renamed === undefined) {
      return { kind: 'lost' as const };
    }
    if (renamed.treasuryCents < NAME_PRICE.renameCents) {
      return { kind: 'poor' as const };
    }

    renamed.treasuryCents -= NAME_PRICE.renameCents;
    renamed.name = renamePerson(renamed.name, before, name);
    // A name is identity, not a journal line: the Maison screen carries it.
    await session.write(next, []);

    return { kind: 'renamed' as const, name };
  }, bound.townId);
}

/** What the route answers for what the town did with the name. */
function answer(
  response: ServerResponse,
  context: AppContext,
  bound: BoundPlayer,
  kind: RenameOutcome['kind'],
  name?: string,
): void {
  switch (kind) {
    case 'renamed':
      context.deps.logger.info('person.renamed', { townId: bound.townId, personId: bound.personId });
      sendJson(response, 200, { name });
      return;
    case 'taken':
      sendJson(response, 409, { error: 'name_taken' });
      return;
    case 'dormant':
      sendJson(response, 409, { error: 'dormant_person' });
      return;
    case 'poor':
      sendJson(response, 409, { error: 'insufficient_funds' });
      return;
    case 'invalid':
      sendJson(response, 400, { error: 'invalid_name' });
      return;
    case 'lost':
      sendJson(response, 404, { error: 'unknown_person' });
  }
}

/**
 * The only field a rename carries: a string, or nothing to rename. The rule on
 * it is the core's, and it is asked where the name would land, so the refusal
 * is the same as an event's.
 */
function readName(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  const name = (body as { name?: unknown }).name;

  return typeof name === 'string' ? name : undefined;
}
