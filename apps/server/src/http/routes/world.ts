import type { IncomingMessage, ServerResponse } from 'node:http';

import { hashJson, PACING } from '@brigue/core';

import { advanceTown, catchUpTown, type TownAccess } from '../../town/catch-up.ts';
import { projectWorld } from '../../town/projection.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
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

  const bound = boundPlayerOf(context, player, response);

  if (bound === null) {
    return;
  }

  const outcome = await catchUpTown(townAccess(context), bound.townId, bound.dynastyId, at);

  if (outcome.kind === 'gone') {
    // The visit arrived after the dynasty was silent for a month: the world has
    // already deleted it and revoked the token. Clear the dead cookie so the
    // client can take the freed place.
    context.deps.logger.warn('world.session_expired', { townId: bound.townId, dynastyId: bound.dynastyId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  const caught = outcome.result;
  await context.deps.store.touch(bound.tokenHash, at);

  if (caught.skipped > 0) {
    context.deps.logger.warn('world.catch_up_capped', {
      townId: bound.townId,
      skipped: caught.skipped,
    });
  }
  context.deps.logger.info('world.read', {
    townId: bound.townId,
    dynastyId: bound.dynastyId,
    hour: caught.world.hour,
    hoursPlayed: caught.hours,
    skipped: caught.skipped,
  });

  const projection = projectWorld(outcome.town, caught.world, bound.dynastyId, caught.hourStartedAt);

  sendJson(response, 200, {
    world: projection,
    messages: outcome.messages,
    chronicle: outcome.chronicle,
    unreadMessages: outcome.unread,
    summary: {
      hours: caught.hours,
      skipped: caught.skipped,
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

  const bound = boundPlayerOf(context, player, response);

  if (bound === null) {
    return;
  }

  const outcome = await advanceTown(townAccess(context), bound.townId, bound.dynastyId, at, context.now);

  if (outcome.kind === 'gone') {
    context.deps.logger.warn('world.session_expired', { townId: bound.townId, dynastyId: bound.dynastyId });
    unauthorized(response, context.secureCookies, true);
    return;
  }

  const caught = outcome.result;
  await context.deps.store.touch(bound.tokenHash, at);

  context.deps.logger.info('world.advanced', {
    townId: bound.townId,
    dynastyId: bound.dynastyId,
    hour: caught.world.hour,
  });

  const projection = projectWorld(outcome.town, caught.world, bound.dynastyId, caught.hourStartedAt);

  sendJson(response, 200, {
    world: projection,
    messages: outcome.messages,
    chronicle: outcome.chronicle,
    unreadMessages: outcome.unread,
    summary: {
      hours: caught.hours,
      skipped: caught.skipped,
    },
    stateHash: hashJson(projection),
    deletionGraceDays: PACING.deletionGraceDays,
    dev: true,
  });
}

/**
 * The player deletes one of its messages. No trash and no tombstone: the row
 * goes, and an id from another box deletes nothing.
 */
export async function deleteMessage(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
  rawId: string,
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

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    sendJson(response, 404, { error: 'unknown_message' });
    return;
  }

  const result = await context.deps.worlds.deleteMessage(id, bound.dynastyId);

  sendJson(response, 200, { deleted: result.deleted, unreadMessages: result.unread });
}

/**
 * The player opened one message: it is marked read. The flag is the whole
 * unread state, and a message of another box is left alone.
 */
export async function markMessageRead(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
  rawId: string,
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

  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    sendJson(response, 404, { error: 'unknown_message' });
    return;
  }

  const result = await context.deps.worlds.markMessageRead(id, bound.dynastyId);

  sendJson(response, 200, { read: result.read, unreadMessages: result.unread });
}

function townAccess(context: AppContext): TownAccess {
  return { players: context.deps.store, worlds: context.deps.worlds, logger: context.deps.logger };
}
