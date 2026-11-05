import {
  GOODS,
  HOURS_PER_YEAR,
  RULES,
  stockUnits,
  type GoodId,
  type House,
  type Law,
  type Seat,
  type SeatId,
  type World,
} from '@brigue/core';

/** A workshop as the screen reads it: its chain and hourly figures come from the rules. */
export interface WorkshopView {
  good: GoodId;
  level: number;
  workers: number;
  input: GoodId | null;
  outputUnitsPerHour: number;
  inputUnitsPerHour: number;
  wagesCentsPerHour: number;
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
  hoursPerYear: number;
  /** One-based hour inside the year, always between 1 and `hoursPerYear`. */
  hourOfYear: number;
  /** The absolute town hour in which the next scrutiny is held. */
  nextScrutinyHour: number;
  /** When that hour begins and the scrutiny happens, as an instant. */
  nextScrutinyAt: string;
}

export interface WorldProjection {
  hour: number;
  year: number;
  calendar: CalendarView;
  house: OwnHouseView;
  town: {
    houses: PublicHouseView[];
    people: PublicPersonView[];
    seats: Record<SeatId, Seat>;
    laws: Law[];
    market: Record<GoodId, number>;
    /** The last prices per good, so the Marché can draw them. */
    marketHistory: Partial<Record<GoodId, number[]>>;
    /** The reference each good returns to; the chart draws it as a guide. */
    marketReferences: Record<GoodId, number>;
  };
  /** The instant the next bell rings, so the client can show when the town moves. */
  nextBellAt: string;
}

/**
 * The client renders, it decides nothing: it gets its own house in full and the
 * rest of the town at the detail the town itself would show. The seed, the
 * generator and other houses' treasuries never leave the server.
 */
export function projectWorld(world: World, houseId: string, hourStartedAt: Date): WorldProjection {
  const house = world.houses[houseId];
  if (!house) {
    // The token points at a house the world no longer holds: a server bug, not
    // something to paper over with a made-up house.
    throw new Error(`world ${world.seed} has no house ${houseId}`);
  }

  return {
    hour: world.hour,
    year: world.year,
    calendar: calendarOf(world, hourStartedAt),
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
      marketHistory: structuredClone(world.marketHistory ?? {}),
      marketReferences: Object.fromEntries(GOODS.map((good) => [good, RULES.market[good].referenceCents])) as Record<
        GoodId,
        number
      >,
    },
    nextBellAt: new Date(
      hourStartedAt.getTime() + hoursUntil(nextBellOf(world.hour), world.hour) * HOUR_MS,
    ).toISOString(),
  };
}

export const HOUR_MS = 60 * 60 * 1000;

/** The first bell strictly after this hour: noon or midnight, whichever comes first. */
export function nextBellOf(hour: number): number {
  return Math.ceil((hour + 1) / (HOURS_PER_YEAR / 2)) * (HOURS_PER_YEAR / 2);
}

function hoursUntil(target: number, from: number): number {
  return target - from;
}

function calendarOf(world: World, hourStartedAt: Date): CalendarView {
  const hourOfYear = ((world.hour - 1) % HOURS_PER_YEAR) + 1;
  // A scrutiny closes the hour that is a multiple of the year length.
  const nextScrutinyHour = Math.ceil((world.hour + 1) / HOURS_PER_YEAR) * HOURS_PER_YEAR;

  return {
    hoursPerYear: HOURS_PER_YEAR,
    hourOfYear,
    nextScrutinyHour,
    nextScrutinyAt: new Date(
      hourStartedAt.getTime() + hoursUntil(nextScrutinyHour, world.hour) * HOUR_MS,
    ).toISOString(),
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
      const outputUnitsPerHour = workshop.level * RULES.outputPerLevel;

      return {
        ...structuredClone(workshop),
        input: recipe?.input ?? null,
        outputUnitsPerHour,
        inputUnitsPerHour: recipe === null ? 0 : outputUnitsPerHour * recipe.perUnit,
        wagesCentsPerHour: workshop.workers * RULES.wagePerWorkerCents,
      };
    }),
    stock: structuredClone(house.stock),
    stockUnits: stockUnits(house),
    stockCapacityUnits: RULES.stockCapacityUnits,
  };
}
