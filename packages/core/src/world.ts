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
  workshops: Workshop[];
  stock: Partial<Record<GoodId, number>>;
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
  seats: Record<SeatId, { houseId: string | null }>;
  laws: Law[];
  market: Record<GoodId, number>;
  /** Votes bought per seat, per house, cleared when that seat is elected. */
  campaigns: Partial<Record<SeatId, Record<string, number>>>;
}

export const FORMAT_VERSION = 1;

export const RULES = {
  version: 3,
  /**
   * Eight weeks is one seat contested every eight hours and a mandate of about forty hours.
   * Four weeks made it every four hours: a ceremony that fires while the player sleeps, and
   * a clock that rewards being awake over playing well.
   */
  electionPeriodWeeks: 8,
  priceFloorCents: 100,
  priceCeilCents: 5000,
  priceDriftCents: 30,
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
 * Wall-clock policy, not a simulation rule: how long a week lasts, and how far a
 * returning player is caught up. Read by the server; changing it must not refuse
 * an existing world.
 */
export const PACING = {
  minutesPerWeek: 60,
  // A month is 720 hours; 744 covers any calendar month. Beyond that, a read
  // simulates the cap and lets the wall clock jump over the rest rather than
  // replaying an unbounded backlog.
  maxCatchUpWeeks: 744,
} as const;

export const START_YEAR = 1401;
export const WEEKS_PER_YEAR = 52;

export function createWorld(seed: number): World {
  return {
    formatVersion: FORMAT_VERSION,
    rulesetVersion: RULES.version,
    seed,
    rng: seed,
    week: 1,
    year: START_YEAR,
    houses: {
      brigue: {
        id: 'brigue',
        name: 'Brigue',
        controller: 'human',
        treasuryCents: 117340,
        debtCents: 0,
        favour: 50,
        prestige: 50,
        workshops: [{ good: 'cloth', level: 2, workers: 2 }],
        stock: { wool: 8 },
      },
      caron: {
        id: 'caron',
        name: 'Caron',
        controller: 'ai',
        treasuryCents: 240000,
        debtCents: 0,
        favour: 60,
        prestige: 65,
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
        workshops: [{ good: 'grain', level: 2, workers: 2 }],
        stock: {},
      },
    },
    seats: {
      maire: { houseId: 'herse' },
      prevot: { houseId: 'vandermeersch' },
      'echevin-north': { houseId: 'caron' },
      'echevin-south': { houseId: null },
      tresorier: { houseId: null },
    },
    laws: [],
    market: { cloth: 1240, wool: 380, grain: 260 },
    campaigns: {},
  };
}
