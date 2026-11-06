/**
 * The world is the whole game. It is plain data, it is serialisable, and it is
 * never mutated by a tick: the simulation hands back a new one.
 *
 * Money is always integer cents. There is no float anywhere in this file, and
 * there must never be: an economy that drifts by a hundredth per tick cannot be
 * replayed or audited.
 */

export type GoodId = 'wool' | 'cloth' | 'grain' | 'bread' | 'wood' | 'planks';

/** The six goods, in chain order: a raw good, then what is made of it. */
export const GOODS: readonly GoodId[] = ['wool', 'cloth', 'grain', 'bread', 'wood', 'planks'];

/** The three trades a player may practise: one finished chain each. */
export type Trade = 'weaver' | 'baker' | 'carpenter';

export const TRADES: readonly Trade[] = ['weaver', 'baker', 'carpenter'];

export interface TradeChain {
  output: GoodId;
  input: GoodId;
}

/** What each trade makes, and the raw good it buys to make it. */
export const TRADE_CHAINS: Record<Trade, TradeChain> = {
  weaver: { output: 'cloth', input: 'wool' },
  baker: { output: 'bread', input: 'grain' },
  carpenter: { output: 'planks', input: 'wood' },
};
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
  enactedAt: number;
}

/** The durations the calendar gives an engagement, in hours. */
export type EngagementKind = 'hearing' | 'site';

/**
 * Work that takes hours. It carries the instant it falls due rather than a
 * remaining count, so a catch-up can replay whole hours and pay what is owed.
 * A campaign has no duration left: it is a candidacy, and it counts once.
 */
export type Engagement =
  | { id: string; kind: 'hearing'; houseId: string; dueAt: number }
  | { id: string; kind: 'site'; houseId: string; dueAt: number };

export interface World {
  /** Stamped so a saved world can be refused rather than silently misread. */
  formatVersion: number;
  /** The ruleset that produced this world. A catch-up across versions is a bug. */
  rulesetVersion: number;
  seed: number;
  rng: number;
  hour: number;
  year: number;
  houses: Record<string, House>;
  people: Record<string, Person>;
  seats: Record<SeatId, Seat>;
  laws: Law[];
  market: Record<GoodId, number>;
  /**
   * What the town put on the market last hour, per good: units sold minus units
   * bought. It is what moves the prices of the hour that follows, so it is
   * stored rather than recomputed: the price you see is the town you were.
   */
  marketFlow: Partial<Record<GoodId, number>>;
  /**
   * The last PRICE_HISTORY_BELLS prices per good, in cents, one point per tick.
   * Optional because a world stored before the field existed must keep ticking:
   * its history starts at the tick that first sees it.
   */
  marketHistory?: Partial<Record<GoodId, number[]>>;
  /** Votes bought per seat, per house, cleared when that seat is elected. */
  campaigns: Partial<Record<SeatId, Record<string, number>>>;
  /**
   * Candidacies closed at the last noon bell: they count at the coming
   * scrutiny. What is lodged after that bell waits in `campaigns` for the next.
   */
  closedCampaigns: Partial<Record<SeatId, Record<string, number>>>;
  /**
   * What the town owes to a future hour: a campaign, a hearing, a building
   * site. Resolved by the tick when its due hour arrives, even if the town
   * only reaches that hour later.
   */
  engagements: Engagement[];
  /** Mints engagement ids, so two campaigns in one hour cannot collide. */
  engagementSeq: number;
}

export const FORMAT_VERSION = 1;

export const RULES = {
  version: 1,
  /**
   * The starting kit: a house must buy its input and pay a few hours of wages
   * before its first sale. Every house gets it, the first as much as a later
   * arrival.
   */
  startingPurseCents: 45_000,
  startingInputUnits: 8,
  /** The town stops growing here; a newcomer with no place starts another town. */
  houseCap: 20,
  /**
   * A building site takes twelve hours. A hearing has no fixed delay: it is
   * held at the next noon sitting after the complaint.
   */
  siteHours: 12,
  priceFloorCents: 100,
  priceCeilCents: 5000,
  priceDriftCents: 30,
  /**
   * A good's price is pulled by three things every hour: its own random drift,
   * the town's imbalance on that good, and the gap back to its reference.
   *
   * `absorbedUnits` is the town's standing demand at the reference price: the
   * volume it takes every hour whether or not anyone makes the good. Where that
   * demand is nil, a good nobody touches sits on its reference; where it is not,
   * a good nobody makes climbs. `scaleUnits` is the imbalance that moves the
   * price by a tenth of it (`pricePressureDivisor`); `priceReversionDivisor` is
   * how many hours the gap back to the reference takes to close. Wool has no
   * absorption because what is made of it is bought by the workshops, which
   * shows up as demand, not as the town's own trade.
   */
  market: {
    wool: { referenceCents: 380, absorbedUnits: 0, scaleUnits: 4 },
    cloth: { referenceCents: 1240, absorbedUnits: 10, scaleUnits: 10 },
    grain: { referenceCents: 260, absorbedUnits: 0, scaleUnits: 4 },
    bread: { referenceCents: 520, absorbedUnits: 10, scaleUnits: 10 },
    wood: { referenceCents: 300, absorbedUnits: 0, scaleUnits: 4 },
    planks: { referenceCents: 980, absorbedUnits: 8, scaleUnits: 8 },
  } satisfies Record<GoodId, { referenceCents: number; absorbedUnits: number; scaleUnits: number }>,
  pricePressureDivisor: 10,
  priceReversionDivisor: 4,
  /**
   * The warehouse holds this many units in total, all goods together. The
   * residence ladder (#54) will make it a house's level; until then it is one
   * constant, and the projection carries it so the client computes nothing.
   */
  stockCapacityUnits: 100,
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
    wool: null,
    cloth: { input: 'wool', perUnit: 1 },
    grain: null,
    bread: { input: 'grain', perUnit: 1 },
    wood: null,
    planks: { input: 'wood', perUnit: 1 },
  } satisfies Record<GoodId, { input: GoodId; perUnit: number } | null>,
} as const;

/**
 * Wall-clock policy, not a simulation rule: how far a returning player is caught
 * up, and when a house stops being played. Read by the server; changing it must
 * not refuse an existing world.
 */
export const PACING = {
  // The scheduler plays one hour per pass. Thirty days are 720 hours, and the
  // read path catches up at most that far before the wall clock jumps: the
  // backlog it cannot replay is not simulated, so the town only counts the
  // hours it lived.
  maxCatchUpHours: 744,
  // Three days without a visit is enough to say the player has stopped playing;
  // the house goes dormant, keeps its estate and its seat, and casts no vote.
  // Calibration, not a rule.
  dormancyDays: 3,
  // After a month without a visit the house is gone with its tokens: no return,
  // no vacation mode. The boundary is strict, so exactly thirty days still
  // reads and the next read deletes.
  deletionDays: 30,
  // A deletion request is not immediate: the token stays valid for a week so the
  // player can come back, and the scheduler erases the identity at the deadline.
  // Calibration, not a rule.
  deletionGraceDays: 7,
} as const;

export const START_YEAR = 1401;
/** Twenty-four hours make a year, so one real day is one game year. */
export const HOURS_PER_YEAR = 24;
/**
 * The Marché keeps one price per bell: twelve bells make a game year cycling
 * twice a day, and the window is the last day of town life. It is a display
 * window, not a rule, so it stays out of RULES.
 */
export const PRICE_HISTORY_BELLS = HOURS_PER_YEAR;

export interface HouseArrival {
  house: House;
  person: Person;
}

/** The name and the id the first house arrives with, drawn before it joins. */
export interface HouseIdentity {
  id: string;
  houseName: string;
  personName: string;
}

/**
 * The house a new player starts with: the workshop of its trade, a little
 * money, its first input, no seat and no career. The town is built without it;
 * `withFirstHouse` adds it when the first player joins, and puts it back into a
 * freed place so a deleted first house cannot brick the join path. Its name is an
 * input: the server draws it, and nothing about the first house is fixed.
 */
export function createFirstHouse(trade: Trade, identity: HouseIdentity): HouseArrival {
  const chain = TRADE_CHAINS[trade];

  return {
    house: {
      id: identity.id,
      name: identity.houseName,
      controller: 'human',
      treasuryCents: RULES.startingPurseCents,
      debtCents: 0,
      favour: 50,
      prestige: 50,
      career: 0,
      dormant: false,
      workshops: [{ good: chain.output, level: 2, workers: 2 }],
      stock: { [chain.input]: RULES.startingInputUnits },
    },
    person: {
      id: `person-${identity.id}`,
      houseId: identity.id,
      name: identity.personName,
      age: 20,
      attributes: { artisanat: 10, parole: 10, intrigue: 10 },
      alive: true,
    },
  };
}

/**
 * The first house: the town is built without it, and it is added when the first
 * player joins — or when a deleted first house's place waits for a human. It is
 * never a political role, and adding it twice is a no-op.
 */
export function withFirstHouse(world: World, trade: Trade, identity: HouseIdentity): World {
  if (humanHouseOf(world) !== undefined) {
    return world;
  }

  const next = structuredClone(world);
  const { house, person } = createFirstHouse(trade, identity);
  next.houses[house.id] = house;
  next.people[person.id] = person;

  return next;
}

/** Adds a newcomer's house to a town that already has a player. */
export function withNewcomer(world: World, trade: Trade, identity: HouseIdentity): World {
  const next = structuredClone(world);
  const { house, person } = createFirstHouse(trade, identity);
  next.houses[house.id] = house;
  next.people[person.id] = person;

  return next;
}

/** The first house: the only human house of a solo town. */
export function humanHouseOf(world: World): House | undefined {
  return Object.values(world.houses).find((house) => house.controller === 'human');
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

/** What a house holds in its warehouse, all goods together: the capped total. */
export function stockUnits(house: House): number {
  let total = 0;
  for (const units of Object.values(house.stock)) {
    total += units ?? 0;
  }

  return total;
}

export function createWorld(seed: number): World {
  return {
    formatVersion: FORMAT_VERSION,
    rulesetVersion: RULES.version,
    seed,
    rng: seed,
    hour: 1,
    year: START_YEAR,
    houses: {
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
        stock: {},
      },
      fournier: {
        id: 'fournier',
        name: 'Fournier',
        controller: 'ai',
        treasuryCents: 160000,
        debtCents: 0,
        favour: 45,
        prestige: 50,
        career: 0,
        dormant: false,
        workshops: [{ good: 'bread', level: 2, workers: 2 }],
        stock: {},
      },
      charpentier: {
        id: 'charpentier',
        name: 'Charpentier',
        controller: 'ai',
        treasuryCents: 170000,
        debtCents: 0,
        favour: 55,
        prestige: 52,
        career: 0,
        dormant: false,
        workshops: [{ good: 'planks', level: 2, workers: 2 }],
        stock: {},
      },
    },
    people: {
      'person-caron': {
        id: 'person-caron',
        houseId: 'caron',
        name: 'Robert Caron',
        age: 44,
        attributes: { artisanat: 10, parole: 10, intrigue: 10 },
        alive: true,
      },
      'person-fournier': {
        id: 'person-fournier',
        houseId: 'fournier',
        name: 'Jehan Fournier',
        age: 41,
        attributes: { artisanat: 10, parole: 10, intrigue: 10 },
        alive: true,
      },
      'person-charpentier': {
        id: 'person-charpentier',
        houseId: 'charpentier',
        name: 'Perrin Charpentier',
        age: 49,
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
      wool: RULES.market.wool.referenceCents,
      cloth: RULES.market.cloth.referenceCents,
      grain: RULES.market.grain.referenceCents,
      bread: RULES.market.bread.referenceCents,
      wood: RULES.market.wood.referenceCents,
      planks: RULES.market.planks.referenceCents,
    },
    marketFlow: {},
    marketHistory: {
      wool: [RULES.market.wool.referenceCents],
      cloth: [RULES.market.cloth.referenceCents],
      grain: [RULES.market.grain.referenceCents],
      bread: [RULES.market.bread.referenceCents],
      wood: [RULES.market.wood.referenceCents],
      planks: [RULES.market.planks.referenceCents],
    },
    campaigns: {},
    closedCampaigns: {},
    engagements: [],
    engagementSeq: 0,
  };
}
