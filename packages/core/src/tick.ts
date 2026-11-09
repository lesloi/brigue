import { drawBelow } from './prng.ts';
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
  sortWorkshops,
  workshopCap,
  workshopLevelCap,
  type Engagement,
  type GoodId,
  type Person,
  type PersonId,
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
/**
 * `dormant` is the set of people the server found silent. It is an argument
 * and not a field of the world: silence is a fact about players, which the core
 * never reads, and the same town replays the same way whatever the clock says.
 */
export function advance(
  world: World,
  until: number,
  actions: readonly PlacedAction[] = [],
  dormant: ReadonlySet<PersonId> = new Set(),
): TickResult {
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
    step(next, byHour.get(at) ?? [], drafts, dormant);
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
function step(next: World, actions: readonly Action[], events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  // The hour's own trade, good by good: sold minus bought. It is written on the
  // world once the hour is over, and prices the next bell.
  const flow = Object.fromEntries(GOODS.map((good) => [good, 0])) as Record<GoodId, number>;

  for (const candidate of actions as readonly unknown[]) {
    // A stored action can be anything: it went through a database and a JSON
    // parser. An unknown one is refused, never skipped, and never thrown.
    if (!isKnownAction(candidate)) {
      // No person to answer: the line is kept for the court, and the town's
      // chronicle never carries what has no reader.
      events.push({
        type: 'action.refused',
        audience: 'court',
        action: 'unknown',
        personId: 0,
        reason: 'unknown_action',
      });
      continue;
    }

    applyAction(next, candidate, events, flow, dormant);
  }

  // What fell due is paid before the hour's trade, so an engagement resolved in
  // the same hour as its last action already counts for that hour. Its lines
  // belong to the world, not to the week's trades: they are gathered apart and
  // placed after the actions that opened them.
  const town: EventDraft[] = [];
  resolveEngagements(next, town, dormant);

  // The AI people decide in the same breath as the players, at the same price:
  // both buy before the hour moves the market. Their lines go with the town's.
  aiPeopleBuy(next, flow, dormant);

  // Production, then the AI's sale, then upkeep: an AI pays its workshops from
  // the price it just took. The prices move at the bells only, so every trade of
  // the half-day happens at the price the players saw. Every line goes with the
  // town's, so no AI's trade interrupts the person's own run.
  runWorkshops(next, town, dormant);
  aiPeopleSell(next, flow, dormant);
  payUpkeep(next, town, dormant);

  // At the start of the year, before the noon bell closes the candidacies, an
  // AI person without a seat looks for a vacant one.
  if (next.hour % HOURS_PER_YEAR === 1) {
    aiPeopleCampaign(next, town, dormant);
  }

  const bell = next.hour % (HOURS_PER_YEAR / 2) === 0;

  // The flow accumulates over the half-day: the bell prices the town's whole
  // trade, not the last hour of it.
  for (const good of GOODS) {
    next.marketFlow[good] = (next.marketFlow[good] ?? 0) + flow[good];
  }

  if (bell) {
    driftPrices(next);
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
    holdScrutiny(next, town, dormant);
  }

  // The hour reads as it was written: what the person asked and got, then what
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
    type === 'person.buy_title' ||
    type === 'person.upgrade_residence'
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
  personId: unknown,
  reason: RefusalReason,
  knownPerson: boolean,
): void {
  const id = typeof personId === 'number' && Number.isInteger(personId) && personId > 0 ? personId : 0;

  events.push({
    type: 'action.refused',
    // A person's own refusal is its business; one naming a person the town no
    // longer holds has no mailbox and waits for the court.
    audience: knownPerson ? { personId: id } : 'court',
    action: action.type,
    personId: id,
    reason,
  });
}

function applyAction(
  world: World,
  action: Action,
  events: EventDraft[],
  flow: Record<GoodId, number>,
  dormant: ReadonlySet<PersonId>,
): void {
  const person = world.people[action.personId];
  if (!person) {
    refuse(events, action, action.personId, 'unknown_person', false);
    return;
  }

  if (dormant.has(person.id)) {
    refuse(events, action, person.id, 'dormant_person', true);
    return;
  }

  // A degree or a residence level is bought once: two purchases for the same
  // next object would charge twice and deliver once, since the works of the
  // first already opens the second.
  if (action.type === 'person.buy_title' && sitesOf(world, person.id, 'title') > 0) {
    refuse(events, action, person.id, 'site_in_progress', true);
    return;
  }
  if (action.type === 'person.upgrade_residence' && sitesOf(world, person.id, 'residence') > 0) {
    refuse(events, action, person.id, 'site_in_progress', true);
    return;
  }

  // A site already under way cannot be doubled: the person has one builder, and
  // two sites of one kind would race for the same workshop or the same degree.
  const building = world.engagements.some(
    (engagement) => engagement.kind === 'site' && engagement.personId === person.id,
  );
  if (building && action.type !== 'market.buy' && action.type !== 'market.sell' && action.type !== 'council.campaign') {
    refuse(events, action, person.id, 'site_in_progress', true);
    return;
  }

  switch (action.type) {
    case 'market.buy': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, person.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, person.id, 'invalid_quantity', true);
        return;
      }

      const priceCents = world.market[action.good];
      const totalCents = priceCents * action.units;
      if (person.treasuryCents < totalCents) {
        refuse(events, action, person.id, 'insufficient_funds', true);
        return;
      }
      // The warehouse is one capacity for all goods, and a purchase is atomic:
      // it is refused whole, never trimmed to what would fit.
      if (stockUnits(person) + action.units > stockCapacityUnits(person)) {
        refuse(events, action, person.id, 'stock_full', true);
        return;
      }

      person.treasuryCents -= totalCents;
      person.stock[action.good] = (person.stock[action.good] ?? 0) + action.units;
      flow[action.good] -= action.units;
      // The trade itself has no journal line: the Marché screen holds the
      // price, the stock and the flow. Only what the town must be told — a
      // refusal, a loss — is written.
      return;
    }

    case 'market.sell': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, person.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, person.id, 'invalid_quantity', true);
        return;
      }

      const held = person.stock[action.good] ?? 0;
      if (held < action.units) {
        refuse(events, action, person.id, 'insufficient_stock', true);
        return;
      }

      const priceCents = world.market[action.good];
      const revenueCents = priceCents * action.units;
      person.treasuryCents += revenueCents;
      const left = held - action.units;
      if (left === 0) {
        delete person.stock[action.good];
      } else {
        person.stock[action.good] = left;
      }
      flow[action.good] += action.units;
      return;
    }

    case 'council.campaign': {
      if (!(action.seatId in world.seats)) {
        refuse(events, action, person.id, 'unknown_seat', true);
        return;
      }
      // One candidacy at a time: another open campaign, on this seat or another,
      // is refused before it can spend any favour.
      if (Object.values(world.campaigns).some((seat) => seat[person.id] !== undefined)) {
        refuse(events, action, person.id, 'already_candidate', true);
        return;
      }
      if (person.favour < RULES.campaignFavourCost) {
        refuse(events, action, person.id, 'insufficient_favour', true);
        return;
      }

      person.favour -= RULES.campaignFavourCost;

      // A candidacy has no run behind it: it is lodged, and the noon bell
      // decides which scrutiny it counts for. The event says which, so the
      // screen can tell the player what they bought.
      const countsAt = countsAtFor(world);

      const seat = (world.campaigns[action.seatId] ??= {});
      seat[person.id] = (seat[person.id] ?? 0) + RULES.campaignVoteBonus;

      events.push({
        type: 'council.campaigned',
        audience: { personId: person.id },
        personId: person.id,
        seatId: action.seatId,
        favourSpent: RULES.campaignFavourCost,
        countsAt,
      });
      return;
    }

    case 'workshop.build': {
      if (!isKnownTrade(action.trade)) {
        refuse(events, action, person.id, 'unknown_trade', true);
        return;
      }
      // The residence counts the sites as well as the buildings: two builds in
      // two hours must not slip past a cap of one.
      if (person.workshops.length + sitesOf(world, person.id, 'build') >= workshopCap(residenceOf(person))) {
        refuse(events, action, person.id, 'workshop_cap', true);
        return;
      }
      if (person.treasuryCents < RULES.buildCents) {
        refuse(events, action, person.id, 'insufficient_funds', true);
        return;
      }

      person.treasuryCents -= RULES.buildCents;
      openSite(world, person.id, { work: 'build', trade: action.trade }, RULES.siteHours);
      return;
    }

    case 'workshop.destroy': {
      const workshop = findWorkshop(person, action.workshopId);
      if (workshop === undefined) {
        refuse(events, action, person.id, 'unknown_workshop', true);
        return;
      }
      // The last workshop is the person's livelihood: destroying it would leave
      // a person that can neither produce nor rebuild. It is refused, not sold.
      if (person.workshops.length <= 1) {
        refuse(events, action, person.id, 'last_workshop', true);
        return;
      }

      person.workshops = person.workshops.filter((candidate) => candidate.id !== workshop.id);
      sortWorkshops(person);
      // Nothing is refunded, and the warehouse keeps its goods: a stock over the
      // new capacity is sold down, never confiscated.
      events.push({
        type: 'workshop.destroyed',
        audience: { personId: person.id },
        personId: person.id,
        workshopId: workshop.id,
        good: workshop.good,
      });
      return;
    }

    case 'workshop.upgrade': {
      const workshop = findWorkshop(person, action.workshopId);
      if (workshop === undefined) {
        refuse(events, action, person.id, 'unknown_workshop', true);
        return;
      }
      const target = workshop.level + 1;
      const degree = titleOf(person);
      if (target > workshopLevelCap(degree) || target > RULES.improvementHours.length - 1) {
        refuse(events, action, person.id, 'level_cap', true);
        return;
      }

      // An improvement costs hours, never money: the level is the work itself.
      openSite(world, person.id, { work: 'upgrade', workshopId: workshop.id }, improvementHours(target));
      return;
    }

    case 'person.buy_title': {
      const next = nextTitle(titleOf(person));
      if (next === undefined) {
        refuse(events, action, person.id, 'no_next_title', true);
        return;
      }
      const price = TITLE_LADDER[next].priceCents;
      if (person.treasuryCents < price) {
        refuse(events, action, person.id, 'insufficient_funds', true);
        return;
      }

      person.treasuryCents -= price;
      // A degree is obtained at the next noon or midnight, whatever the hour of
      // the purchase: the half-day is the calendar's, not a second clock.
      const dueAt = nextBellAfter(world.hour, RULES.titleHours);
      openSite(world, person.id, { work: 'title' }, dueAt - world.hour);
      return;
    }

    case 'person.upgrade_residence': {
      const target = residenceOf(person) + 1;
      const opened = TITLE_LADDER[titleOf(person)].residenceLevel;
      if (target > RESIDENCE_LADDER.length) {
        refuse(events, action, person.id, 'no_next_residence', true);
        return;
      }
      // The title opens the level, money pays for it: a person below its degree
      // buys up to what the degree opened, and no further.
      if (target > opened) {
        refuse(events, action, person.id, 'title_open', true);
        return;
      }
      const price = RESIDENCE_LADDER[target - 1].priceCents;
      if (person.treasuryCents < price) {
        refuse(events, action, person.id, 'insufficient_funds', true);
        return;
      }

      person.treasuryCents -= price;
      openSite(world, person.id, { work: 'residence' }, improvementHours(target));
      return;
    }
  }
}

/** A stored workshop id went through the parser too: only a number names one. */
function findWorkshop(person: Person, workshopId: unknown) {
  if (typeof workshopId !== 'number' || !Number.isInteger(workshopId)) {
    return undefined;
  }

  return person.workshops.find((candidate) => candidate.id === workshopId);
}

/** The workshops a person has open: not under an improvement, which stops it. */
function openWorkshops(world: World, person: Person) {
  const closed = new Set(
    world.engagements.flatMap((engagement) =>
      engagement.kind === 'site' && engagement.personId === person.id && engagement.work === 'upgrade'
        ? [engagement.workshopId]
        : [],
    ),
  );

  return person.workshops.filter((workshop) => !closed.has(workshop.id));
}

/** The sites a person has under way of one kind. */
function sitesOf(world: World, personId: PersonId, work: SiteWork['work']): number {
  return world.engagements.filter(
    (engagement) => engagement.kind === 'site' && engagement.personId === personId && engagement.work === work,
  ).length;
}

function openSite(world: World, personId: PersonId, work: SiteWork, hours: number): void {
  world.engagementSeq += 1;
  world.engagements.push({
    id: world.engagementSeq,
    kind: 'site' as const,
    personId,
    dueAt: world.hour + hours,
    ...work,
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

/**
 * `Colin Leclerc` becomes `Colin Moreau`: the given name stays, the family moves.
 * A person whose name does not end with the old family name takes the new one
 * whole, which is what a first name with no family yet needs.
 */
export function renamePerson(personName: string, before: string, after: string): string {
  const witness =
    before !== '' && personName.endsWith(before) ? personName.slice(0, personName.length - before.length) : '';

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

/** The people a server plays, in id order, so a replay is stable. */
function aiPeople(world: World): Person[] {
  return Object.values(world.people)
    .filter((person) => person.ia)
    .sort((left, right) => left.id - right.id);
}

/**
 * The other people are not puppets: an AI person buys the input its workshops
 * lack, at the hour's price, as far as its purse goes, and decides nothing
 * else. It is not an action, so a person that cannot pay produces no refusal:
 * its workshop simply idles, which `runWorkshops` reports.
 *
 * No margin check on purpose. A guard that stops buying once the input costs
 * more than the output makes the AI's demand switch on and off with a one-hour
 * lag, and the price saws. The price is the guard.
 */
function aiPeopleBuy(world: World, flow: Record<GoodId, number>, dormant: ReadonlySet<PersonId>): void {
  for (const person of aiPeople(world)) {
    if (dormant.has(person.id)) {
      continue;
    }

    // A workshop under improvement buys nothing: it will not eat until its
    // site is closed, and an AI that stocked for it would overflow the loft.
    for (const workshop of openWorkshops(world, person)) {
      const recipe = RULES.recipes[workshop.good];

      if (recipe === null) {
        continue;
      }

      const wanted = workshop.level * RULES.outputPerLevel;
      const shortfall = wanted * recipe.perUnit - (person.stock[recipe.input] ?? 0);

      if (shortfall <= 0) {
        continue;
      }

      const priceCents = world.market[recipe.input];
      const affordable = Math.floor(person.treasuryCents / priceCents);
      const room = stockCapacityUnits(person) - stockUnits(person);
      const units = Math.min(shortfall, affordable, room);

      if (units <= 0) {
        continue;
      }

      person.treasuryCents -= units * priceCents;
      person.stock[recipe.input] = (person.stock[recipe.input] ?? 0) + units;
      flow[recipe.input] -= units;
    }
  }
}

function driftPrices(world: World): void {
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

    world.market[good] = after;

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

function runWorkshops(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  const people = Object.values(world.people).sort((left, right) => left.id - right.id);

  for (const person of people) {
    // A dormant person runs nothing: the workshop is idle, the stock is still a
    // target, and its money is untouched. Wages are part of running it.
    if (dormant.has(person.id)) {
      continue;
    }

    // A workshop under improvement is a building site: it makes nothing, and
    // the upkeep it does not pay is the cost of the hours it takes.
    for (const workshop of openWorkshops(world, person)) {
      const wanted = workshop.level * RULES.outputPerLevel;
      const recipe = RULES.recipes[workshop.good];
      const available = recipe ? (person.stock[recipe.input] ?? 0) : Number.POSITIVE_INFINITY;
      const makeable = recipe ? Math.min(wanted, Math.floor(available / recipe.perUnit)) : wanted;

      if (makeable === 0) {
        continue;
      }

      // A recipe moves units from one good to another; a raw workshop creates
      // them out of nothing. Both must stop at the warehouse's cap, and the
      // units that do not fit are refused with an event, never dropped.
      const netPerUnit = 1 - (recipe?.perUnit ?? 0);
      const room = stockCapacityUnits(person) - stockUnits(person);
      const units = netPerUnit <= 0 ? makeable : Math.min(makeable, Math.floor(Math.max(0, room) / netPerUnit));

      if (units < makeable) {
        events.push({
          type: 'workshop.overflow',
          audience: { personId: person.id },
          personId: person.id,
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
          delete person.stock[recipe.input];
        } else {
          person.stock[recipe.input] = left;
        }
      }

      // Production credits the warehouse, never the purse: the sale is a
      // separate action, at the hour's price.
      person.stock[workshop.good] = (person.stock[workshop.good] ?? 0) + units;
    }
  }
}

/**
 * The AI takes the price and does not time it: every hour it sells whatever
 * its workshops left in the warehouse, at the hour's price. A human person
 * keeps its stock, because holding for a better hour is the player's bet; a
 * dormant person keeps everything it had.
 */
function aiPeopleSell(world: World, flow: Record<GoodId, number>, dormant: ReadonlySet<PersonId>): void {
  for (const person of aiPeople(world)) {
    if (dormant.has(person.id)) {
      continue;
    }

    for (const good of GOODS) {
      const units = person.stock[good] ?? 0;
      if (units <= 0) {
        continue;
      }

      const priceCents = world.market[good];
      const revenueCents = units * priceCents;
      person.treasuryCents += revenueCents;
      delete person.stock[good];
      flow[good] += units;
    }
  }
}

/**
 * The upkeep of a workshop is one level's share, paid for every workshop that is
 * not under construction or improvement: a site stops the building, and it
 * stops what the building costs to run. Come after the AI's sale, so a person
 * pays from the price it just took.
 */
function payUpkeep(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  const people = Object.values(world.people).sort((left, right) => left.id - right.id);

  for (const person of people) {
    if (dormant.has(person.id)) {
      continue;
    }

    const building = new Set(
      world.engagements.flatMap((engagement) =>
        engagement.kind === 'site' && engagement.personId === person.id && engagement.work === 'upgrade'
          ? [engagement.workshopId]
          : [],
      ),
    );
    const levels = person.workshops
      .filter((workshop) => !building.has(workshop.id))
      .reduce((total, workshop) => total + workshop.level, 0);

    upkeepIsPaid(person.id, person, levels * RULES.upkeepPerWorkshopLevelCents, events);
  }
}

function upkeepIsPaid(personId: PersonId, person: Person, upkeep: number, events: EventDraft[]): void {
  if (upkeep > 0) {
    const paid = Math.min(person.treasuryCents, upkeep);
    person.treasuryCents -= paid;

    if (paid < upkeep) {
      const shortfallCents = upkeep - paid;
      person.debtCents += shortfallCents;
      events.push({ type: 'person.penniless', audience: { personId }, personId, shortfallCents });
    }
  }

  if (person.debtCents > 0 && person.treasuryCents > 0) {
    const repaid = Math.min(person.treasuryCents, person.debtCents);
    person.treasuryCents -= repaid;
    person.debtCents -= repaid;
    events.push({ type: 'person.debt_repaid', audience: { personId }, personId, amountCents: repaid });
  }
}

/**
 * Pays every engagement whose due hour has arrived. A hour the catch-up never
 * simulated does not drop it: the town's hour counter is the only clock, so an
 * engagement behind it is resolved by the next tick that runs, and the event
 * carries both the hour it was due and the hour it was paid.
 */
function resolveEngagements(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  const due = world.engagements
    .filter((engagement) => engagement.dueAt <= world.hour)
    .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id);

  if (due.length === 0) {
    return;
  }

  // A dormant person plays nothing, its sites included: what fell due for it
  // stays in the world and resolves at the visit that wakes it. The cost was
  // paid, and the journal must not claim a work done that never was.
  const waiting = due.filter(
    (engagement) =>
      engagement.kind === 'site' &&
      (world.people[engagement.personId] === undefined || dormant.has(engagement.personId)),
  );
  world.engagements = world.engagements.filter(
    (engagement) => engagement.dueAt > world.hour || waiting.includes(engagement),
  );

  for (const engagement of due) {
    if (waiting.includes(engagement)) {
      continue;
    }

    if (engagement.kind === 'site') {
      completeSite(world, engagement, events);
    }
  }
}

/**
 * What a site was opened for. The person or the workshop can be gone — destroyed,
 * converted, the person deleted — so every step is a check, never a throw: the
 * cost was paid when the site was opened, and a site that outlived its object
 * has nothing left to finish.
 */
function completeSite(world: World, site: Extract<Engagement, { kind: 'site' }>, events: EventDraft[]): void {
  const person = world.people[site.personId];
  if (person === undefined) {
    return;
  }

  switch (site.work) {
    case 'build': {
      if (person.workshops.length >= workshopCap(residenceOf(person))) {
        events.push({
          type: 'workshop.build_lost',
          audience: { personId: person.id },
          personId: person.id,
          trade: site.trade,
          paidCents: RULES.buildCents,
        });
        return;
      }
      world.workshopSeq = (world.workshopSeq ?? highestWorkshopSeq(world)) + 1;
      const workshop = {
        id: world.workshopSeq,
        good: TRADE_CHAINS[site.trade].output,
        level: RULES.builtWorkshopLevel,
      };
      person.workshops.push(workshop);
      sortWorkshops(person);
      events.push({
        type: 'workshop.built',
        audience: { personId: person.id },
        personId: person.id,
        workshopId: workshop.id,
        trade: site.trade,
      });
      return;
    }
    case 'upgrade': {
      const workshop = person.workshops.find((candidate) => candidate.id === site.workshopId);
      if (workshop === undefined) {
        return;
      }
      workshop.level += 1;
      events.push({
        type: 'workshop.upgraded',
        audience: { personId: person.id },
        personId: person.id,
        workshopId: workshop.id,
        level: workshop.level,
      });
      return;
    }
    case 'residence': {
      // The level is read on the Maison screen; the town has no line for it.
      person.residenceLevel = Math.min(residenceOf(person) + 1, TITLE_LADDER[titleOf(person)].residenceLevel);
      return;
    }
    case 'title': {
      const next = nextTitle(titleOf(person));
      if (next === undefined) {
        return;
      }
      person.title = next;
      // The residence never exceeds what the new degree opens: buying a degree
      // below a residence already paid for leaves the residence where it is.
      if (residenceOf(person) > TITLE_LADDER[next].residenceLevel) {
        person.residenceLevel = TITLE_LADDER[next].residenceLevel;
      }
      events.push({
        type: 'person.title_received',
        audience: { personId: person.id },
        personId: person.id,
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
  for (const person of Object.values(world.people)) {
    for (const workshop of person.workshops) {
      highest = Math.max(highest, workshop.id);
    }
  }

  return highest;
}

function holdScrutiny(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
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
  const electedPersonIds = new Set<PersonId>();
  for (const seatId of SEATS) {
    contestSeat(world, seatId, elections, electedPersonIds, dormant);
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
 * At the first hour of a year, an AI person that holds no seat and can pay
 * tries a random vacant seat. A seated AI is the incumbent and defends it; the
 * climb waits for #55.
 */
function aiPeopleCampaign(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  const seated = new Set<PersonId>();
  for (const seatId of SEATS) {
    const person = seatHolder(world, seatId);
    if (person !== undefined) {
      seated.add(person.id);
    }
  }

  for (const person of aiPeople(world)) {
    if (dormant.has(person.id) || seated.has(person.id)) {
      continue;
    }

    const vacant = SEATS.filter((seatId) => world.seats[seatId].personId === null);
    if (person.favour < RULES.campaignFavourCost || vacant.length === 0) {
      continue;
    }

    const [rng, roll] = drawBelow(world.rng, vacant.length);
    world.rng = rng;
    const seatId = vacant[roll] as SeatId;

    person.favour -= RULES.campaignFavourCost;
    const seat = (world.campaigns[seatId] ??= {});
    seat[person.id] = (seat[person.id] ?? 0) + RULES.campaignVoteBonus;

    events.push({
      type: 'council.campaigned',
      audience: { personId: person.id },
      personId: person.id,
      seatId,
      favourSpent: RULES.campaignFavourCost,
      countsAt: countsAtFor(world),
    });
  }
}

function contestSeat(
  world: World,
  seatId: SeatId,
  events: EventDraft[],
  electedPersonIds: Set<PersonId>,
  dormant: ReadonlySet<PersonId>,
): void {
  const campaigns = world.closedCampaigns[seatId] ?? {};
  const incumbent = seatHolder(world, seatId);
  const incumbentPersonId = incumbent?.id;

  // A candidate is a person that stood (an open campaign, now closed at noon)
  // and is still able to run, plus the active incumbent. A dormant person
  // neither stands nor is defended: with nobody to take its seat, the seat
  // falls vacant.
  const candidateIds = [
    ...new Set([
      ...Object.keys(campaigns)
        .map(Number)
        .filter((personId) => {
          const person = world.people[personId];

          return person !== undefined && !dormant.has(personId) && person.alive;
        }),
      ...(incumbentPersonId !== undefined && !dormant.has(incumbentPersonId) && incumbent?.alive === true
        ? [incumbentPersonId]
        : []),
    ]),
  ]
    .filter((personId) => !electedPersonIds.has(personId))
    .sort((left, right) => left - right);

  if (candidateIds.length === 0) {
    const wasHeld = world.seats[seatId].personId !== null;
    world.seats[seatId] = { personId: null };
    delete world.closedCampaigns[seatId];

    if (wasHeld) {
      events.push({ type: 'council.election_held', audience: 'town', seatId, winnerPersonId: null, votes: {} });
    }
    return;
  }

  const votes: Record<PersonId, number> = {};
  for (const personId of candidateIds) {
    const [rng, roll] = drawBelow(world.rng, 5);
    world.rng = rng;
    votes[personId] = roll + 1 + (campaigns[personId] ?? 0);
  }

  // Highest vote wins; a tie goes to the person that comes first by id, so the
  // result never depends on the order of the object.
  const winnerPersonId = candidateIds.reduce((best, personId) => (votes[personId] > votes[best] ? personId : best));
  const winner = world.people[winnerPersonId];
  const changed = winnerPersonId !== incumbentPersonId;

  if (winner !== undefined) {
    // Take the new seat before giving up the old ones: a refused assignment
    // must not leave the winner with nowhere to sit.
    const assignment = takeSeat(world, winner.id);

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
            winnerPersonId: null,
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
    events.push({ type: 'council.election_held', audience: 'town', seatId, winnerPersonId, votes });
  }

  // Every candidate learns the result, whether the town sees a change or not.
  for (const personId of candidateIds) {
    events.push({
      type: 'council.election_result',
      audience: { personId },
      personId,
      seatId,
      won: personId === winnerPersonId,
      winnerPersonId,
      votes,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
