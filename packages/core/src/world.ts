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
  /** Stable inside its house: two workshops of one trade are two buildings. */
  id: string;
  /** What it makes. The trade is the output good, so a workshop is bound to one trade. */
  good: GoodId;
  level: number;
}

/** The twelve degrees, in the order a house buys them. */
export const TITLES = [
  'roturier',
  'bourgeois',
  'notable',
  'patricien',
  'ecuyer',
  'chevalier',
  'baron',
  'vicomte',
  'comte',
  'marquis',
  'duc',
  'prince',
] as const;

export type TitleId = (typeof TITLES)[number];

/**
 * The ladder's content: what each degree gives and what each residence level
 * costs. Tables, not rules of procedure: the prices are calibration and move
 * with the economy, the shape — twelve degrees, one residence level per degree,
 * a title bought before the level it opens — is the rule.
 */
export interface TitleStep {
  prestige: number;
  /** The highest residence level this degree opens. */
  residenceLevel: number;
  priceCents: number;
}

export interface ResidenceStep {
  /**
   * What the level is called on the screen. A house is not "residence 3": the
   * ladder names its rooms in the town's tongue, so the player reads a place
   * and not a rank.
   */
  name: string;
  prestige: number;
  prestigeCap: number;
  stockDefence: number;
  workshops: number;
  /** What the level costs when the player buys the upgrade from the one below. */
  priceCents: number;
}

export const TITLE_LADDER: Record<TitleId, TitleStep> = {
  roturier: { prestige: 0, residenceLevel: 1, priceCents: 0 },
  bourgeois: { prestige: 80, residenceLevel: 2, priceCents: 60_000 },
  notable: { prestige: 110, residenceLevel: 3, priceCents: 120_000 },
  patricien: { prestige: 140, residenceLevel: 4, priceCents: 240_000 },
  ecuyer: { prestige: 180, residenceLevel: 5, priceCents: 480_000 },
  chevalier: { prestige: 220, residenceLevel: 6, priceCents: 960_000 },
  baron: { prestige: 280, residenceLevel: 7, priceCents: 1_920_000 },
  vicomte: { prestige: 340, residenceLevel: 8, priceCents: 3_840_000 },
  comte: { prestige: 400, residenceLevel: 9, priceCents: 7_680_000 },
  marquis: { prestige: 480, residenceLevel: 10, priceCents: 15_360_000 },
  duc: { prestige: 560, residenceLevel: 11, priceCents: 30_720_000 },
  prince: { prestige: 650, residenceLevel: 12, priceCents: 61_440_000 },
};

/**
 * The residence, level by level: what it holds and what it costs. The workshop
 * count is 1,1,2,2,2,3,3,3,3,4,4,4: a second building at level 3, a third at 6,
 * a fourth at 10. The prestige of the level adds to the prestige of the title;
 * the cap only stops what service adds on top.
 */
export const RESIDENCE_LADDER: readonly ResidenceStep[] = [
  { name: 'Masure', prestige: 0, prestigeCap: 200, stockDefence: 10, workshops: 1, priceCents: 0 },
  { name: 'Masure', prestige: 50, prestigeCap: 300, stockDefence: 14, workshops: 1, priceCents: 80_000 },
  { name: 'Maison', prestige: 70, prestigeCap: 400, stockDefence: 18, workshops: 2, priceCents: 160_000 },
  { name: 'Maison', prestige: 90, prestigeCap: 500, stockDefence: 22, workshops: 2, priceCents: 320_000 },
  { name: 'Logis', prestige: 120, prestigeCap: 600, stockDefence: 26, workshops: 2, priceCents: 640_000 },
  {
    name: 'Logis',
    prestige: 160,
    prestigeCap: 700,
    stockDefence: 30,
    workshops: 3,
    priceCents: 1_280_000,
  },
  { name: 'Gentilhommière', prestige: 200, prestigeCap: 800, stockDefence: 34, workshops: 3, priceCents: 2_560_000 },
  { name: 'Gentilhommière', prestige: 250, prestigeCap: 900, stockDefence: 38, workshops: 3, priceCents: 5_120_000 },
  {
    name: 'Manoir',
    prestige: 300,
    prestigeCap: 1000,
    stockDefence: 42,
    workshops: 3,
    priceCents: 10_240_000,
  },
  {
    name: 'Manoir',
    prestige: 360,
    prestigeCap: 1100,
    stockDefence: 46,
    workshops: 4,
    priceCents: 20_480_000,
  },
  {
    name: 'Château',
    prestige: 430,
    prestigeCap: 1200,
    stockDefence: 50,
    workshops: 4,
    priceCents: 40_960_000,
  },
  { name: 'Palais', prestige: 510, prestigeCap: 1300, stockDefence: 54, workshops: 4, priceCents: 81_920_000 },
];

/**
 * What one level of a workshop holds. The warehouse is the sum of what the
 * house's workshops hold, which is what makes a second building worth buying.
 */
export const WORKSHOP_CAPACITY_UNITS: readonly number[] = [0, 100, 200, 350, 550, 800, 1100, 1450, 1850];

export function titleOf(house: House): TitleId {
  return house.title ?? 'roturier';
}

export function residenceOf(house: House): number {
  return house.residenceLevel ?? 1;
}

/** Where a degree stands in the ladder: roturier is zero, prince is eleven. */
export function titleIndex(title: TitleId): number {
  return TITLES.indexOf(title);
}

/** The next degree, or undefined for the prince. */
export function nextTitle(title: TitleId): TitleId | undefined {
  return TITLES[titleIndex(title) + 1];
}

export function workshopCapacity(level: number): number {
  return WORKSHOP_CAPACITY_UNITS[Math.max(0, Math.min(level, WORKSHOP_CAPACITY_UNITS.length - 1))] ?? 0;
}

/** The warehouse a house has: every workshop gives what its level gives. */
export function stockCapacityUnits(house: House): number {
  let capacity = 0;
  for (const workshop of house.workshops) {
    capacity += workshopCapacity(workshop.level);
  }

  return capacity;
}

/** What a residence level is called. */
export function residenceName(level: number): string {
  const step = RESIDENCE_LADDER[Math.max(0, Math.min(level, RESIDENCE_LADDER.length)) - 1];

  return step?.name ?? RESIDENCE_LADDER[0]!.name;
}

/** How many workshops the residence allows. */
export function workshopCap(house: House): number {
  return RESIDENCE_LADDER[residenceOf(house) - 1].workshops;
}

/** The highest level a workshop may reach at the house's degree. */
export function workshopLevelCap(house: House): number {
  return 2 + Math.ceil(titleIndex(titleOf(house)) / 2);
}

/**
 * Prestige as the screen reads it: what the title and the residence gave, plus
 * the service, the service stopping at the residence's cap.
 */
export function displayedPrestige(house: House): number {
  const residence = RESIDENCE_LADDER[residenceOf(house) - 1];

  return TITLE_LADDER[titleOf(house)].prestige + residence.prestige + Math.min(house.prestige, residence.prestigeCap);
}

/** The trade a workshop practises: its output names its chain. */
export function tradeOf(good: GoodId): Trade | undefined {
  return TRADES.find((trade) => TRADE_CHAINS[trade].output === good);
}

export interface House {
  id: string;
  name: string;
  controller: Controller;
  treasuryCents: number;
  /** Unpaid upkeep. The design says a debt follows the house; this is where it lives. */
  debtCents: number;
  favour: number;
  /**
   * What the house earned by service only: offices held, juries served, works
   * funded (#55). The title and the residence are bought and live in the ladder
   * tables; what this field shows is the share of prestige that is capped by the
   * residence. Optional because the ladder arrived with ruleset 3.
   */
  prestige: number;
  /** The degree bought at the town hall; it opens the residence and the workshops. */
  title?: TitleId;
  /** One ladder: the title opens a level, money pays for it. */
  residenceLevel?: number;
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
 * What a site is for. A workshop is built by `trade`, improved by `workshopId`;
 * the house's own level is raised by `residence`; a degree is obtained at the
 * next noon or midnight. The cost is paid when the site is opened, so what is
 * left to pay in hours is all the site carries.
 */
export type SiteWork =
  { work: 'build'; trade: Trade } | { work: 'upgrade'; workshopId: string } | { work: 'residence' } | { work: 'title' };

/**
 * Work that takes hours. It carries the instant it falls due rather than a
 * remaining count, so a catch-up can replay whole hours and pay what is owed.
 * A campaign has no duration left: it is a candidacy, and it counts once.
 */
export type Engagement =
  | { id: string; kind: 'hearing'; houseId: string; dueAt: number }
  | ({ id: string; kind: 'site'; houseId: string; dueAt: number } & SiteWork);

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
  /**
   * Mints workshop ids. Optional because a world stored before ruleset 3 has
   * none, and its workshops are numbered in their house when it is read.
   */
  workshopSeq?: number;
}

export const FORMAT_VERSION = 1;

export const RULES = {
  version: 3,
  /**
   * The starting kit: a house must buy its input and pay a few hours of upkeep
   * before its first sale. Every house gets it, the first as much as a later
   * arrival.
   */
  startingPurseCents: 45_000,
  startingInputUnits: 8,
  /** The level of the kit's workshop: the house that arrives starts here. */
  startingWorkshopLevel: 2,
  /** The level a workshop is built at: the first, and it grows from there. */
  builtWorkshopLevel: 1,
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
   * a good nobody makes climbs. The demand is calibrated to the middle of the
   * town's two states — the three AI houses alone, and the same town with one
   * player's workshop working the chain — so an unworked chain sits a little
   * above its reference and a worked chain at it or below: the reference is the
   * centre of the band, not a price a short-handed town rests on. `scaleUnits`
   * is the imbalance that moves the price by a tenth of it
   * (`pricePressureDivisor`); `priceReversionDivisor` is how many hours the gap
   * back to the reference takes to close. Wool has no absorption because what
   * is made of it is bought by the workshops, which shows up as demand, not as
   * the town's own trade.
   */
  market: {
    wool: { referenceCents: 380, absorbedUnits: 0, scaleUnits: 4 },
    cloth: { referenceCents: 1240, absorbedUnits: 8, scaleUnits: 10 },
    grain: { referenceCents: 260, absorbedUnits: 0, scaleUnits: 4 },
    bread: { referenceCents: 520, absorbedUnits: 6, scaleUnits: 10 },
    wood: { referenceCents: 300, absorbedUnits: 0, scaleUnits: 4 },
    planks: { referenceCents: 980, absorbedUnits: 6, scaleUnits: 8 },
  } satisfies Record<GoodId, { referenceCents: number; absorbedUnits: number; scaleUnits: number }>,
  pricePressureDivisor: 10,
  priceReversionDivisor: 4,
  outputPerLevel: 2,
  /**
   * What a workshop costs every hour it runs, whatever it makes: one level's
   * share. There is no worker to count since ruleset 3, and a workshop paid
   * only for what it produces would make its size free.
   */
  upkeepPerWorkshopLevelCents: 120,
  /**
   * A title is obtained at the next noon or midnight, wherever it is bought: a
   * half-day, counted from the hour of the purchase. The half-day is the
   * calendar's, not a second clock.
   */
  titleHours: 6,
  /**
   * The hours an improvement takes, by the level it reaches: the step grows
   * with the level, so the top of the ladder is a long intent and not a tap.
   * Index zero is unused; level 2 is one hour.
   */
  improvementHours: [0, 0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66],
  /** What building a workshop of the starting level costs. */
  buildCents: 50_000,
  /** What renaming a house costs, once the name is chosen at the creation. */
  renameCents: 20_000,
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
  // 168 town hours, seven days when the scheduler keeps pace: the journal
  // keeps what a reader back after a silence could still want. The cut follows
  // the town's own clock, so a town the scheduler stopped keeps its journal.
  // Calibration, not a rule.
  journalRetentionHours: 7 * 24,
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
      prestige: 0,
      title: 'roturier',
      residenceLevel: 1,
      career: 0,
      dormant: false,
      workshops: [{ id: 'workshop-1', good: chain.output, level: RULES.startingWorkshopLevel }],
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
        // A cloth workshop of level 3 needs the patrician's workshop cap; the
        // seed gives Caron the degree that carries it rather than a bad workshop.
        title: 'bourgeois',
        residenceLevel: 2,
        career: 0,
        dormant: false,
        workshops: [{ id: 'workshop-1', good: 'cloth', level: 3 }],
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
        title: 'roturier',
        residenceLevel: 1,
        career: 0,
        dormant: false,
        workshops: [{ id: 'workshop-1', good: 'bread', level: 2 }],
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
        title: 'roturier',
        residenceLevel: 1,
        career: 0,
        dormant: false,
        workshops: [{ id: 'workshop-1', good: 'planks', level: 2 }],
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
    workshopSeq: 1,
  };
}
