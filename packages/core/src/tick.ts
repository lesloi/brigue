import { drawBelow } from './prng.ts';
import {
  isValidName,
  nameIsTaken,
  nameKey,
  sanitizeName,
  type DynastyRenameOutcome,
  type DynastyRenameRequest,
} from './names.ts';
import type { Action, Event, EventDraft, RefusalReason } from './events.ts';
import {
  FORMAT_VERSION,
  GOODS,
  HOURS_PER_YEAR,
  nextTitle,
  PRICE_HISTORY_BELLS,
  residenceOf,
  RESIDENCE_LADDER,
  RULES,
  seatHolder,
  SEATS,
  START_YEAR,
  stockCapacityUnits,
  stockUnits,
  takeSeat,
  TITLE_LADDER,
  titleOf,
  TRADES,
  TRADE_CHAINS,
  workshopCap,
  workshopLevelCap,
  type Engagement,
  type GoodId,
  type Dynasty,
  type Person,
  type SeatId,
  type SiteWork,
  type Trade,
  type World,
} from './world.ts';

export interface TickResult {
  world: World;
  events: Event[];
}

export class WorldVersionError extends Error {
  readonly formatVersion: number;
  readonly rulesetVersion: number;

  constructor(world: World) {
    super(
      `world of format ${world.formatVersion} and ruleset ${world.rulesetVersion} cannot be ` +
        `read by format ${FORMAT_VERSION} and ruleset ${RULES.version}`,
    );
    this.name = 'WorldVersionError';
    this.formatVersion = world.formatVersion;
    this.rulesetVersion = world.rulesetVersion;
  }
}

/**
 * Advances the town to an hour, one hour at a time.
 *
 * Pure: the world passed in is never touched. Every hour is stepped in order,
 * so advancing three hours at once is exactly three advances of one — that is
 * what lets a late scheduler catch up without drifting.
 *
 * Actions are placed on the hour they play, and two actions of the same hour
 * keep the order they are given: the caller (the server) stores it, because two
 * different orders are two different towns.
 */
export function advance(world: World, until: number, actions: readonly PlacedAction[] = []): TickResult {
  if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
    throw new WorldVersionError(world);
  }

  const next = structuredClone(world);
  const events: Event[] = [];
  const byHour = new Map<number, Action[]>();

  for (const placed of actions) {
    const queued = byHour.get(placed.at);
    if (queued === undefined) {
      byHour.set(placed.at, [placed.action]);
    } else {
      queued.push(placed.action);
    }
  }

  while (next.hour <= until) {
    const at = next.hour;
    const drafts: EventDraft[] = [];
    step(next, byHour.get(at) ?? [], drafts);
    for (const draft of drafts) {
      events.push({ ...draft, at });
    }
  }

  return { world: next, events };
}

export interface PlacedAction {
  /** The town hour the action is applied on. */
  at: number;
  action: Action;
}

/** One hour of the town. Mutates `next`, which `advance` owns. */
function step(next: World, actions: readonly Action[], events: EventDraft[]): void {
  // The hour's own trade, good by good: sold minus bought. It is written on the
  // world once the hour is over, and prices the next bell.
  const flow = Object.fromEntries(GOODS.map((good) => [good, 0])) as Record<GoodId, number>;

  for (const candidate of actions as readonly unknown[]) {
    // A stored action can be anything: it went through a database and a JSON
    // parser. An unknown one is refused, never skipped, and never thrown.
    if (!isKnownAction(candidate)) {
      events.push({
        type: 'action.refused',
        audience: 'town',
        action: 'unknown',
        dynastyId: 'unknown',
        reason: 'unknown_action',
      });
      continue;
    }

    applyAction(next, candidate, events, flow);
  }

  // What fell due is paid before the hour's trade, so an engagement resolved in
  // the same hour as its last action already counts for that hour. Its lines
  // belong to the world, not to the week's trades: they are gathered apart and
  // placed after the actions that opened them.
  const town: EventDraft[] = [];
  resolveEngagements(next, town);

  // The AI dynasties decide in the same breath as the players, at the same price:
  // both buy before the hour moves the market. Their lines go with the town's.
  aiDynastiesBuy(next, flow, town);

  // Production, then the AI's sale, then upkeep: an AI pays its workshops from
  // the price it just took. The prices move at the bells only, so every trade of
  // the half-day happens at the price the players saw. Every line goes with the
  // town's, so no AI's trade interrupts the dynasty's own run.
  runWorkshops(next, town);
  aiDynastiesSell(next, flow, town);
  payUpkeep(next, town);

  // At the start of the year, before the noon bell closes the candidacies, an
  // AI dynasty without a seat looks for a vacant one.
  if (next.hour % HOURS_PER_YEAR === 1) {
    aiDynastiesCampaign(next, town);
  }

  const bell = next.hour % (HOURS_PER_YEAR / 2) === 0;

  // The flow accumulates over the half-day: the bell prices the town's whole
  // trade, not the last hour of it.
  for (const good of GOODS) {
    next.marketFlow[good] = (next.marketFlow[good] ?? 0) + flow[good];
  }

  if (bell) {
    driftPrices(next, town);
  }

  // Noon closes the candidacies: what is in the open map counts tonight, what
  // is lodged after the bell waits for the next scrutiny.
  if (next.hour % HOURS_PER_YEAR === HOURS_PER_YEAR / 2) {
    next.closedCampaigns = next.campaigns;
    next.campaigns = {};
  }

  // The scrutiny closes the year: every seat is up, once a day, and everyone
  // present ages a year.
  if (next.hour % HOURS_PER_YEAR === 0) {
    holdScrutiny(next, town);
  }

  // The hour reads as it was written: what the dynasty asked and got, then what
  // the town did with it. A reader looking for their own line finds it first.
  events.push(...town);

  next.hour += 1;
  next.year = START_YEAR + Math.floor((next.hour - 1) / HOURS_PER_YEAR);
}

function isKnownAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return (
    type === 'market.buy' ||
    type === 'market.sell' ||
    type === 'council.campaign' ||
    type === 'workshop.build' ||
    type === 'workshop.destroy' ||
    type === 'workshop.upgrade' ||
    type === 'dynasty.buy_title' ||
    type === 'dynasty.upgrade_residence'
  );
}

/** A stored action's trade came through the same database and parser. */
function isKnownTrade(trade: unknown): trade is Trade {
  return typeof trade === 'string' && (TRADES as readonly string[]).includes(trade);
}

/** A stored action's good went through a database and a JSON parser too. */
function isKnownGood(good: unknown): good is GoodId {
  return typeof good === 'string' && (GOODS as readonly string[]).includes(good);
}

function refuse(
  events: EventDraft[],
  action: Action,
  dynastyId: unknown,
  reason: RefusalReason,
  knownDynasty: boolean,
): void {
  const id = typeof dynastyId === 'string' && dynastyId.length > 0 ? dynastyId : 'unknown';

  events.push({
    type: 'action.refused',
    // A dynasty's own refusal is its business; one naming a dynasty the town no
    // longer holds has no reader but the town.
    audience: knownDynasty ? { dynastyId: id } : 'town',
    action: action.type,
    dynastyId: id,
    reason,
  });
}

function applyAction(world: World, action: Action, events: EventDraft[], flow: Record<GoodId, number>): void {
  const dynasty = world.dynasties[action.dynastyId];
  if (!dynasty) {
    refuse(events, action, action.dynastyId, 'unknown_dynasty', false);
    return;
  }

  if (dynasty.dormant) {
    refuse(events, action, dynasty.id, 'dormant_dynasty', true);
    return;
  }

  // A degree or a residence level is bought once: two purchases for the same
  // next object would charge twice and deliver once, since the works of the
  // first already opens the second.
  if (action.type === 'dynasty.buy_title' && sitesOf(world, dynasty.id, 'title') > 0) {
    refuse(events, action, dynasty.id, 'site_in_progress', true);
    return;
  }
  if (action.type === 'dynasty.upgrade_residence' && sitesOf(world, dynasty.id, 'residence') > 0) {
    refuse(events, action, dynasty.id, 'site_in_progress', true);
    return;
  }

  // A site already under way cannot be doubled: the dynasty has one builder, and
  // two sites of one kind would race for the same workshop or the same degree.
  const building = world.engagements.some(
    (engagement) => engagement.kind === 'site' && engagement.dynastyId === dynasty.id,
  );
  if (building && action.type !== 'market.buy' && action.type !== 'market.sell' && action.type !== 'council.campaign') {
    refuse(events, action, dynasty.id, 'site_in_progress', true);
    return;
  }

  switch (action.type) {
    case 'market.buy': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, dynasty.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, dynasty.id, 'invalid_quantity', true);
        return;
      }

      const priceCents = world.market[action.good];
      const totalCents = priceCents * action.units;
      if (dynasty.treasuryCents < totalCents) {
        refuse(events, action, dynasty.id, 'insufficient_funds', true);
        return;
      }
      // The warehouse is one capacity for all goods, and a purchase is atomic:
      // it is refused whole, never trimmed to what would fit.
      if (stockUnits(dynasty) + action.units > stockCapacityUnits(dynasty)) {
        refuse(events, action, dynasty.id, 'stock_full', true);
        return;
      }

      dynasty.treasuryCents -= totalCents;
      dynasty.stock[action.good] = (dynasty.stock[action.good] ?? 0) + action.units;
      flow[action.good] -= action.units;
      events.push({
        type: 'market.bought',
        audience: 'town',
        dynastyId: dynasty.id,
        good: action.good,
        units: action.units,
        priceCents,
        totalCents,
      });
      return;
    }

    case 'market.sell': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, dynasty.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, dynasty.id, 'invalid_quantity', true);
        return;
      }

      const held = dynasty.stock[action.good] ?? 0;
      if (held < action.units) {
        refuse(events, action, dynasty.id, 'insufficient_stock', true);
        return;
      }

      const priceCents = world.market[action.good];
      const revenueCents = priceCents * action.units;
      dynasty.treasuryCents += revenueCents;
      const left = held - action.units;
      if (left === 0) {
        delete dynasty.stock[action.good];
      } else {
        dynasty.stock[action.good] = left;
      }
      flow[action.good] += action.units;
      events.push({
        type: 'market.sold',
        audience: 'town',
        dynastyId: dynasty.id,
        good: action.good,
        units: action.units,
        priceCents,
        revenueCents,
      });
      return;
    }

    case 'council.campaign': {
      if (!(action.seatId in world.seats)) {
        refuse(events, action, dynasty.id, 'unknown_seat', true);
        return;
      }
      // One candidacy at a time: another open campaign, on this seat or another,
      // is refused before it can spend any favour.
      if (Object.values(world.campaigns).some((seat) => seat[dynasty.id] !== undefined)) {
        refuse(events, action, dynasty.id, 'already_candidate', true);
        return;
      }
      if (dynasty.favour < RULES.campaignFavourCost) {
        refuse(events, action, dynasty.id, 'insufficient_favour', true);
        return;
      }

      dynasty.favour -= RULES.campaignFavourCost;

      // A candidacy has no run behind it: it is lodged, and the noon bell
      // decides which scrutiny it counts for. The event says which, so the
      // screen can tell the player what they bought.
      const countsAt = countsAtFor(world);

      const seat = (world.campaigns[action.seatId] ??= {});
      seat[dynasty.id] = (seat[dynasty.id] ?? 0) + RULES.campaignVoteBonus;

      events.push({
        type: 'council.campaigned',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        seatId: action.seatId,
        favourSpent: RULES.campaignFavourCost,
        countsAt,
      });
      return;
    }

    case 'workshop.build': {
      if (!isKnownTrade(action.trade)) {
        refuse(events, action, dynasty.id, 'unknown_trade', true);
        return;
      }
      // The residence counts the sites as well as the buildings: two builds in
      // two hours must not slip past a cap of one.
      if (dynasty.workshops.length + sitesOf(world, dynasty.id, 'build') >= workshopCap(dynasty)) {
        refuse(events, action, dynasty.id, 'workshop_cap', true);
        return;
      }
      if (dynasty.treasuryCents < RULES.buildCents) {
        refuse(events, action, dynasty.id, 'insufficient_funds', true);
        return;
      }

      dynasty.treasuryCents -= RULES.buildCents;
      openSite(world, dynasty.id, { work: 'build', trade: action.trade }, RULES.siteHours, events);
      return;
    }

    case 'workshop.destroy': {
      const workshop = findWorkshop(dynasty, action.workshopId);
      if (workshop === undefined) {
        refuse(events, action, dynasty.id, 'unknown_workshop', true);
        return;
      }
      // The last workshop is the dynasty's livelihood: destroying it would leave
      // a dynasty that can neither produce nor rebuild. It is refused, not sold.
      if (dynasty.workshops.length <= 1) {
        refuse(events, action, dynasty.id, 'last_workshop', true);
        return;
      }

      dynasty.workshops = dynasty.workshops.filter((candidate) => candidate.id !== workshop.id);
      // Nothing is refunded, and the warehouse keeps its goods: a stock over the
      // new capacity is sold down, never confiscated.
      events.push({
        type: 'workshop.destroyed',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        workshopId: workshop.id,
        good: workshop.good,
      });
      return;
    }

    case 'workshop.upgrade': {
      const workshop = findWorkshop(dynasty, action.workshopId);
      if (workshop === undefined) {
        refuse(events, action, dynasty.id, 'unknown_workshop', true);
        return;
      }
      const target = workshop.level + 1;
      if (target > workshopLevelCap(dynasty) || target > RULES.improvementHours.length - 1) {
        refuse(events, action, dynasty.id, 'level_cap', true);
        return;
      }

      // An improvement costs hours, never money: the level is the work itself.
      openSite(world, dynasty.id, { work: 'upgrade', workshopId: workshop.id }, improvementHours(target), events);
      return;
    }

    case 'dynasty.buy_title': {
      const next = nextTitle(titleOf(dynasty));
      if (next === undefined) {
        refuse(events, action, dynasty.id, 'no_next_title', true);
        return;
      }
      const price = TITLE_LADDER[next].priceCents;
      if (dynasty.treasuryCents < price) {
        refuse(events, action, dynasty.id, 'insufficient_funds', true);
        return;
      }

      dynasty.treasuryCents -= price;
      // A degree is obtained at the next noon or midnight, whatever the hour of
      // the purchase: the half-day is the calendar's, not a second clock.
      const dueAt = nextBellAfter(world.hour, RULES.titleHours);
      openSite(world, dynasty.id, { work: 'title' }, dueAt - world.hour, events);
      events.push({ type: 'dynasty.title_bought', audience: 'town', dynastyId: dynasty.id, title: next });
      return;
    }

    case 'dynasty.upgrade_residence': {
      const target = residenceOf(dynasty) + 1;
      const opened = TITLE_LADDER[titleOf(dynasty)].residenceLevel;
      if (target > RESIDENCE_LADDER.length) {
        refuse(events, action, dynasty.id, 'no_next_residence', true);
        return;
      }
      // The title opens the level, money pays for it: a dynasty below its degree
      // buys up to what the degree opened, and no further.
      if (target > opened) {
        refuse(events, action, dynasty.id, 'title_open', true);
        return;
      }
      const price = RESIDENCE_LADDER[target - 1].priceCents;
      if (dynasty.treasuryCents < price) {
        refuse(events, action, dynasty.id, 'insufficient_funds', true);
        return;
      }

      dynasty.treasuryCents -= price;
      openSite(world, dynasty.id, { work: 'residence' }, improvementHours(target), events);
      return;
    }
  }
}

/** A stored workshop id went through the parser too: only a string names one. */
function findWorkshop(dynasty: Dynasty, workshopId: unknown) {
  if (typeof workshopId !== 'string') {
    return undefined;
  }

  return dynasty.workshops.find((candidate) => candidate.id === workshopId);
}

/** The workshops a dynasty has open: not under an improvement, which stops it. */
function openWorkshops(world: World, dynasty: Dynasty) {
  const closed = new Set(
    world.engagements.flatMap((engagement) =>
      engagement.kind === 'site' && engagement.dynastyId === dynasty.id && engagement.work === 'upgrade'
        ? [engagement.workshopId]
        : [],
    ),
  );

  return dynasty.workshops.filter((workshop) => !closed.has(workshop.id));
}

/** The sites a dynasty has under way of one kind. */
function sitesOf(world: World, dynastyId: string, work: SiteWork['work']): number {
  return world.engagements.filter(
    (engagement) => engagement.kind === 'site' && engagement.dynastyId === dynastyId && engagement.work === work,
  ).length;
}

function openSite(world: World, dynastyId: string, work: SiteWork, hours: number, events: EventDraft[]): void {
  world.engagementSeq += 1;
  const engagement = {
    id: `engagement-${world.engagementSeq}`,
    kind: 'site' as const,
    dynastyId,
    dueAt: world.hour + hours,
    ...work,
  };
  world.engagements.push(engagement);
  events.push({
    type: 'engagement.opened',
    audience: { dynastyId },
    engagementId: engagement.id,
    kind: 'site',
    dynastyId,
    dueAt: engagement.dueAt,
  });
}

/** The improvement takes at least the title's half-day, and lands on a bell. */
function improvementHours(level: number): number {
  return RULES.improvementHours[Math.min(level, RULES.improvementHours.length - 1)] ?? RULES.siteHours;
}

function nextBellAfter(hour: number, minHours: number): number {
  const target = hour + minHours;
  const half = HOURS_PER_YEAR / 2;

  return Math.ceil(target / half) * half;
}

export const NAME_MAX_LENGTH = 24;

/**
 * The dynasty takes the name, and its living people take it with it: a dynasty's
 * people carry its name, and the dead keep the one they died with.
 *
 * The one way a name is given, at creation as on a rename: the checks come
 * first and a refusal changes nothing, so a caller never has to undo a charge.
 * A refusal is an answer, never a throw — the route turns it into a 409 and the
 * screen into a sentence.
 */
export function renameDynasty(world: World, dynasty: Dynasty, request: DynastyRenameRequest): DynastyRenameOutcome {
  const name = sanitizeName(request.name);

  if (!isValidName(name)) {
    return { ok: false, reason: 'invalid_name' };
  }
  // The town's own dynasties, the AI ones included: two Carons would make its
  // register unreadable, and the suggestion never draws an AI name for that.
  if (nameIsTaken(dynastiesOf(world, dynasty.id), name)) {
    return { ok: false, reason: 'name_taken' };
  }
  // Only a human dynasty is held to the server-wide rule: the AI ones carry the
  // same names in every town, and only a human dynasty is ranked by name.
  if (request.takenElsewhere?.has(nameKey(name)) === true) {
    return { ok: false, reason: 'name_taken' };
  }
  if (dynasty.treasuryCents < request.priceCents) {
    return { ok: false, reason: 'insufficient_funds' };
  }

  const before = dynasty.name;
  dynasty.treasuryCents -= request.priceCents;
  dynasty.name = name;

  for (const person of Object.values(world.people)) {
    if (person.dynastyId === dynasty.id && person.alive) {
      person.name = renamePerson(person.name, before, name);
    }
  }

  return { ok: true, name };
}

/** A journal line for a name given after the creation; the creation writes none. */
export function dynastyRenamed(dynasty: Dynasty, before: string): EventDraft {
  return { type: 'dynasty.renamed', audience: 'town', dynastyId: dynasty.id, before, after: dynasty.name };
}

/** The names of the town's dynasties, the renamed one aside. */
function dynastiesOf(world: World, exceptDynastyId: string): string[] {
  return Object.values(world.dynasties)
    .filter((dynasty) => dynasty.id !== exceptDynastyId)
    .map((dynasty) => dynasty.name);
}

/** `Colin Leclerc` becomes `Colin Moreau`: the given name stays, the dynasty moves. */
export function renamePerson(personName: string, before: string, after: string): string {
  const witness = personName.endsWith(before) ? personName.slice(0, personName.length - before.length) : '';

  return witness === '' ? after : `${witness}${after}`;
}

export interface PriceInput {
  priceCents: number;
  referenceCents: number;
  /** What the town takes of that good at the reference price. */
  absorbedUnits: number;
  /** The imbalance that moves the price by a tenth of the reference. */
  scaleUnits: number;
  /**
   * Net units the town put on the market last hour: sold minus bought.
   * Undefined when the world has no hour behind it, or none for that good: the
   * market then has no imbalance to price.
   */
  flowUnits?: number;
  /** This hour's random drift, already drawn. */
  driftCents: number;
  /** The imbalance, in scales, that moves the price by a tenth of the reference. */
  pressureDivisor: number;
  /** How many hours the gap back to the reference takes to close. */
  reversionDivisor: number;
  floorCents: number;
  ceilCents: number;
}

/**
 * The rule of the price, in whole cents.
 *
 * A hour's imbalance moves the price by a tenth of the reference per scale, and
 * the price closes a fixed share of its gap back to the reference every hour, so
 * a shock fades instead of becoming the new normal. Both terms are integer
 * divisions: a price is never a fraction, and the same world replays the same.
 *
 * Every number the rule needs comes in the input: this is the rule, and reading
 * it should not send you to another file.
 */
export function nextPriceCents(input: PriceInput): number {
  const scale = Math.max(1, input.scaleUnits);
  const imbalance = input.flowUnits === undefined ? 0 : input.flowUnits - input.absorbedUnits;
  const pressure = -Math.trunc((imbalance * input.referenceCents) / (input.pressureDivisor * scale));
  const pull = Math.trunc((input.referenceCents - input.priceCents) / input.reversionDivisor);

  return clamp(input.priceCents + input.driftCents + pressure + pull, input.floorCents, input.ceilCents);
}

/**
 * The other dynasties are not puppets: an AI dynasty buys the input its workshops
 * lack, at the hour's price, as far as its purse goes, and decides nothing
 * else. It is not an action, so a dynasty that cannot pay produces no refusal:
 * its workshop simply idles, which `runWorkshops` reports.
 *
 * No margin check on purpose. A guard that stops buying once the input costs
 * more than the output makes the AI's demand switch on and off with a one-hour
 * lag, and the price saws. The price is the guard.
 */
function aiDynastiesBuy(world: World, flow: Record<GoodId, number>, events: EventDraft[]): void {
  for (const dynastyId of Object.keys(world.dynasties).sort()) {
    const dynasty = world.dynasties[dynastyId];

    if (dynasty.controller !== 'ai' || dynasty.dormant) {
      continue;
    }

    // A workshop under improvement buys nothing: it will not eat until its
    // site is closed, and an AI that stocked for it would overflow the loft.
    for (const workshop of openWorkshops(world, dynasty)) {
      const recipe = RULES.recipes[workshop.good];

      if (recipe === null) {
        continue;
      }

      const wanted = workshop.level * RULES.outputPerLevel;
      const shortfall = wanted * recipe.perUnit - (dynasty.stock[recipe.input] ?? 0);

      if (shortfall <= 0) {
        continue;
      }

      const priceCents = world.market[recipe.input];
      const affordable = Math.floor(dynasty.treasuryCents / priceCents);
      const room = stockCapacityUnits(dynasty) - stockUnits(dynasty);
      const units = Math.min(shortfall, affordable, room);

      if (units <= 0) {
        continue;
      }

      dynasty.treasuryCents -= units * priceCents;
      dynasty.stock[recipe.input] = (dynasty.stock[recipe.input] ?? 0) + units;
      flow[recipe.input] -= units;
      events.push({
        type: 'market.bought',
        audience: 'town',
        dynastyId: dynasty.id,
        good: recipe.input,
        units,
        priceCents,
        totalCents: units * priceCents,
      });
    }
  }
}

function driftPrices(world: World, events: EventDraft[]): void {
  // A world stored before the history existed starts its record at this bell.
  world.marketHistory ??= {};

  // The constants are per hour; a bell prices a whole half-day of trade, so the
  // scale it is measured against is the half-day's.
  const hours = HOURS_PER_YEAR / 2;

  for (const good of GOODS) {
    const [rng, roll] = drawBelow(world.rng, RULES.priceDriftCents * 2 + 1);
    world.rng = rng;

    const before = world.market[good];
    // The raw goods are bought at the market: their price is not moved by the
    // town's flow, only by chance and the pull home.
    const raw = RULES.recipes[good] === null;
    const after = nextPriceCents({
      priceCents: before,
      referenceCents: RULES.market[good].referenceCents,
      absorbedUnits: RULES.market[good].absorbedUnits * hours,
      scaleUnits: RULES.market[good].scaleUnits * hours,
      flowUnits: raw ? undefined : world.marketFlow[good],
      driftCents: roll - RULES.priceDriftCents,
      pressureDivisor: RULES.pricePressureDivisor,
      reversionDivisor: RULES.priceReversionDivisor,
      floorCents: RULES.priceFloorCents,
      ceilCents: RULES.priceCeilCents,
    });

    if (after !== before) {
      world.market[good] = after;
      events.push({ type: 'market.price_changed', audience: 'town', good, before, after });
    }

    // One point per bell even when the price holds: the chart must not skip a
    // quiet bell, or two changes would look adjacent.
    const history = (world.marketHistory[good] ??= []);
    history.push(after);
    if (history.length > PRICE_HISTORY_BELLS) {
      history.splice(0, history.length - PRICE_HISTORY_BELLS);
    }
  }

  // The bell closes the period: the next one starts from zero.
  world.marketFlow = {};
}

function runWorkshops(world: World, events: EventDraft[]): void {
  for (const dynastyId of Object.keys(world.dynasties).sort()) {
    const dynasty = world.dynasties[dynastyId];

    // A dormant dynasty runs nothing: the workshop is idle, the stock is still a
    // target, and its money is untouched. Wages are part of running it.
    if (dynasty.dormant) {
      continue;
    }

    // A workshop under improvement is a building site: it makes nothing, and
    // the upkeep it does not pay is the cost of the hours it takes.
    for (const workshop of openWorkshops(world, dynasty)) {
      const wanted = workshop.level * RULES.outputPerLevel;
      const recipe = RULES.recipes[workshop.good];
      const available = recipe ? (dynasty.stock[recipe.input] ?? 0) : Number.POSITIVE_INFINITY;
      const makeable = recipe ? Math.min(wanted, Math.floor(available / recipe.perUnit)) : wanted;

      if (recipe && makeable < wanted) {
        events.push({
          type: 'workshop.idle',
          audience: { dynastyId: dynasty.id },
          dynastyId: dynasty.id,
          good: workshop.good,
          input: recipe.input,
          missingUnits: wanted - makeable,
        });
      }
      if (makeable === 0) {
        continue;
      }

      // A recipe moves units from one good to another; a raw workshop creates
      // them out of nothing. Both must stop at the warehouse's cap, and the
      // units that do not fit are refused with an event, never dropped.
      const netPerUnit = 1 - (recipe?.perUnit ?? 0);
      const room = stockCapacityUnits(dynasty) - stockUnits(dynasty);
      const units = netPerUnit <= 0 ? makeable : Math.min(makeable, Math.floor(Math.max(0, room) / netPerUnit));

      if (units < makeable) {
        events.push({
          type: 'workshop.overflow',
          audience: { dynastyId: dynasty.id },
          dynastyId: dynasty.id,
          good: workshop.good,
          refusedUnits: makeable - units,
        });
      }
      if (units === 0) {
        continue;
      }

      if (recipe) {
        const left = available - units * recipe.perUnit;
        if (left === 0) {
          delete dynasty.stock[recipe.input];
        } else {
          dynasty.stock[recipe.input] = left;
        }
      }

      // Production credits the warehouse, never the purse: the sale is a
      // separate action, at the hour's price.
      dynasty.stock[workshop.good] = (dynasty.stock[workshop.good] ?? 0) + units;
      events.push({
        type: 'workshop.produced',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        good: workshop.good,
        units,
      });
    }
  }
}

/**
 * The AI takes the price and does not time it: every hour it sells whatever
 * its workshops left in the warehouse, at the hour's price. A human dynasty
 * keeps its stock, because holding for a better hour is the player's bet; a
 * dormant dynasty keeps everything it had.
 */
function aiDynastiesSell(world: World, flow: Record<GoodId, number>, events: EventDraft[]): void {
  for (const dynastyId of Object.keys(world.dynasties).sort()) {
    const dynasty = world.dynasties[dynastyId];

    if (dynasty.controller !== 'ai' || dynasty.dormant) {
      continue;
    }

    for (const good of GOODS) {
      const units = dynasty.stock[good] ?? 0;
      if (units <= 0) {
        continue;
      }

      const priceCents = world.market[good];
      const revenueCents = units * priceCents;
      dynasty.treasuryCents += revenueCents;
      delete dynasty.stock[good];
      flow[good] += units;
      events.push({
        type: 'market.sold',
        audience: 'town',
        dynastyId: dynasty.id,
        good,
        units,
        priceCents,
        revenueCents,
      });
    }
  }
}

/**
 * The upkeep of a workshop is one level's share, paid for every workshop that is
 * not under construction or improvement: a site stops the building, and it
 * stops what the building costs to run. Come after the AI's sale, so a dynasty
 * pays from the price it just took.
 */
function payUpkeep(world: World, events: EventDraft[]): void {
  for (const dynastyId of Object.keys(world.dynasties).sort()) {
    const dynasty = world.dynasties[dynastyId];

    if (dynasty.dormant) {
      continue;
    }

    const building = new Set(
      world.engagements.flatMap((engagement) =>
        engagement.kind === 'site' && engagement.dynastyId === dynastyId && engagement.work === 'upgrade'
          ? [engagement.workshopId]
          : [],
      ),
    );
    const levels = dynasty.workshops
      .filter((workshop) => !building.has(workshop.id))
      .reduce((total, workshop) => total + workshop.level, 0);

    upkeepIsPaid(dynastyId, dynasty, levels * RULES.upkeepPerWorkshopLevelCents, events);
  }
}

function upkeepIsPaid(dynastyId: string, dynasty: Dynasty, upkeep: number, events: EventDraft[]): void {
  if (upkeep > 0) {
    const paid = Math.min(dynasty.treasuryCents, upkeep);
    dynasty.treasuryCents -= paid;

    if (paid > 0) {
      events.push({ type: 'dynasty.upkeep_paid', audience: { dynastyId }, dynastyId, amountCents: paid });
    }
    if (paid < upkeep) {
      const shortfallCents = upkeep - paid;
      dynasty.debtCents += shortfallCents;
      events.push({ type: 'dynasty.penniless', audience: { dynastyId }, dynastyId, shortfallCents });
    }
  }

  if (dynasty.debtCents > 0 && dynasty.treasuryCents > 0) {
    const repaid = Math.min(dynasty.treasuryCents, dynasty.debtCents);
    dynasty.treasuryCents -= repaid;
    dynasty.debtCents -= repaid;
    events.push({ type: 'dynasty.debt_repaid', audience: { dynastyId }, dynastyId, amountCents: repaid });
  }
}

/**
 * Pays every engagement whose due hour has arrived. A hour the catch-up never
 * simulated does not drop it: the town's hour counter is the only clock, so an
 * engagement behind it is resolved by the next tick that runs, and the event
 * carries both the hour it was due and the hour it was paid.
 */
function resolveEngagements(world: World, events: EventDraft[]): void {
  const due = world.engagements
    .filter((engagement) => engagement.dueAt <= world.hour)
    .sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id));

  if (due.length === 0) {
    return;
  }

  // A dormant dynasty plays nothing, its sites included: what fell due for it
  // stays in the world and resolves at the visit that wakes it. The cost was
  // paid, and the journal must not claim a work done that never was.
  const waiting = due.filter(
    (engagement) =>
      engagement.kind === 'site' &&
      (world.dynasties[engagement.dynastyId] === undefined || world.dynasties[engagement.dynastyId]?.dormant === true),
  );
  world.engagements = world.engagements.filter(
    (engagement) => engagement.dueAt > world.hour || waiting.includes(engagement),
  );

  for (const engagement of due) {
    if (waiting.includes(engagement)) {
      continue;
    }

    events.push({
      type: 'engagement.resolved',
      audience: 'town',
      engagementId: engagement.id,
      kind: engagement.kind,
      dynastyId: engagement.dynastyId,
      dueAt: engagement.dueAt,
      resolvedAt: world.hour,
    });

    if (engagement.kind === 'site') {
      completeSite(world, engagement, events);
    }
  }
}

/**
 * What a site was opened for. The dynasty or the workshop can be gone — destroyed,
 * converted, the dynasty deleted — so every step is a check, never a throw: the
 * cost was paid when the site was opened, and a site that outlived its object
 * has nothing left to finish.
 */
function completeSite(world: World, site: Extract<Engagement, { kind: 'site' }>, events: EventDraft[]): void {
  const dynasty = world.dynasties[site.dynastyId];
  if (dynasty === undefined) {
    return;
  }

  switch (site.work) {
    case 'build': {
      if (dynasty.workshops.length >= workshopCap(dynasty)) {
        events.push({
          type: 'workshop.build_lost',
          audience: { dynastyId: dynasty.id },
          dynastyId: dynasty.id,
          trade: site.trade,
          paidCents: RULES.buildCents,
        });
        return;
      }
      world.workshopSeq = (world.workshopSeq ?? highestWorkshopSeq(world)) + 1;
      const workshop = {
        id: `workshop-${world.workshopSeq}`,
        good: TRADE_CHAINS[site.trade].output,
        level: RULES.builtWorkshopLevel,
      };
      dynasty.workshops.push(workshop);
      events.push({
        type: 'workshop.built',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        workshopId: workshop.id,
        trade: site.trade,
      });
      return;
    }
    case 'upgrade': {
      const workshop = dynasty.workshops.find((candidate) => candidate.id === site.workshopId);
      if (workshop === undefined) {
        return;
      }
      workshop.level += 1;
      events.push({
        type: 'workshop.upgraded',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        workshopId: workshop.id,
        level: workshop.level,
      });
      return;
    }
    case 'residence': {
      const level = Math.min(residenceOf(dynasty) + 1, TITLE_LADDER[titleOf(dynasty)].residenceLevel);
      dynasty.residenceLevel = level;
      events.push({
        type: 'dynasty.residence_received',
        audience: { dynastyId: dynasty.id },
        dynastyId: dynasty.id,
        level,
        dueAt: site.dueAt,
        resolvedAt: world.hour,
      });
      return;
    }
    case 'title': {
      const next = nextTitle(titleOf(dynasty));
      if (next === undefined) {
        return;
      }
      dynasty.title = next;
      // The residence never exceeds what the new degree opens: buying a degree
      // below a residence already paid for leaves the residence where it is.
      if (residenceOf(dynasty) > TITLE_LADDER[next].residenceLevel) {
        dynasty.residenceLevel = TITLE_LADDER[next].residenceLevel;
      }
      events.push({
        type: 'dynasty.title_received',
        audience: 'town',
        dynastyId: dynasty.id,
        title: next,
        dueAt: site.dueAt,
        resolvedAt: world.hour,
      });
    }
  }
}

/** A world stored without the counter still numbers its workshops in one run. */
function highestWorkshopSeq(world: World): number {
  let highest = 0;
  for (const dynasty of Object.values(world.dynasties)) {
    for (const workshop of dynasty.workshops) {
      const drawn = Number(workshop.id.replace(/^workshop-/, ''));
      if (Number.isInteger(drawn)) {
        highest = Math.max(highest, drawn);
      }
    }
  }

  return highest;
}

function holdScrutiny(world: World, events: EventDraft[]): void {
  // Age belongs to the calendar: every living person takes a year at the
  // scrutiny, whatever they did with it. The death roll is #7.
  for (const person of Object.values(world.people)) {
    if (person.alive) {
      person.age += 1;
    }
  }

  const elections: EventDraft[] = [];
  // One person, one office: a person already elected during this scrutiny is
  // not a candidate for another seat on the same day. A town too small to fill
  // every seat leaves one vacant rather than electing the same person twice.
  const electedPersonIds = new Set<string>();
  for (const seatId of SEATS) {
    contestSeat(world, seatId, elections, electedPersonIds);
  }

  events.push(...elections);
}

/** The scrutiny a candidacy lodged now counts for: the coming one before noon, the next after. */
function countsAtFor(world: World): number {
  const localHour = ((world.hour - 1) % HOURS_PER_YEAR) + 1;
  const scrutiny = Math.ceil(world.hour / HOURS_PER_YEAR) * HOURS_PER_YEAR;

  return localHour <= HOURS_PER_YEAR / 2 ? scrutiny : scrutiny + HOURS_PER_YEAR;
}

/**
 * At the first hour of a year, an AI dynasty that holds no seat and can pay
 * tries a random vacant seat. A seated AI is the incumbent and defends it; the
 * climb waits for #55.
 */
function aiDynastiesCampaign(world: World, events: EventDraft[]): void {
  const seated = new Set<string>();
  for (const seatId of SEATS) {
    const person = seatHolder(world, seatId);
    if (person !== undefined) {
      seated.add(person.dynastyId);
    }
  }

  const dynasties = Object.keys(world.dynasties)
    .filter((dynastyId) => {
      const dynasty = world.dynasties[dynastyId];

      return dynasty.controller === 'ai' && dynasty.dormant !== true && !seated.has(dynastyId);
    })
    .sort();

  for (const dynastyId of dynasties) {
    const dynasty = world.dynasties[dynastyId];
    const vacant = SEATS.filter((seatId) => world.seats[seatId].personId === null);
    if (dynasty.favour < RULES.campaignFavourCost || vacant.length === 0) {
      continue;
    }

    const [rng, roll] = drawBelow(world.rng, vacant.length);
    world.rng = rng;
    const seatId = vacant[roll] as SeatId;

    dynasty.favour -= RULES.campaignFavourCost;
    const seat = (world.campaigns[seatId] ??= {});
    seat[dynastyId] = (seat[dynastyId] ?? 0) + RULES.campaignVoteBonus;

    events.push({
      type: 'council.campaigned',
      audience: { dynastyId },
      dynastyId,
      seatId,
      favourSpent: RULES.campaignFavourCost,
      countsAt: countsAtFor(world),
    });
  }
}

function contestSeat(world: World, seatId: SeatId, events: EventDraft[], electedPersonIds: Set<string>): void {
  const campaigns = world.closedCampaigns[seatId] ?? {};
  const incumbent = seatHolder(world, seatId);
  const incumbentDynastyId = incumbent?.dynastyId;

  // A candidate is a dynasty that stood (an open campaign, now closed at noon)
  // and is still able to run, plus the active incumbent. A dormant dynasty
  // neither stands nor is defended: with nobody to take its seat, the seat
  // falls vacant.
  const candidateIds = [
    ...new Set([
      ...Object.keys(campaigns).filter((dynastyId) => {
        const dynasty = world.dynasties[dynastyId];

        return dynasty !== undefined && dynasty.dormant !== true && livingPersonOf(world, dynastyId) !== undefined;
      }),
      ...(incumbentDynastyId !== undefined &&
      world.dynasties[incumbentDynastyId]?.dormant !== true &&
      livingPersonOf(world, incumbentDynastyId) !== undefined
        ? [incumbentDynastyId]
        : []),
    ]),
  ]
    .filter((dynastyId) => {
      const person = livingPersonOf(world, dynastyId);

      return person !== undefined && !electedPersonIds.has(person.id);
    })
    .sort();

  if (candidateIds.length === 0) {
    const wasHeld = world.seats[seatId].personId !== null;
    world.seats[seatId] = { personId: null };
    delete world.closedCampaigns[seatId];

    if (wasHeld) {
      events.push({ type: 'council.election_held', audience: 'town', seatId, winnerDynastyId: null, votes: {} });
    }
    return;
  }

  const votes: Record<string, number> = {};
  for (const dynastyId of candidateIds) {
    const [rng, roll] = drawBelow(world.rng, 5);
    world.rng = rng;
    votes[dynastyId] = roll + 1 + (campaigns[dynastyId] ?? 0);
  }

  // Highest vote wins; a tie goes to the dynasty that comes first by id, so the
  // result never depends on the order of the object.
  const winnerDynastyId = candidateIds.reduce((best, dynastyId) => (votes[dynastyId] > votes[best] ? dynastyId : best));
  const winner = livingPersonOf(world, winnerDynastyId);
  const changed = winnerDynastyId !== incumbentDynastyId;

  if (winner !== undefined) {
    // Take the new seat before giving up the old ones: a refused assignment
    // must not leave the winner with nowhere to sit.
    const assignment = takeSeat(world, winnerDynastyId, winner.id);

    if (assignment.ok) {
      // One office per person: the winner gives up every other seat, and each
      // seat it leaves is a public vacancy, even when that seat was already
      // settled earlier in this scrutiny.
      for (const otherSeatId of SEATS) {
        if (otherSeatId !== seatId && world.seats[otherSeatId].personId === winner.id) {
          world.seats[otherSeatId] = { personId: null };
          events.push({
            type: 'council.election_held',
            audience: 'town',
            seatId: otherSeatId,
            winnerDynastyId: null,
            votes: {},
          });
        }
      }

      world.seats[seatId] = assignment.seat;
      electedPersonIds.add(winner.id);
    }
  }
  delete world.closedCampaigns[seatId];

  if (changed) {
    events.push({ type: 'council.election_held', audience: 'town', seatId, winnerDynastyId, votes });
  }

  // Every candidate learns the result, whether the town sees a change or not.
  for (const dynastyId of candidateIds) {
    events.push({
      type: 'council.election_result',
      audience: { dynastyId },
      dynastyId,
      seatId,
      won: dynastyId === winnerDynastyId,
      winnerDynastyId,
      votes,
    });
  }
}

/** The first living person of a dynasty by id, so a choice never depends on object order. */
function livingPersonOf(world: World, dynastyId: string): Person | undefined {
  return Object.values(world.people)
    .filter((person) => person.dynastyId === dynastyId && person.alive)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
