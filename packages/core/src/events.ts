import type { GoodId, PersonId, SeatId, TitleId, Trade } from './world.ts';

/**
 * Immutable domain vocabulary: what the player has to do, and what the world
 * did in return.
 *
 * A refusal is an event, never a throw. The server replays stored actions when it
 * catches a world up, and one poisoned action must not be able to stop the town.
 */

/**
 * Who may read an event. The town sees its own affairs; a person sees its ledger;
 * the court sees what is kept for it. A court event is never returned to a person.
 */
export type Audience = 'town' | 'court' | { personId: PersonId };

export type Action =
  | { type: 'market.buy'; personId: PersonId; good: GoodId; units: number }
  | { type: 'market.sell'; personId: PersonId; good: GoodId; units: number }
  | { type: 'council.campaign'; personId: PersonId; seatId: SeatId }
  | { type: 'workshop.build'; personId: PersonId; trade: Trade }
  | { type: 'workshop.destroy'; personId: PersonId; workshopId: number }
  | { type: 'workshop.upgrade'; personId: PersonId; workshopId: number }
  | { type: 'person.buy_title'; personId: PersonId }
  | { type: 'person.upgrade_residence'; personId: PersonId };

export type RefusalReason =
  | 'unknown_action'
  | 'unknown_person'
  | 'dormant_person'
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
  | 'already_candidate'
  | 'no_next_title'
  | 'no_next_residence';

type EventBody =
  | {
      type: 'action.refused';
      action: Action['type'] | 'unknown';
      personId: PersonId;
      reason: RefusalReason;
    }
  | {
      type: 'market.bought';
      personId: PersonId;
      good: GoodId;
      units: number;
      priceCents: number;
      totalCents: number;
    }
  | { type: 'market.price_changed'; good: GoodId; before: number; after: number }
  | {
      type: 'market.sold';
      personId: PersonId;
      good: GoodId;
      units: number;
      priceCents: number;
      revenueCents: number;
    }
  | { type: 'workshop.produced'; personId: PersonId; good: GoodId; units: number }
  | { type: 'workshop.idle'; personId: PersonId; good: GoodId; input: GoodId; missingUnits: number }
  | { type: 'workshop.built'; personId: PersonId; workshopId: number; trade: Trade }
  | { type: 'workshop.destroyed'; personId: PersonId; workshopId: number; good: GoodId }
  | { type: 'workshop.upgraded'; personId: PersonId; workshopId: number; level: number }
  | { type: 'person.title_bought'; personId: PersonId; title: TitleId }
  | { type: 'person.residence_bought'; personId: PersonId; level: number }
  | { type: 'person.upkeep_paid'; personId: PersonId; amountCents: number }
  | { type: 'person.penniless'; personId: PersonId; shortfallCents: number }
  | { type: 'person.debt_repaid'; personId: PersonId; amountCents: number }
  | { type: 'council.campaigned'; personId: PersonId; seatId: SeatId; favourSpent: number; countsAt: number }
  | { type: 'council.scrutiny_held'; year: number; seats: SeatId[] }
  | {
      type: 'council.election_held';
      seatId: SeatId;
      /** Null when the seat is left vacant: nobody stood. */
      winnerPersonId: PersonId | null;
      votes: Record<PersonId, number>;
    }
  | {
      type: 'council.election_result';
      /** The candidate this result is addressed to. */
      personId: PersonId;
      seatId: SeatId;
      won: boolean;
      winnerPersonId: PersonId;
      votes: Record<PersonId, number>;
    };

/**
 * Every event type, in a fixed order. The code of a type is its one-based place
 * in this list, and it is what the journal rows carry: the list may grow, but a
 * place already written is never renumbered.
 */
export const EVENT_TYPES = [
  'action.refused',
  'market.bought',
  'market.price_changed',
  'market.sold',
  'workshop.produced',
  'workshop.idle',
  'workshop.built',
  'workshop.destroyed',
  'workshop.upgraded',
  'person.title_bought',
  'person.residence_bought',
  'person.upkeep_paid',
  'person.penniless',
  'person.debt_repaid',
  'council.campaigned',
  'council.scrutiny_held',
  'council.election_held',
  'council.election_result',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function eventTypeCode(type: EventType): number {
  const code = EVENT_TYPES.indexOf(type) + 1;

  // A type the list does not know cannot be written: a zero row would be
  // unreadable, and the journal reads only codes the list holds.
  if (code === 0) {
    throw new Error(`the event type "${type}" is not in EVENT_TYPES`);
  }

  return code;
}

export function eventTypeOfCode(code: number): EventType | undefined {
  return EVENT_TYPES[code - 1];
}

/** An event as a step builds it: the hour is stamped by `advance`. */
export type EventDraft = EventBody & { audience: Audience };

/** What one person may read of an hour: every event carries the hour it happened on. */
export type Event = EventDraft & { at: number };

/** What one person may read of an hour. The court has no reader yet. */
export function isVisibleTo(event: EventDraft, personId: PersonId): boolean {
  if (event.audience === 'town') {
    return true;
  }
  if (event.audience === 'court') {
    return false;
  }

  return event.audience.personId === personId;
}

export function visibleTo(events: readonly Event[], personId: PersonId): Event[] {
  return events.filter((event) => isVisibleTo(event, personId));
}
