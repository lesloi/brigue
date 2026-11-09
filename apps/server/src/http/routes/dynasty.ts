import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidName, NAME_PRICE, nameKey, renamePerson, sanitizeName } from '@brigue/core';

import { applyPresence } from '../../town/presence.ts';
import { NameInUseError, sessionWorld } from '../../town/worlds.ts';
import type { BoundPlayer } from '../../identity/players.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readBody, sendJson } from '../respond.ts';
import { humanNamesElsewhere } from './name-suggestion.ts';

/**
 * The family name, changed at once rather than queued.
 *
 * The name lives on the account; the person carries a display name that follows
 * it. A name is identity, not trade: the player who pays for it should not read
 * the old one until the next hour, and a queued rename would reserve a name for
 * an hour in front of every other account. The route runs under the world's own
 * lock — the same one the scheduler takes — and writes the town in that session,
 * so no tick can land between the check and the write.
 *
 * The name's rules are the core's: two names that differ by case or by accent
 * are one name, and a name another account carries is refused with 409. The
 * database compares bytes, so the read of the accounts is the check that counts.
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
    // Check against the accounts before touching the world: the person's
    // display name and the purse are written only for a name the server keeps.
    const elsewhere = await humanNamesElsewhere(context, player.name);
    if (elsewhere.has(nameKey(cleaned))) {
      sendJson(response, 409, { error: 'name_taken' });
      return;
    }

    const outcome = await renameInTown(context, bound, player.name, cleaned);

    if (outcome.kind === 'renamed') {
      // The account is the source of truth for the family name; the person's
      // display name follows it in the world.
      await context.deps.store.renameName(player.tokenHash, cleaned);
    }

    answer(response, context, bound, outcome.kind, outcome.kind === 'renamed' ? outcome.name : undefined);
  } catch (error) {
    if (error instanceof NameInUseError) {
      sendJson(response, 409, { error: 'name_taken' });
      return;
    }
    throw error;
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
    const { world, hourStartedAt } = session.snapshot;
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
    await session.save(next, hourStartedAt, []);

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
