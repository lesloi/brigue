import type { GoodId, SeatId } from './world.ts';

/**
 * Immutable domain vocabulary: what the player has to do, and what the world
 * did in return. Everything the client renders comes from events, and every
 * action goes through here, so replaying a week never needs the HTTP layer.
 */
export type Action =
  | { type: 'market.buy'; houseId: string; good: GoodId; units: number }
  | { type: 'council.campaign'; houseId: string; seatId: SeatId };

export type Event =
  | { type: 'market.bought'; houseId: string; good: GoodId; units: number; priceCents: number; totalCents: number }
  | { type: 'market.price_changed'; good: GoodId; before: number; after: number }
  | { type: 'market.sold'; houseId: string; good: GoodId; units: number; priceCents: number; revenueCents: number }
  | { type: 'house.wages_paid'; houseId: string; amountCents: number }
  | { type: 'house.penniless'; houseId: string; shortfallCents: number }
  | { type: 'council.campaigned'; houseId: string; seatId: SeatId; favourSpent: number }
  | { type: 'council.election_held'; seatId: SeatId; winnerHouseId: string; votes: Record<string, number> };
