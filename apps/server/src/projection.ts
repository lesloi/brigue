import {
  PACING,
  RULES,
  stockUnits,
  WEEKS_PER_YEAR,
  type GoodId,
  type House,
  type Law,
  type Seat,
  type SeatId,
  type World,
} from '@brigue/core';

/** A workshop as the screen reads it: its chain and weekly figures come from the rules. */
export interface WorkshopView {
  good: GoodId;
  level: number;
  workers: number;
  input: GoodId | null;
  outputUnitsPerWeek: number;
  inputUnitsPerWeek: number;
  wagesCentsPerWeek: number;
}

export interface OwnHouseView {
  id: string;
  name: string;
  treasuryCents: number;
  debtCents: number;
  favour: number;
  prestige: number;
  career: number;
  dormant: boolean;
  workshops: WorkshopView[];
  stock: Partial<Record<GoodId, number>>;
  /** What the stock holds in total, and the warehouse's cap: the client sums nothing. */
  stockUnits: number;
  stockCapacityUnits: number;
}

/** What the town knows about another house: its name and standing, not its purse. */
export interface PublicHouseView {
  id: string;
  name: string;
  prestige: number;
  dormant: boolean;
}

/** A person the client may name when a seat points at them. No attributes, no age. */
export interface PublicPersonView {
  id: string;
  houseId: string;
  name: string;
}

/**
 * The calendar the screen draws, computed here so the client derives no date:
 * where the year stands, and when the next scrutiny closes it.
 */
export interface CalendarView {
  weeksPerYear: number;
  /** One-based week inside the year, always between 1 and `weeksPerYear`. */
  weekOfYear: number;
  /** The absolute town week in which the next scrutiny is held. */
  nextScrutinyWeek: number;
  /** When that week ends and the scrutiny happens, as an instant. */
  nextScrutinyAt: string;
}

export interface WorldProjection {
  week: number;
  year: number;
  calendar: CalendarView;
  house: OwnHouseView;
  town: {
    houses: PublicHouseView[];
    people: PublicPersonView[];
    seats: Record<SeatId, Seat>;
    laws: Law[];
    market: Record<GoodId, number>;
  };
  /** The instant the current week ends, so the client can show the next tick. */
  nextTickAt: string;
}

/**
 * The client renders, it decides nothing: it gets its own house in full and the
 * rest of the town at the detail the town itself would show. The seed, the
 * generator and other houses' treasuries never leave the server.
 */
export function projectWorld(world: World, houseId: string, weekStartedAt: Date): WorldProjection {
  const house = world.houses[houseId];
  if (!house) {
    // The token points at a house the world no longer holds: a server bug, not
    // something to paper over with a made-up house.
    throw new Error(`world ${world.seed} has no house ${houseId}`);
  }

  return {
    week: world.week,
    year: world.year,
    calendar: calendarOf(world, weekStartedAt),
    house: ownHouse(house),
    town: {
      houses: Object.values(world.houses)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          prestige: candidate.prestige,
          dormant: candidate.dormant,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      people: Object.values(world.people)
        .map((person) => ({ id: person.id, houseId: person.houseId, name: person.name }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      seats: structuredClone(world.seats),
      laws: structuredClone(world.laws),
      market: structuredClone(world.market),
    },
    nextTickAt: new Date(weekStartedAt.getTime() + PACING.minutesPerWeek * 60_000).toISOString(),
  };
}

function calendarOf(world: World, weekStartedAt: Date): CalendarView {
  const weekOfYear = ((world.week - 1) % WEEKS_PER_YEAR) + 1;
  // A scrutiny closes the week that is a multiple of the year length, so the
  // week currently in progress is its own scrutiny week when it divides.
  const nextScrutinyWeek = world.week + ((WEEKS_PER_YEAR - (world.week % WEEKS_PER_YEAR)) % WEEKS_PER_YEAR);
  const weekMs = PACING.minutesPerWeek * 60_000;
  const weeksUntilEnd = nextScrutinyWeek - world.week + 1;

  return {
    weeksPerYear: WEEKS_PER_YEAR,
    weekOfYear,
    nextScrutinyWeek,
    nextScrutinyAt: new Date(weekStartedAt.getTime() + weeksUntilEnd * weekMs).toISOString(),
  };
}

function ownHouse(house: House): OwnHouseView {
  return {
    id: house.id,
    name: house.name,
    treasuryCents: house.treasuryCents,
    debtCents: house.debtCents,
    favour: house.favour,
    prestige: house.prestige,
    career: house.career,
    dormant: house.dormant,
    workshops: house.workshops.map((workshop) => {
      const recipe = RULES.recipes[workshop.good];
      const outputUnitsPerWeek = workshop.level * RULES.outputPerLevel;

      return {
        ...structuredClone(workshop),
        input: recipe?.input ?? null,
        outputUnitsPerWeek,
        inputUnitsPerWeek: recipe === null ? 0 : outputUnitsPerWeek * recipe.perUnit,
        wagesCentsPerWeek: workshop.workers * RULES.wagePerWorkerCents,
      };
    }),
    stock: structuredClone(house.stock),
    stockUnits: stockUnits(house),
    stockCapacityUnits: RULES.stockCapacityUnits,
  };
}
