/**
 * The world is the whole game. It is plain data, it is serialisable, and it is
 * never mutated by a tick: the simulation hands back a new one.
 *
 * Money is always integer cents. There is no float anywhere in this file, and
 * there must never be: an economy that drifts by a hundredth per tick cannot be
 * replayed or audited.
 */

export type GoodId = 'cloth' | 'wool' | 'grain';
export type SeatId = 'maire' | 'prevot' | 'echevin-north' | 'echevin-south' | 'tresorier';

/** Seats in the order they come up for election, and the order screens show them. */
export const SEATS: readonly SeatId[] = ['maire', 'prevot', 'echevin-north', 'echevin-south', 'tresorier'];

/** AI or HUMAN. The simulation does not care which: only who controls decides. */
export type Controller = 'ai' | 'human';

/** The attributes a person raises by use. */
export interface Attributes {
  artisanat: number;
  parole: number;
  intrigue: number;
}

export interface Workshop {
  good: GoodId;
  level: number;
  workers: number;
}

export interface House {
  id: string;
  name: string;
  controller: Controller;
  treasuryCents: number;
  /** Unpaid wages. The design says a debt follows the house; this is where it lives. */
  debtCents: number;
  favour: number;
  prestige: number;
  /**
   * The highest council floor the house has reached. A mandate raises it, the
   * heir keeps it one floor lower (#7), and the gate of #55 reads it.
   */
  career: number;
  /**
   * Written by the server from the players table. The core never asks who
   * controls the house: a dormant house keeps its money, its seat and its
   * grudges, but nothing runs and it votes nowhere.
   */
  dormant: boolean;
  workshops: Workshop[];
  stock: Partial<Record<GoodId, number>>;
}

/**
 * A person belongs to a house and holds at most one office. The attributes are
 * theirs and die with them; the house keeps the career.
 */
export interface Person {
  id: string;
  houseId: string;
  name: string;
  age: number;
  attributes: Attributes;
  alive: boolean;
}

/** A seat points at a person of its own house, or at nobody. */
export interface Seat {
  personId: string | null;
}

export interface Law {
  id: string;
  title: string;
  sponsorHouseId: string;
  enactedWeek: number;
}

export interface World {
  /** Stamped so a saved world can be refused rather than silently misread. */
  formatVersion: number;
  /** The ruleset that produced this world. A catch-up across versions is a bug. */
  rulesetVersion: number;
  seed: number;
  rng: number;
  week: number;
  year: number;
  houses: Record<string, House>;
  people: Record<string, Person>;
  seats: Record<SeatId, Seat>;
  laws: Law[];
  market: Record<GoodId, number>;
  /**
   * What the town put on the market last week, per good: units sold minus units
   * bought. It is what moves the prices of the week that follows, so it is
   * stored rather than recomputed: the price you see is the town you were.
   */
  marketFlow: Partial<Record<GoodId, number>>;
  /** Votes bought per seat, per house, cleared when that seat is elected. */
  campaigns: Partial<Record<SeatId, Record<string, number>>>;
}

export const FORMAT_VERSION = 2;

export const RULES = {
  version: 5,
  /**
   * Eight weeks is one seat contested every eight hours and a mandate of about forty hours.
   * Four weeks made it every four hours: a ceremony that fires while the player sleeps, and
   * a clock that rewards being awake over playing well.
   */
  electionPeriodWeeks: 8,
  priceFloorCents: 100,
  priceCeilCents: 5000,
  priceDriftCents: 30,
  /**
   * A good's price is pulled by three things every week: its own random drift,
   * the town's imbalance on that good, and the gap back to its reference.
   *
   * `absorbedUnits` is the town's standing demand at the reference price: the
   * volume it takes every week whether or not anyone makes the good. Where that
   * demand is nil, a good nobody touches sits on its reference; where it is not,
   * a good nobody makes climbs. `scaleUnits` is the imbalance that moves the
   * price by a tenth of it (`pricePressureDivisor`); `priceReversionDivisor` is
   * how many weeks the gap back to the reference takes to close. Wool has no
   * absorption because what is made of it is bought by the workshops, which
   * shows up as demand, not as the town's own trade.
   */
  market: {
    cloth: { referenceCents: 1240, absorbedUnits: 10, scaleUnits: 10 },
    wool: { referenceCents: 380, absorbedUnits: 0, scaleUnits: 4 },
    grain: { referenceCents: 260, absorbedUnits: 4, scaleUnits: 4 },
  } satisfies Record<GoodId, { referenceCents: number; absorbedUnits: number; scaleUnits: number }>,
  pricePressureDivisor: 10,
  priceReversionDivisor: 4,
  outputPerLevel: 2,
  wagePerWorkerCents: 120,
  campaignFavourCost: 5,
  campaignVoteBonus: 2,
  /**
   * What a workshop eats per unit it makes; wool and grain come out of nothing.
   * A recipe is a rule, not content: changing one changes the economy, so it
   * lives here and moves the version with everything else.
   */
  recipes: {
    cloth: { input: 'wool', perUnit: 1 },
    wool: null,
    grain: null,
  } satisfies Record<GoodId, { input: GoodId; perUnit: number } | null>,
} as const;

/**
 * Wall-clock policy, not a simulation rule: how long a week lasts, how far a
 * returning player is caught up, and when a house stops being played. Read by
 * the server; changing it must not refuse an existing world.
 */
export const PACING = {
  minutesPerWeek: 60,
  // A month is 720 hours; 744 covers any calendar month. Beyond that, a read
  // simulates the cap and lets the wall clock jump over the rest rather than
  // replaying an unbounded backlog.
  maxCatchUpWeeks: 744,
  // A week without a visit is enough to say the player has stopped playing;
  // the house goes dormant and stops producing. Calibration, not a rule.
  dormancyDays: 7,
  // After a month without a visit the house is gone with its tokens: no return,
  // no vacation mode. The boundary is strict, so exactly thirty days still
  // reads and the next read deletes.
  deletionDays: 30,
} as const;

export const START_YEAR = 1401;
export const WEEKS_PER_YEAR = 52;

export interface Founder {
  house: House;
  person: Person;
}

/**
 * The house a new player starts with: a loom, a little money, no seat and no
 * career. `createWorld` opens with it, and the server puts it back into a freed
 * place so a deleted founder cannot brick the join path.
 */
export function createFounder(): Founder {
  return {
    house: {
      id: 'brigue',
      name: 'Brigue',
      controller: 'human',
      treasuryCents: 117340,
      debtCents: 0,
      favour: 50,
      prestige: 50,
      career: 0,
      dormant: false,
      workshops: [{ good: 'cloth', level: 2, workers: 2 }],
      stock: { wool: 8 },
    },
    person: {
      id: 'person-brigue',
      houseId: 'brigue',
      name: 'Colin Brigue',
      age: 20,
      attributes: { artisanat: 10, parole: 10, intrigue: 10 },
      alive: true,
    },
  };
}

export type SeatRefusal = 'unknown_house' | 'unknown_person' | 'person_of_another_house' | 'person_dead';

export type SeatAttempt = { ok: true; seat: Seat } | { ok: false; reason: SeatRefusal };

/**
 * The only way a seat is given: it takes a living person of the house that won
 * it. The check lives here so no caller can seat another house's person.
 */
export function takeSeat(world: World, houseId: string, personId: string): SeatAttempt {
  if (world.houses[houseId] === undefined) {
    return { ok: false, reason: 'unknown_house' };
  }

  const person = world.people[personId];
  if (person === undefined) {
    return { ok: false, reason: 'unknown_person' };
  }
  if (person.houseId !== houseId) {
    return { ok: false, reason: 'person_of_another_house' };
  }
  if (!person.alive) {
    return { ok: false, reason: 'person_dead' };
  }

  return { ok: true, seat: { personId } };
}

/** The person on a seat, or undefined when the seat is vacant. */
export function seatHolder(world: World, seatId: SeatId): Person | undefined {
  const personId = world.seats[seatId].personId;

  return personId === null ? undefined : world.people[personId];
}

export function createWorld(seed: number): World {
  const founder = createFounder();

  return {
    formatVersion: FORMAT_VERSION,
    rulesetVersion: RULES.version,
    seed,
    rng: seed,
    week: 1,
    year: START_YEAR,
    houses: {
      [founder.house.id]: founder.house,
      caron: {
        id: 'caron',
        name: 'Caron',
        controller: 'ai',
        treasuryCents: 240000,
        debtCents: 0,
        favour: 60,
        prestige: 65,
        career: 0,
        dormant: false,
        workshops: [{ good: 'cloth', level: 3, workers: 3 }],
        stock: { wool: 40 },
      },
      vandermeersch: {
        id: 'vandermeersch',
        name: 'Vandermeersch',
        controller: 'ai',
        treasuryCents: 180000,
        debtCents: 0,
        favour: 70,
        prestige: 58,
        career: 0,
        dormant: false,
        workshops: [{ good: 'wool', level: 2, workers: 1 }],
        stock: {},
      },
      herse: {
        id: 'herse',
        name: 'de Herse',
        controller: 'ai',
        treasuryCents: 150000,
        debtCents: 0,
        favour: 40,
        prestige: 45,
        career: 0,
        dormant: false,
        workshops: [{ good: 'grain', level: 2, workers: 2 }],
        stock: {},
      },
    },
    people: {
      [founder.person.id]: founder.person,
      'person-caron': {
        id: 'person-caron',
        houseId: 'caron',
        name: 'Robert Caron',
        age: 44,
        attributes: { artisanat: 10, parole: 10, intrigue: 10 },
        alive: true,
      },
      'person-vandermeersch': {
        id: 'person-vandermeersch',
        houseId: 'vandermeersch',
        name: 'Gilles Vandermeersch',
        age: 38,
        attributes: { artisanat: 10, parole: 10, intrigue: 10 },
        alive: true,
      },
      'person-herse': {
        id: 'person-herse',
        houseId: 'herse',
        name: 'Agnès de Herse',
        age: 57,
        attributes: { artisanat: 10, parole: 10, intrigue: 10 },
        alive: true,
      },
    },
    seats: {
      maire: { personId: null },
      prevot: { personId: null },
      'echevin-north': { personId: null },
      'echevin-south': { personId: null },
      tresorier: { personId: null },
    },
    laws: [],
    market: {
      cloth: RULES.market.cloth.referenceCents,
      wool: RULES.market.wool.referenceCents,
      grain: RULES.market.grain.referenceCents,
    },
    marketFlow: {},
    campaigns: {},
  };
}
