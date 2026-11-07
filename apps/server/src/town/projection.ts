import {
  displayedPrestige,
  GOODS,
  HOURS_PER_YEAR,
  NAME_PRICE,
  nextTitle,
  RESIDENCE_LADDER,
  residenceOf,
  RULES,
  stockCapacityUnits,
  stockUnits,
  TITLE_LADDER,
  titleOf,
  workshopCapacity,
  workshopLevelCap,
  type Engagement,
  type GoodId,
  type House,
  type Law,
  type Seat,
  type SeatId,
  type SiteWork,
  type TitleId,
  type Trade,
  type World,
} from '@brigue/core';

import type { TownInfo } from './worlds.ts';

/** A workshop as the screen reads it: its chain and hourly figures come from the rules. */
export interface WorkshopView {
  id: string;
  good: GoodId;
  level: number;
  input: GoodId | null;
  outputUnitsPerHour: number;
  inputUnitsPerHour: number;
  upkeepCentsPerHour: number;
  /** What this workshop gives the warehouse at its level. */
  capacityUnits: number;
  /** Whether the house's degree allows one more level, and how long it takes. */
  canUpgrade: boolean;
  upgradeHours: number | null;
}

/** A site under way: what it is for, and the hour it closes. */
export interface SiteView {
  id: string;
  dueAt: number;
  work: SiteWork['work'];
  trade: Trade | null;
  workshopId: string | null;
}

/**
 * The ladder as the screen reads it. Every figure the Maison needs is computed
 * here: the client draws the gate, it never decides whether it may pass.
 */
export interface LadderView {
  title: TitleId;
  /** What the house's residence level is called, never "residence 3". */
  residence: string;
  titlePrestige: number;
  residencePrestige: number;
  /** What service earned, already capped by the level. */
  servicePrestige: number;
  prestigeCap: number;
  workshops: number;
  stockDefence: number;
  workshopLevelCap: number;
  nextTitle: { title: TitleId; priceCents: number } | null;
  nextResidence: { level: number; name: string; priceCents: number; opened: boolean; hours: number } | null;
}

export interface OwnHouseView {
  id: string;
  name: string;
  treasuryCents: number;
  debtCents: number;
  favour: number;
  /** The prestige the screens show: title plus residence plus capped service. */
  prestige: number;
  career: number;
  dormant: boolean;
  title: TitleId;
  residenceLevel: number;
  ladder: LadderView;
  workshops: WorkshopView[];
  stock: Partial<Record<GoodId, number>>;
  /** What the stock holds in total, and the warehouse's cap: the client sums nothing. */
  stockUnits: number;
  stockCapacityUnits: number;
  build: { priceCents: number; hours: number; level: number; room: number; cap: number };
  sites: SiteView[];
  rename: { priceCents: number };
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
    id: number;
    name: string;
    houses: PublicHouseView[];
    people: PublicPersonView[];
    seats: Record<SeatId, Seat>;
    laws: Law[];
    market: Record<GoodId, number>;
    /** The last prices per good, so the Marché can draw them. */
    marketHistory: Partial<Record<GoodId, number[]>>;
    /** The centre of the band each good's price is pulled around; the chart draws it as a guide. */
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
export function projectWorld(town: TownInfo, world: World, houseId: string, hourStartedAt: Date): WorldProjection {
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
    house: ownHouse(world, house),
    town: {
      id: town.id,
      name: town.name,
      houses: Object.values(world.houses)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          prestige: displayedPrestige(candidate),
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
  const half = HOURS_PER_YEAR / 2;

  return hour + ((half - (hour % half)) % half);
}

function hoursUntil(target: number, from: number): number {
  // An hour's ceremony happens when that hour is over, so the end of the town's
  // current hour is one step past its start.
  return target - from + 1;
}

function calendarOf(world: World, hourStartedAt: Date): CalendarView {
  const hourOfYear = ((world.hour - 1) % HOURS_PER_YEAR) + 1;
  // A scrutiny closes the hour that is a multiple of the year length.
  const nextScrutinyHour = world.hour + ((HOURS_PER_YEAR - (world.hour % HOURS_PER_YEAR)) % HOURS_PER_YEAR);

  return {
    hoursPerYear: HOURS_PER_YEAR,
    hourOfYear,
    nextScrutinyHour,
    nextScrutinyAt: new Date(
      hourStartedAt.getTime() + hoursUntil(nextScrutinyHour, world.hour) * HOUR_MS,
    ).toISOString(),
  };
}

function ownHouse(world: World, house: House): OwnHouseView {
  const residence = RESIDENCE_LADDER[residenceOf(house) - 1];
  const title = titleOf(house);
  const next = nextTitle(title);

  return {
    id: house.id,
    name: house.name,
    treasuryCents: house.treasuryCents,
    debtCents: house.debtCents,
    favour: house.favour,
    prestige: displayedPrestige(house),
    career: house.career,
    dormant: house.dormant,
    title,
    residenceLevel: residenceOf(house),
    ladder: {
      title,
      residence: residence.name,
      titlePrestige: TITLE_LADDER[title].prestige,
      residencePrestige: residence.prestige,
      servicePrestige: Math.min(house.prestige, residence.prestigeCap),
      prestigeCap: residence.prestigeCap,
      workshops: residence.workshops,
      stockDefence: residence.stockDefence,
      workshopLevelCap: workshopLevelCap(house),
      nextTitle: next === undefined ? null : { title: next, priceCents: TITLE_LADDER[next].priceCents },
      nextResidence:
        residenceOf(house) >= RESIDENCE_LADDER.length
          ? null
          : {
              level: residenceOf(house) + 1,
              name: RESIDENCE_LADDER[residenceOf(house)]!.name,
              priceCents: RESIDENCE_LADDER[residenceOf(house)].priceCents,
              opened: residenceOf(house) < TITLE_LADDER[title].residenceLevel,
              hours: RULES.improvementHours[residenceOf(house) + 1] ?? RULES.siteHours,
            },
    },
    workshops: house.workshops.map((workshop) => {
      const recipe = RULES.recipes[workshop.good];
      const outputUnitsPerHour = workshop.level * RULES.outputPerLevel;

      return {
        ...structuredClone(workshop),
        input: recipe?.input ?? null,
        outputUnitsPerHour,
        inputUnitsPerHour: recipe === null ? 0 : outputUnitsPerHour * recipe.perUnit,
        upkeepCentsPerHour: workshop.level * RULES.upkeepPerWorkshopLevelCents,
        capacityUnits: workshopCapacity(workshop.level),
        canUpgrade: workshop.level < workshopLevelCap(house),
        upgradeHours: RULES.improvementHours[workshop.level + 1] ?? null,
      };
    }),
    stock: structuredClone(house.stock),
    stockUnits: stockUnits(house),
    stockCapacityUnits: stockCapacityUnits(house),
    build: {
      priceCents: RULES.buildCents,
      hours: RULES.siteHours,
      level: RULES.builtWorkshopLevel,
      room: Math.max(0, residence.workshops - house.workshops.length - buildingCount(world, house.id, 'build')),
      cap: residence.workshops,
    },
    sites: world.engagements.flatMap((engagement) =>
      engagement.kind === 'site' && engagement.houseId === house.id
        ? [{ id: engagement.id, dueAt: engagement.dueAt, ...siteWorkOf(engagement) }]
        : [],
    ),
    rename: { priceCents: NAME_PRICE.renameCents },
  };
}

/** The sites of one kind a house has open: a build in progress counts on the cap. */
function buildingCount(world: World, houseId: string, work: SiteWork['work']): number {
  return world.engagements.filter(
    (engagement) => engagement.kind === 'site' && engagement.houseId === houseId && engagement.work === work,
  ).length;
}

/** What a site is for, as the screen names it: a trade, a workshop, the house. */
function siteWorkOf(site: Extract<Engagement, { kind: 'site' }>) {
  switch (site.work) {
    case 'build':
      return { work: site.work, trade: site.trade, workshopId: null };
    case 'upgrade':
      return { work: site.work, trade: null, workshopId: site.workshopId };
    default:
      return { work: site.work, trade: null, workshopId: null };
  }
}
