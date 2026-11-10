import {
  displayedPrestige,
  GOODS,
  HOURS_PER_YEAR,
  NAME_PRICE,
  nextTitle,
  residenceOf,
  RESIDENCE_LADDER,
  RULES,
  TRADE_CHAINS,
  stockCapacityUnits,
  stockUnits,
  TITLE_LADDER,
  titleOf,
  workshopCapacity,
  workshopCap,
  workshopLevelCap,
  yearOf,
  type Engagement,
  type GoodId,
  type Law,
  type Person,
  type Seat,
  type SeatId,
  type SiteWork,
  type TitleId,
  type Trade,
  type World,
} from '@brigue/core';

import { hourStartedOf, type TownInfo } from './worlds.ts';

/** A workshop as the screen reads it: its chain and hourly figures come from the rules. */
export interface WorkshopView {
  id: number;
  good: GoodId;
  level: number;
  input: GoodId | null;
  outputUnitsPerHour: number;
  inputUnitsPerHour: number;
  upkeepCentsPerHour: number;
  /** What this workshop gives the warehouse at its level. */
  capacityUnits: number;
  /** Whether the person's degree allows one more level, and how long it takes. */
  canUpgrade: boolean;
  upgradeHours: number | null;
}

/** A site under way: what it is for, and the hour it closes. */
export interface SiteView {
  id: number;
  dueAt: number;
  work: SiteWork['work'];
  trade: Trade | null;
  workshopId: number | null;
}

/**
 * The ladder as the screen reads it. Every figure the Maison needs is computed
 * here: the client draws the gate, it never decides whether it may pass.
 */
export interface LadderView {
  title: TitleId;
  /** What the person's residence level is called, never "residence 3". */
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

export interface OwnPersonView {
  id: number;
  /** The account's family name, falling back to the person's display name. */
  name: string;
  personName: string;
  ia: boolean;
  treasuryCents: number;
  debtCents: number;
  favour: number;
  /** The prestige the screens show: title plus residence plus capped service. */
  prestige: number;
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

/** What the town knows about another person: their name and standing, not their purse. */
export interface PublicPersonView {
  id: number;
  name: string;
  ia: boolean;
  prestige: number;
  /**
   * The residence a person has reached. Public because the screen shows it on
   * the register of people; an event no longer tells the town when it grows,
   * since it is the buyer's own line.
   */
  residenceLevel: number;
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
  person: OwnPersonView;
  town: {
    id: number;
    name: string;
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
 * The client renders, it decides nothing: it gets its own person in full and the
 * rest of the town at the detail the town itself would show. The seed and other
 * people's treasuries never leave the server.
 */
export function projectWorld(
  town: TownInfo,
  world: World,
  personId: number,
  worldStartedAt: Date,
  familyName: string | null = null,
): WorldProjection {
  const person = world.people[personId];
  if (!person) {
    // The token points at a person the world no longer holds: a server bug, not
    // something to paper over with a made-up person.
    throw new Error(`world has no person ${personId}`);
  }

  // The hour belongs to the world, and the world is counted from its birth: the
  // real instant of an hour is the origin plus the hours before it.
  const hourStartedAt = hourStartedOf(worldStartedAt, world.hour);

  return {
    hour: world.hour,
    year: yearOf(world.hour),
    calendar: calendarOf(world, hourStartedAt),
    person: ownPerson(world, person, familyName),
    town: {
      id: town.id,
      name: town.name,
      people: Object.values(world.people)
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          ia: candidate.ia,
          prestige: displayedPrestige(candidate.prestige, titleOf(candidate), residenceOf(candidate)),
          residenceLevel: residenceOf(candidate),
        }))
        .sort((left, right) => left.id - right.id),
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

function ownPerson(world: World, person: Person, familyName: string | null): OwnPersonView {
  const level = residenceOf(person);
  const residence = RESIDENCE_LADDER[level - 1];
  const title = titleOf(person);
  const next = nextTitle(title);
  const servicePrestige = person.prestige;

  return {
    id: person.id,
    name: familyName !== null && familyName.trim() !== '' ? familyName : person.name,
    personName: person.name,
    ia: person.ia,
    treasuryCents: person.treasuryCents,
    debtCents: person.debtCents,
    favour: person.favour,
    prestige: displayedPrestige(servicePrestige, title, level),
    title,
    residenceLevel: level,
    ladder: {
      title,
      residence: residence.name,
      titlePrestige: TITLE_LADDER[title].prestige,
      residencePrestige: residence.prestige,
      servicePrestige: Math.min(servicePrestige, residence.prestigeCap),
      prestigeCap: residence.prestigeCap,
      workshops: residence.workshops,
      stockDefence: residence.stockDefence,
      workshopLevelCap: workshopLevelCap(title),
      nextTitle: next === undefined ? null : { title: next, priceCents: TITLE_LADDER[next].priceCents },
      nextResidence:
        level >= RESIDENCE_LADDER.length
          ? null
          : {
              level: level + 1,
              name: RESIDENCE_LADDER[level]!.name,
              priceCents: RESIDENCE_LADDER[level].priceCents,
              opened: level < TITLE_LADDER[title].residenceLevel,
              hours: RULES.improvementHours[level + 1] ?? RULES.siteHours,
            },
    },
    workshops: person.workshops.map((workshop) => {
      const chain = TRADE_CHAINS[workshop.trade];
      const outputUnitsPerHour = workshop.level * RULES.outputPerLevel;

      return {
        ...structuredClone(workshop),
        // The client names the workshop by what it makes, not by its trade.
        good: chain.output,
        input: chain.input,
        outputUnitsPerHour,
        inputUnitsPerHour: outputUnitsPerHour * RULES.inputPerOutput[workshop.trade],
        upkeepCentsPerHour: workshop.level * RULES.upkeepPerWorkshopLevelCents,
        capacityUnits: workshopCapacity(workshop.level),
        canUpgrade: workshop.level < workshopLevelCap(title),
        upgradeHours: RULES.improvementHours[workshop.level + 1] ?? null,
      };
    }),
    stock: structuredClone(person.stock),
    stockUnits: stockUnits(person),
    stockCapacityUnits: stockCapacityUnits(person),
    build: {
      priceCents: RULES.buildCents,
      hours: RULES.siteHours,
      level: RULES.builtWorkshopLevel,
      room: Math.max(0, workshopCap(level) - person.workshops.length - buildingCount(world, person.id, 'build')),
      cap: workshopCap(level),
    },
    sites: world.engagements.flatMap((engagement) =>
      engagement.kind === 'site' && engagement.personId === person.id
        ? [{ id: engagement.id, dueAt: engagement.dueAt, ...siteWorkOf(engagement) }]
        : [],
    ),
    rename: { priceCents: NAME_PRICE.renameCents },
  };
}

/** The sites of one kind a person has open: a build in progress counts on the cap. */
function buildingCount(world: World, personId: number, work: SiteWork['work']): number {
  return world.engagements.filter(
    (engagement) => engagement.kind === 'site' && engagement.personId === personId && engagement.work === work,
  ).length;
}

/** What a site is for, as the screen names it: a trade, a workshop, the person. */
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
