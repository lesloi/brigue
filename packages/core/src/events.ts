import type { GoodId, SeatId } from './world.ts';

/**
 * Immutable domain vocabulary: what the player has to do, and what the world
 * did in return.
 *
 * A refusal is an event, never a throw. The server replays stored actions when it
 * catches a world up, and one poisoned action must not be able to stop the town.
 */
export type Action =
  | { type: 'market.buy'; houseId: string; good: GoodId; units: number }
  | { type: 'council.campaign'; houseId: string; seatId: SeatId };

export type RefusalReason =
  | 'unknown_action'
  | 'unknown_house'
  | 'unknown_seat'
  | 'invalid_quantity'
  | 'insufficient_funds'
  | 'insufficient_favour';

export type Event =
  | {
      type: 'action.refused';
      action: Action['type'] | 'unknown';
      houseId: string;
      reason: RefusalReason;
    }
  | {
      type: 'market.bought';
      houseId: string;
      good: GoodId;
      units: number;
      priceCents: number;
      totalCents: number;
    }
  | { type: 'market.price_changed'; good: GoodId; before: number; after: number }
  | {
      type: 'market.sold';
      houseId: string;
      good: GoodId;
      units: number;
      priceCents: number;
      revenueCents: number;
    }
  | { type: 'workshop.idle'; houseId: string; good: GoodId; input: GoodId; missingUnits: number }
  | { type: 'house.wages_paid'; houseId: string; amountCents: number }
  | { type: 'house.penniless'; houseId: string; shortfallCents: number }
  | { type: 'house.debt_repaid'; houseId: string; amountCents: number }
  | { type: 'council.campaigned'; houseId: string; seatId: SeatId; favourSpent: number }
  | {
      type: 'council.election_held';
      seatId: SeatId;
      winnerHouseId: string;
      votes: Record<string, number>;
    };
