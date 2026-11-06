import type { IncomingMessage, ServerResponse } from 'node:http';

import { PACING } from '@brigue/core';

import { closingOf } from '../../identity/players.ts';
import { identifiedBy, type AppContext } from '../context.ts';
import { sendJson, unauthorized } from '../respond.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The player asks to delete their identity. The request is scheduled, not
 * immediate: the token stays valid so they can come back, and the scheduler
 * erases the house, its queue and the row at the deadline. A second request
 * keeps the first deadline.
 */
export async function requestDeletion(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  const at = new Date(context.now());
  const closing = closingOf(player, at);

  if (closing.kind === 'due') {
    unauthorized(response, context.secureCookies, true);
    return;
  }

  const after = closing.kind === 'pending' ? closing.after : new Date(at.getTime() + PACING.deletionGraceDays * DAY_MS);

  if (closing.kind === 'none') {
    await context.deps.store.markDeletion(player.tokenHash, after);
    context.deps.logger.info('player.deletion_scheduled', {
      townId: player.townId,
      houseId: player.houseId,
      deleteAfter: after.toISOString(),
    });
  }

  sendJson(response, 200, { deleteAfter: after.toISOString() });
}

/** The player comes back before the deadline: the scheduled erasure is off. */
export async function cancelDeletion(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  const closing = closingOf(player, new Date(context.now()));

  if (closing.kind === 'due') {
    unauthorized(response, context.secureCookies, true);
    return;
  }

  if (closing.kind === 'pending') {
    await context.deps.store.cancelDeletion(player.tokenHash);
    context.deps.logger.info('player.deletion_cancelled', { townId: player.townId, houseId: player.houseId });
  }

  response.writeHead(204, { 'Cache-Control': 'no-store' });
  response.end();
}
