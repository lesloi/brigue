import type { EngagementKind, GoodId, SeatId, TitleId, Trade } from './world.ts';

/**
 * Immutable domain vocabulary: what the player has to do, and what the world
 * did in return.
 *
 * A refusal is an event, never a throw. The server replays stored actions when it
 * catches a world up, and one poisoned action must not be able to stop the town.
 */

/**
 * Who may read an event. The town sees its own affairs; a dynasty sees its ledger;
 * the court sees what is kept for it. A court event is never returned to a
 * dynasty.
 */
export type Audience = 'town' | 'court' | { dynastyId: string };

export type Action =
  | { type: 'market.buy'; dynastyId: string; good: GoodId; units: number }
  | { type: 'market.sell'; dynastyId: string; good: GoodId; units: number }
  | { type: 'council.campaign'; dynastyId: string; seatId: SeatId }
  | { type: 'workshop.build'; dynastyId: string; trade: Trade }
  | { type: 'workshop.destroy'; dynastyId: string; workshopId: string }
  | { type: 'workshop.upgrade'; dynastyId: string; workshopId: string }
  | { type: 'dynasty.buy_title'; dynastyId: string }
  | { type: 'dynasty.upgrade_residence'; dynastyId: string };

export type RefusalReason =
  | 'unknown_action'
  | 'unknown_dynasty'
  | 'dormant_dynasty'
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
  | 'already_candidate'
  | 'no_next_title'
  | 'no_next_residence';

type EventBody =
  | {
      type: 'action.refused';
      action: Action['type'] | 'unknown';
      dynastyId: string;
      reason: RefusalReason;
    }
  | {
      type: 'market.bought';
      dynastyId: string;
      good: GoodId;
      units: number;
      priceCents: number;
      totalCents: number;
    }
  | { type: 'market.price_changed'; good: GoodId; before: number; after: number }
  | {
      type: 'market.sold';
      dynastyId: string;
      good: GoodId;
      units: number;
      priceCents: number;
      revenueCents: number;
    }
  | { type: 'workshop.produced'; dynastyId: string; good: GoodId; units: number }
  | { type: 'workshop.overflow'; dynastyId: string; good: GoodId; refusedUnits: number }
  | { type: 'workshop.idle'; dynastyId: string; good: GoodId; input: GoodId; missingUnits: number }
  | { type: 'workshop.built'; dynastyId: string; workshopId: string; trade: Trade }
  | { type: 'workshop.destroyed'; dynastyId: string; workshopId: string; good: GoodId }
  | { type: 'workshop.upgraded'; dynastyId: string; workshopId: string; level: number }
  | { type: 'workshop.build_lost'; dynastyId: string; trade: Trade; paidCents: number }
  | { type: 'dynasty.title_bought'; dynastyId: string; title: TitleId }
  | { type: 'dynasty.title_received'; dynastyId: string; title: TitleId; dueAt: number; resolvedAt: number }
  | { type: 'dynasty.residence_received'; dynastyId: string; level: number; dueAt: number; resolvedAt: number }
  | { type: 'dynasty.renamed'; dynastyId: string; before: string; after: string }
  | { type: 'dynasty.upkeep_paid'; dynastyId: string; amountCents: number }
  | { type: 'dynasty.penniless'; dynastyId: string; shortfallCents: number }
  | { type: 'dynasty.debt_repaid'; dynastyId: string; amountCents: number }
  | { type: 'council.campaigned'; dynastyId: string; seatId: SeatId; favourSpent: number; countsAt: number }
  | { type: 'engagement.opened'; engagementId: string; kind: EngagementKind; dynastyId: string; dueAt: number }
  | {
      type: 'engagement.resolved';
      engagementId: string;
      kind: EngagementKind;
      dynastyId: string;
      seatId?: SeatId;
      dueAt: number;
      /** The hour the town actually reached: equal to `dueAt` unless late. */
      resolvedAt: number;
    }
  | { type: 'council.scrutiny_held'; year: number; seats: SeatId[] }
  | {
      type: 'council.election_held';
      seatId: SeatId;
      /** Null when the seat is left vacant: nobody stood. */
      winnerDynastyId: string | null;
      votes: Record<string, number>;
    }
  | {
      type: 'council.election_result';
      /** The candidate this result is addressed to. */
      dynastyId: string;
      seatId: SeatId;
      won: boolean;
      winnerDynastyId: string;
      votes: Record<string, number>;
    };

/** An event as a step builds it: the hour is stamped by `advance`. */
export type EventDraft = EventBody & { audience: Audience };

/** What one dynasty may read of an hour: every event carries the hour it happened on. */
export type Event = EventDraft & { at: number };

/** What one dynasty may read of an hour. The court has no reader yet. */
export function isVisibleTo(event: EventDraft, dynastyId: string): boolean {
  if (event.audience === 'town') {
    return true;
  }
  if (event.audience === 'court') {
    return false;
  }

  return event.audience.dynastyId === dynastyId;
}

export function visibleTo(events: readonly Event[], dynastyId: string): Event[] {
  return events.filter((event) => isVisibleTo(event, dynastyId));
}
