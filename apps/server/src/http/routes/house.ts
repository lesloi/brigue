import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidName, nameIsTaken, RULES, renameHouse, type EventDraft } from '@brigue/core';

import { sessionWorld } from '../../town/worlds.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readBody, sendJson } from '../respond.ts';

/**
 * The house's name, changed at once rather than queued.
 *
 * A name is identity, not trade: the player who pays for it should not read the
 * old one until the next hour, and a queued rename would reserve a name for an
 * hour in front of every other house. The route runs under the world's own lock
 * — the same one the scheduler takes — and writes the town in that session, so
 * no tick can land between the check and the write.
 *
 * The name's rules are the core's: two names that differ by case or by accent
 * are one name, and a name another house carries is refused with 409. The
 * database compares bytes, so the read of the houses is the check that counts.
 */
export async function renameHouseRoute(
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
  if (name === null) {
    sendJson(response, 400, { error: 'invalid_name' });
    return;
  }

  const outcome = await context.deps.worlds.withWorld(async (session) => {
    const { world, hourStartedAt } = session.snapshot;
    sessionWorld(session);

    const house = world.houses[bound.houseId];
    if (house === undefined) {
      return { kind: 'lost' as const };
    }
    if (house.dormant) {
      return { kind: 'dormant' as const };
    }
    if (nameIsTaken(world, name, house.id)) {
      return { kind: 'taken' as const };
    }
    if (house.treasuryCents < RULES.renameCents) {
      return { kind: 'poor' as const };
    }

    const next = structuredClone(world);
    const renamed = next.houses[house.id];
    if (renamed === undefined) {
      return { kind: 'lost' as const };
    }

    renamed.treasuryCents -= RULES.renameCents;
    const events: EventDraft[] = [];
    renameHouse(next, renamed, name, events);

    await session.save(
      next,
      hourStartedAt,
      events.map((event) => ({ ...event, at: world.hour })),
    );

    return { kind: 'renamed' as const, name };
  }, bound.townId);

  switch (outcome.kind) {
    case 'renamed':
      context.deps.logger.info('house.renamed', { townId: bound.townId, houseId: bound.houseId });
      sendJson(response, 200, { name: outcome.name });
      return;
    case 'taken':
      sendJson(response, 409, { error: 'name_taken' });
      return;
    case 'dormant':
      sendJson(response, 409, { error: 'dormant_house' });
      return;
    case 'poor':
      sendJson(response, 409, { error: 'insufficient_funds' });
      return;
    case 'lost':
      sendJson(response, 404, { error: 'unknown_house' });
  }
}

/** The only field a rename carries: a string, or nothing to rename. */
function readName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const name = (body as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return null;
  }

  const trimmed = name.trim();

  return isValidName(trimmed) ? trimmed : null;
}
