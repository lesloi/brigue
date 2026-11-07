import type { EngagementKind, GoodId, SeatId, TitleId, Trade } from './world.ts';

/**
 * Immutable domain vocabulary: what the player has to do, and what the world
 * did in return.
 *
 * A refusal is an event, never a throw. The server replays stored actions when it
 * catches a world up, and one poisoned action must not be able to stop the town.
 */

/**
 * Who may read an event. The town sees its own affairs; a house sees its ledger;
 * the court sees what is kept for it. A court event is never returned to a
 * house.
 */
export type Audience = 'town' | 'court' | { houseId: string };

export type Action =
  | { type: 'market.buy'; houseId: string; good: GoodId; units: number }
  | { type: 'market.sell'; houseId: string; good: GoodId; units: number }
  | { type: 'council.campaign'; houseId: string; seatId: SeatId }
  | { type: 'workshop.build'; houseId: string; trade: Trade }
  | { type: 'workshop.destroy'; houseId: string; workshopId: string }
  | { type: 'workshop.upgrade'; houseId: string; workshopId: string }
  | { type: 'house.buy_title'; houseId: string }
  | { type: 'house.upgrade_residence'; houseId: string }
  | { type: 'house.rename'; houseId: string; name: string };

export type RefusalReason =
  | 'unknown_action'
  | 'unknown_house'
  | 'dormant_house'
  | 'unknown_seat'
  | 'unknown_good'
  | 'invalid_quantity'
  | 'insufficient_funds'
  | 'insufficient_stock'
  | 'stock_full'
  | 'insufficient_favour'
  | 'unknown_workshop'
  | 'unknown_trade'
  | 'workshop_cap'
  | 'last_workshop'
  | 'level_cap'
  | 'title_open'
  | 'name_taken'
  | 'invalid_name'
  | 'site_in_progress'
  | 'no_next_title'
  | 'no_next_residence';

type EventBody =
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
  | { type: 'workshop.produced'; houseId: string; good: GoodId; units: number }
  | { type: 'workshop.overflow'; houseId: string; good: GoodId; refusedUnits: number }
  | { type: 'workshop.idle'; houseId: string; good: GoodId; input: GoodId; missingUnits: number }
  | { type: 'workshop.built'; houseId: string; workshopId: string; trade: Trade }
  | { type: 'workshop.destroyed'; houseId: string; workshopId: string; good: GoodId }
  | { type: 'workshop.upgraded'; houseId: string; workshopId: string; level: number }
  | { type: 'workshop.build_lost'; houseId: string; trade: Trade; paidCents: number }
  | { type: 'house.title_bought'; houseId: string; title: TitleId }
  | { type: 'house.title_received'; houseId: string; title: TitleId; dueAt: number; resolvedAt: number }
  | { type: 'house.residence_received'; houseId: string; level: number; dueAt: number; resolvedAt: number }
  | { type: 'house.renamed'; houseId: string; before: string; after: string }
  | { type: 'house.upkeep_paid'; houseId: string; amountCents: number }
  | { type: 'house.penniless'; houseId: string; shortfallCents: number }
  | { type: 'house.debt_repaid'; houseId: string; amountCents: number }
  | { type: 'council.campaigned'; houseId: string; seatId: SeatId; favourSpent: number; countsAt: number }
  | { type: 'engagement.opened'; engagementId: string; kind: EngagementKind; houseId: string; dueAt: number }
  | {
      type: 'engagement.resolved';
      engagementId: string;
      kind: EngagementKind;
      houseId: string;
      seatId?: SeatId;
      dueAt: number;
      /** The hour the town actually reached: equal to `dueAt` unless late. */
      resolvedAt: number;
    }
  | { type: 'council.scrutiny_held'; year: number; seats: SeatId[] }
  | {
      type: 'council.election_held';
      seatId: SeatId;
      winnerHouseId: string;
      votes: Record<string, number>;
    };

/** An event as a step builds it: the hour is stamped by `advance`. */
export type EventDraft = EventBody & { audience: Audience };

/** What one house may read of an hour: every event carries the hour it happened on. */
export type Event = EventDraft & { at: number };

/** What one house may read of an hour. The court has no reader yet. */
export function isVisibleTo(event: EventDraft, houseId: string): boolean {
  if (event.audience === 'town') {
    return true;
  }
  if (event.audience === 'court') {
    return false;
  }

  return event.audience.houseId === houseId;
}

export function visibleTo(events: readonly Event[], houseId: string): Event[] {
  return events.filter((event) => isVisibleTo(event, houseId));
}
