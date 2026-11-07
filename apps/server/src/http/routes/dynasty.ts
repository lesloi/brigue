import type { IncomingMessage, ServerResponse } from 'node:http';

import { NAME_PRICE, renameDynasty } from '@brigue/core';

import { NameInUseError, sessionWorld } from '../../town/worlds.ts';
import type { BoundPlayer } from '../../identity/players.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readBody, sendJson } from '../respond.ts';
import { humanNamesElsewhere } from './name-suggestion.ts';

/**
 * The dynasty's name, changed at once rather than queued.
 *
 * A name is identity, not trade: the player who pays for it should not read the
 * old one until the next hour, and a queued rename would reserve a name for an
 * hour in front of every other dynasty. The route runs under the world's own lock
 * — the same one the scheduler takes — and writes the town in that session, so
 * no tick can land between the check and the write.
 *
 * The name's rules are the core's: two names that differ by case or by accent
 * are one name, and a name another dynasty carries is refused with 409. The
 * database compares bytes, so the read of the dynasties is the check that counts.
 */
export async function renameDynastyRoute(
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

  try {
    const outcome = await renameInTown(context, bound, name);

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

async function renameInTown(context: AppContext, bound: BoundPlayer, name: string): Promise<RenameOutcome> {
  return context.deps.worlds.withWorld(async (session) => {
    const { world, hourStartedAt } = session.snapshot;
    sessionWorld(session);

    const dynasty = world.dynasties[bound.dynastyId];
    if (dynasty === undefined) {
      return { kind: 'lost' as const };
    }
    if (dynasty.dormant) {
      return { kind: 'dormant' as const };
    }

    const next = structuredClone(world);
    const renamed = next.dynasties[dynasty.id];
    if (renamed === undefined) {
      return { kind: 'lost' as const };
    }

    // A human dynasty is held to the server-wide rule; the town's own dynasties are
    // read from the world the route locked, and the keys of the humans
    // elsewhere were read before the lock: a dynasty founded between the two is
    // caught by the index, and the save fails whole rather than half-write.
    const outcome = renameDynasty(next, renamed, {
      name,
      priceCents: NAME_PRICE.renameCents,
      takenElsewhere: await humanNamesElsewhere(context),
    });

    switch (outcome.ok ? 'renamed' : outcome.reason) {
      case 'renamed':
        // A name is identity, not a journal line: the Maison screen carries it.
        await session.save(next, hourStartedAt, []);

        return { kind: 'renamed' as const, name: renamed.name };
      case 'name_taken':
        return { kind: 'taken' as const };
      case 'insufficient_funds':
        return { kind: 'poor' as const };
      default:
        return { kind: 'invalid' as const };
    }
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
      context.deps.logger.info('dynasty.renamed', { townId: bound.townId, dynastyId: bound.dynastyId });
      sendJson(response, 200, { name });
      return;
    case 'taken':
      sendJson(response, 409, { error: 'name_taken' });
      return;
    case 'dormant':
      sendJson(response, 409, { error: 'dormant_dynasty' });
      return;
    case 'poor':
      sendJson(response, 409, { error: 'insufficient_funds' });
      return;
    case 'invalid':
      sendJson(response, 400, { error: 'invalid_name' });
      return;
    case 'lost':
      sendJson(response, 404, { error: 'unknown_dynasty' });
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
