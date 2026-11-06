import type { IncomingMessage, ServerResponse } from 'node:http';

import { hashJson, PACING } from '@brigue/core';

import { advanceTown, catchUpTown, type TownAccess } from '../../town/catch-up.ts';
import { projectWorld } from '../../town/projection.ts';
import { identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { sendJson, unauthorized } from '../respond.ts';

export async function readWorld(
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

  const outcome = await catchUpTown(townAccess(context), player.townId, player.houseId, player.cursorEventId ?? 0, at);

  if (outcome.kind === 'gone') {
    // The visit arrived after the house was silent for a month: the world has
    // already deleted it and revoked the token. Clear the dead cookie so the
    // client can take the freed place.
    context.deps.logger.warn('world.session_expired', { townId: player.townId, houseId: player.houseId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  const caught = outcome.result;
  await context.deps.store.touch(player.tokenHash, at);

  if (caught.skipped > 0) {
    context.deps.logger.warn('world.catch_up_capped', {
      townId: player.townId,
      skipped: caught.skipped,
    });
  }
  context.deps.logger.info('world.read', {
    townId: player.townId,
    houseId: player.houseId,
    hour: caught.world.hour,
    hoursPlayed: caught.hours,
    skipped: caught.skipped,
  });

  const projection = projectWorld(outcome.town, caught.world, player.houseId, caught.hourStartedAt);
  await context.deps.store.advanceCursor(player.tokenHash, outcome.journal.lastId);

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
    // A pacing rule, not town state: the screen says how long a deletion
    // waits without deciding it.
    deletionGraceDays: PACING.deletionGraceDays,
    // Outside the projection on purpose: the hash must not depend on how a
    // deployment was started.
    ...(context.deps.devAdvance === true ? { dev: true } : {}),
  });
}

/**
 * Local development only: plays the next hour now instead of waiting for the
 * hour to pass. The world clock jumps, the wall clock does not.
 */
export async function advanceHour(
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

  const outcome = await advanceTown(
    townAccess(context),
    player.townId,
    player.houseId,
    player.cursorEventId ?? 0,
    at,
    context.now,
  );

  if (outcome.kind === 'gone') {
    context.deps.logger.warn('world.session_expired', { townId: player.townId, houseId: player.houseId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  const caught = outcome.result;
  await context.deps.store.touch(player.tokenHash, at);

  context.deps.logger.info('world.advanced', {
    townId: player.townId,
    houseId: player.houseId,
    hour: caught.world.hour,
  });

  const projection = projectWorld(outcome.town, caught.world, player.houseId, caught.hourStartedAt);
  await context.deps.store.advanceCursor(player.tokenHash, outcome.journal.lastId);

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
    deletionGraceDays: PACING.deletionGraceDays,
    dev: true,
  });
}

function townAccess(context: AppContext): TownAccess {
  return { players: context.deps.store, worlds: context.deps.worlds, logger: context.deps.logger };
}
