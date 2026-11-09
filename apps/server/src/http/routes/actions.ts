import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  GOODS,
  nextTitle,
  SEATS,
  titleOf,
  TRADES,
  type Action,
  type GoodId,
  type SeatId,
  type Trade,
} from '@brigue/core';

import { currentHourOf, sessionWorld, type NewStoredAction, type StoredAction } from '../../town/worlds.ts';
import { boundPlayerOf, identifiedBy, refuseClosing, type AppContext } from '../context.ts';
import { readBody, sendJson } from '../respond.ts';

/**
 * The action may target the hour being played, or the next one when an hour
 * boundary fell between the client's read and its POST. Further ahead is a
 * client clock that cannot be reconciled with this town.
 */
const QUEUE_AHEAD_HOURS = 1;

/** An action as the client may send it: the person always comes from the session. */
type ActionIntent =
  | { type: 'market.buy'; good: GoodId; units: number }
  | { type: 'market.sell'; good: GoodId; units: number }
  | { type: 'council.campaign'; seatId: SeatId }
  | { type: 'workshop.build'; trade: Trade }
  | { type: 'workshop.destroy'; workshopId: number }
  | { type: 'workshop.upgrade'; workshopId: number }
  | { type: 'person.buy_title' }
  | { type: 'person.upgrade_residence' };

type ActionSubmission = { ok: true; hour: number; intent: ActionIntent } | { ok: false; error: 'invalid_action' };

type ActionOutcome =
  | { kind: 'stale'; currentHour: number }
  | { kind: 'future'; currentHour: number }
  | { kind: 'appended'; stored: StoredAction };

export async function listActions(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  if (refuseClosing(context, player, response, new Date(context.now()))) {
    return;
  }

  const bound = boundPlayerOf(context, player, response);

  if (bound === null) {
    return;
  }

  const actions = await context.deps.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);
    const queued: StoredAction[] = [];

    queued.push(...(await session.actionsBetween(world.hour, world.hour + QUEUE_AHEAD_HOURS)));

    return queued.filter((action) => action.personId === bound.personId);
  }, bound.townId);

  sendJson(response, 200, { actions: actions.map(pendingView) });
}

export async function cancelAction(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
): Promise<void> {
  const player = await identifiedBy(context, request, response);

  if (player === null) {
    return;
  }

  const at = new Date(context.now());

  if (refuseClosing(context, player, response, at)) {
    return;
  }
  const actionId = Number(id);
  if (!Number.isInteger(actionId) || actionId <= 0) {
    sendJson(response, 404, { error: 'unknown_action' });
    return;
  }

  const bound = boundPlayerOf(context, player, response);

  if (bound === null) {
    return;
  }

  const outcome = await context.deps.worlds.withWorld(async (session) => {
    const { world, hourStartedAt } = session.snapshot;
    sessionWorld(session);

    const stored = await session.findAction(actionId);
    // Another person's action is indistinguishable from an unknown one.
    if (stored === null || stored.personId !== bound.personId) {
      return { kind: 'unknown' as const };
    }
    if (stored.playsAt < world.hour) {
      return { kind: 'stale' as const, currentHour: currentHourOf(world, hourStartedAt, at) };
    }

    const currentHour = currentHourOf(world, hourStartedAt, at);
    if (stored.playsAt > currentHour + QUEUE_AHEAD_HOURS) {
      return { kind: 'future' as const, currentHour };
    }

    await session.cancel(actionId);

    return { kind: 'cancelled' as const };
  }, bound.townId);

  switch (outcome.kind) {
    case 'unknown':
      sendJson(response, 404, { error: 'unknown_action' });
      return;
    case 'stale':
      sendJson(response, 409, { error: 'stale_hour', currentHour: outcome.currentHour });
      return;
    case 'future':
      sendJson(response, 409, { error: 'future_hour', currentHour: outcome.currentHour });
      return;
    case 'cancelled':
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
  }
}

export async function appendAction(
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

  const submission = parseActionSubmission(read.body);
  if (!submission.ok) {
    sendJson(response, 400, { error: submission.error });
    return;
  }

  const outcome: ActionOutcome = await context.deps.worlds.withWorld(async (session) => {
    sessionWorld(session);
    const { world, hourStartedAt } = session.snapshot;

    // The action names a hour, not a person: the person is the session's.
    // A hour that already ticked can never be replayed, and the town clock
    // is the upper bound for a hour that has not begun yet.
    const currentHour = currentHourOf(world, hourStartedAt, at);

    if (submission.hour < world.hour) {
      return { kind: 'stale' as const, currentHour };
    }
    if (submission.hour > currentHour + QUEUE_AHEAD_HOURS) {
      return { kind: 'future' as const, currentHour };
    }
    const person = world.people[bound.personId];
    const toStore: NewStoredAction = {
      personId: bound.personId,
      playsAt: submission.hour,
      action: withPerson(submission.intent, bound.personId),
      receivedAt: at,
      // The degree is named when the order is taken, from the person as they
      // are then, so no later purchase changes what this line says.
      ...(submission.intent.type === 'person.buy_title' && person !== undefined
        ? { title: nextTitle(titleOf(person)) }
        : {}),
    };
    const stored = await session.append(toStore);

    return { kind: 'appended' as const, stored };
  }, bound.townId);

  switch (outcome.kind) {
    case 'stale':
      sendJson(response, 409, { error: 'stale_hour', currentHour: outcome.currentHour });
      return;
    case 'future':
      sendJson(response, 409, { error: 'future_hour', currentHour: outcome.currentHour });
      return;
    case 'appended':
      context.deps.logger.info('action.appended', {
        townId: bound.townId,
        personId: bound.personId,
        hour: outcome.stored.playsAt,
        action: outcome.stored.action.type,
      });
      sendJson(response, 201, {
        id: outcome.stored.id,
        hour: outcome.stored.playsAt,
        personId: outcome.stored.personId,
      });
  }
}

function pendingView(stored: StoredAction): Record<string, unknown> {
  const action = stored.action;

  return {
    id: stored.id,
    hour: stored.playsAt,
    type: action.type,
    ...(action.type === 'market.buy' || action.type === 'market.sell'
      ? { good: action.good, units: action.units }
      : {}),
    ...(action.type === 'council.campaign' ? { seatId: action.seatId } : {}),
    ...(action.type === 'workshop.build' ? { trade: action.trade } : {}),
    ...(action.type === 'person.buy_title' && stored.title !== undefined ? { title: stored.title } : {}),
    ...(action.type === 'workshop.destroy' || action.type === 'workshop.upgrade'
      ? { workshopId: action.workshopId }
      : {}),
  };
}

function parseActionSubmission(body: unknown): ActionSubmission {
  if (!isRecord(body)) {
    return invalid();
  }

  const { hour, action } = body;
  if (!Number.isInteger(hour) || (hour as number) < 1) {
    return invalid();
  }
  if (!isRecord(action)) {
    return invalid();
  }

  switch (action.type) {
    case 'market.buy': {
      const { good, units } = action;
      if (typeof good !== 'string' || !GOODS.includes(good as GoodId)) {
        return invalid();
      }
      if (!Number.isInteger(units) || (units as number) <= 0) {
        return invalid();
      }

      return {
        ok: true,
        hour: hour as number,
        intent: { type: 'market.buy', good: good as GoodId, units: units as number },
      };
    }

    case 'market.sell': {
      const { good, units } = action;
      if (typeof good !== 'string' || !GOODS.includes(good as GoodId)) {
        return invalid();
      }
      if (!Number.isInteger(units) || (units as number) <= 0) {
        return invalid();
      }

      return {
        ok: true,
        hour: hour as number,
        intent: { type: 'market.sell', good: good as GoodId, units: units as number },
      };
    }

    case 'council.campaign': {
      const { seatId } = action;
      if (typeof seatId !== 'string' || !SEATS.includes(seatId as SeatId)) {
        return invalid();
      }

      return {
        ok: true,
        hour: hour as number,
        intent: { type: 'council.campaign', seatId: seatId as SeatId },
      };
    }

    case 'workshop.build': {
      const { trade } = action;
      if (typeof trade !== 'string' || !TRADES.includes(trade as Trade)) {
        return invalid();
      }

      return {
        ok: true,
        hour: hour as number,
        intent: { type: 'workshop.build', trade: trade as Trade },
      };
    }

    case 'workshop.destroy':
    case 'workshop.upgrade': {
      const { workshopId } = action;
      if (!Number.isInteger(workshopId) || (workshopId as number) <= 0) {
        return invalid();
      }

      return {
        ok: true,
        hour: hour as number,
        intent: { type: action.type, workshopId: workshopId as number },
      };
    }

    case 'person.buy_title':
    case 'person.upgrade_residence':
      return { ok: true, hour: hour as number, intent: { type: action.type } };

    default:
      return invalid();
  }
}

/**
 * The only place a client-supplied action meets a person: the person is written
 * last, so a `personId` smuggled into the body never survives into the world.
 */
function withPerson(intent: ActionIntent, personId: number): Action {
  return { ...intent, personId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): ActionSubmission {
  return { ok: false, error: 'invalid_action' };
}
