import { SEATS, type Action, type GoodId, type SeatId } from '@brigue/core';

/** An action as the client may send it: the house always comes from the session. */
export type ActionIntent =
  { type: 'market.buy'; good: GoodId; units: number } | { type: 'council.campaign'; seatId: SeatId };

export type ActionSubmission =
  { ok: true; id: string; week: number; intent: ActionIntent } | { ok: false; error: 'invalid_action' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOODS: readonly GoodId[] = ['cloth', 'wool', 'grain'];

export function parseActionSubmission(body: unknown): ActionSubmission {
  if (!isRecord(body)) {
    return invalid();
  }

  const { id, week, action } = body;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    return invalid();
  }
  if (!Number.isInteger(week) || (week as number) < 1) {
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
        id: id.toLowerCase(),
        week: week as number,
        intent: { type: 'market.buy', good: good as GoodId, units: units as number },
      };
    }

    case 'council.campaign': {
      const { seatId } = action;
      if (typeof seatId !== 'string' || !SEATS.includes(seatId as SeatId)) {
        return invalid();
      }

      return {
        ok: true,
        id: id.toLowerCase(),
        week: week as number,
        intent: { type: 'council.campaign', seatId: seatId as SeatId },
      };
    }

    default:
      return invalid();
  }
}

/**
 * The only place a client-supplied action meets a house: the house is written
 * last, so a `houseId` smuggled into the body never survives into the world.
 */
export function withHouse(intent: ActionIntent, houseId: string): Action {
  return { ...intent, houseId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): ActionSubmission {
  return { ok: false, error: 'invalid_action' };
}
