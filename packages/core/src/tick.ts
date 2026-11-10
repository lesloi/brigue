import type { Action, Event, EventDraft, RefusalReason } from './events.ts';
import {
  FORMAT_VERSION,
  GOODS,
  outputOf,
  HOURS_PER_YEAR,
  nextTitle,
  residenceOf,
  RESIDENCE_LADDER,
  RULES,
  seatHolder,
  SEATS,
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
  type GoodId,
  type Person,
  type PersonId,
  type SeatId,
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
 *
 * `random` is injected for the same reason: the core never reads a global random
 * source itself. The server passes `Math.random`, a replay passes a seeded
 * generator, and the same world plus the same stream gives the same town.
 */
export function advance(
  world: World,
  until: number,
  actions: readonly PlacedAction[],
  dormant: ReadonlySet<PersonId>,
  random: () => number,
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
    step(next, byHour.get(at) ?? [], drafts, dormant, random);
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
function step(
  next: World,
  actions: readonly Action[],
  events: EventDraft[],
  dormant: ReadonlySet<PersonId>,
  random: () => number,
): void {
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

  // The town's own lines are gathered apart from the actions', and placed after
  // them, so a reader's line always comes first.
  const town: EventDraft[] = [];

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
    aiPeopleCampaign(next, town, dormant, random);
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

  // The scrutiny closes the year: every seat is up, once a day.
  if (next.hour % HOURS_PER_YEAR === 0) {
    holdScrutiny(next, town, dormant, random);
  }

  // The hour reads as it was written: what the person asked and got, then what
  // the town did with it. A reader looking for their own line finds it first.
  events.push(...town);

  next.hour += 1;
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
      if (Object.values(world.campaigns).some((seat) => seat?.includes(person.id) === true)) {
        refuse(events, action, person.id, 'already_candidate', true);
        return;
      }
      if (person.favour < RULES.campaignFavourCost) {
        refuse(events, action, person.id, 'insufficient_favour', true);
        return;
      }

      person.favour -= RULES.campaignFavourCost;

      // A candidacy has no run behind it: it is lodged, and it counts at the
      // coming scrutiny. The event says which, so the screen can tell the
      // player what they bought.
      const countsAt = countsAtFor(world);
      const seat = (world.campaigns[action.seatId] ??= []);

      if (!seat.includes(person.id)) {
        seat.push(person.id);
        seat.sort((left, right) => left - right);
      }

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
      if (person.workshops.length >= workshopCap(residenceOf(person))) {
        refuse(events, action, person.id, 'workshop_cap', true);
        return;
      }
      if (person.treasuryCents < RULES.buildCents) {
        refuse(events, action, person.id, 'insufficient_funds', true);
        return;
      }

      person.treasuryCents -= RULES.buildCents;
      const workshop = {
        id: highestWorkshopSeq(world) + 1,
        trade: action.trade,
        level: RULES.builtWorkshopLevel,
      };
      person.workshops.push(workshop);
      sortWorkshops(person);
      events.push({
        type: 'workshop.built',
        audience: { personId: person.id },
        personId: person.id,
        workshopId: workshop.id,
        trade: workshop.trade,
      });
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
        good: outputOf(workshop.trade),
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
      if (target > workshopLevelCap(degree)) {
        refuse(events, action, person.id, 'level_cap', true);
        return;
      }

      // An improvement costs hours, never money, and the hour is the action's.
      workshop.level = target;
      events.push({
        type: 'workshop.upgraded',
        audience: { personId: person.id },
        personId: person.id,
        workshopId: workshop.id,
        level: workshop.level,
      });
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
      person.title = next;
      events.push({ type: 'person.title_bought', audience: { personId: person.id }, personId: person.id, title: next });
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
      person.residenceLevel = target;
      events.push({
        type: 'person.residence_bought',
        audience: { personId: person.id },
        personId: person.id,
        level: target,
      });
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
   * Undefined when the good has no flow stored, which the rule reads as nil.
   */
  flowUnits?: number;
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

  return clamp(input.priceCents + pressure + pull, input.floorCents, input.ceilCents);
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

    // A person that is dormant runs nothing, and each workshop buys for its own
    // level: a shop stocked beyond its need would overflow the loft.
    for (const workshop of person.workshops) {
      const chain = TRADE_CHAINS[workshop.trade];
      const wanted = workshop.level * RULES.outputPerLevel;
      const shortfall = wanted * RULES.inputPerOutput[workshop.trade] - (person.stock[chain.input] ?? 0);

      if (shortfall <= 0) {
        continue;
      }

      const priceCents = world.market[chain.input];
      const affordable = Math.floor(person.treasuryCents / priceCents);
      const room = stockCapacityUnits(person) - stockUnits(person);
      const units = Math.min(shortfall, affordable, room);

      if (units <= 0) {
        continue;
      }

      person.treasuryCents -= units * priceCents;
      person.stock[chain.input] = (person.stock[chain.input] ?? 0) + units;
      flow[chain.input] -= units;
    }
  }
}

function driftPrices(world: World): void {
  // The constants are per hour; a bell prices a whole half-day of trade, so the
  // scale it is measured against is the half-day's.
  const hours = HOURS_PER_YEAR / 2;

  for (const good of GOODS) {
    const before = world.market[good];
    const after = nextPriceCents({
      priceCents: before,
      referenceCents: RULES.market[good].referenceCents,
      absorbedUnits: RULES.market[good].absorbedUnits * hours,
      scaleUnits: RULES.market[good].scaleUnits * hours,
      flowUnits: world.marketFlow[good],
      pressureDivisor: RULES.pricePressureDivisor,
      reversionDivisor: RULES.priceReversionDivisor,
      floorCents: RULES.priceFloorCents,
      ceilCents: RULES.priceCeilCents,
    });

    world.market[good] = after;
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

    for (const workshop of person.workshops) {
      const wanted = workshop.level * RULES.outputPerLevel;
      const chain = TRADE_CHAINS[workshop.trade];
      const perUnit = RULES.inputPerOutput[workshop.trade];
      const available = person.stock[chain.input] ?? 0;
      const made = Math.min(wanted, Math.floor(available / perUnit));

      if (made === 0) {
        continue;
      }

      // A unit of output costs at least a unit of input, so production never
      // makes the loft fuller: the warehouse cap stops a purchase, not a loom.
      const left = available - made * perUnit;
      if (left === 0) {
        delete person.stock[chain.input];
      } else {
        person.stock[chain.input] = left;
      }

      // Production credits the warehouse, never the purse: the sale is a
      // separate action, at the hour's price.
      person.stock[chain.output] = (person.stock[chain.output] ?? 0) + made;
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
 * The upkeep of a workshop is one level's share, paid for every workshop the
 * person holds. Comes after the AI's sale, so a person pays from the price it
 * just took.
 */
function payUpkeep(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>): void {
  const people = Object.values(world.people).sort((left, right) => left.id - right.id);

  for (const person of people) {
    if (dormant.has(person.id)) {
      continue;
    }

    const levels = person.workshops.reduce((total, workshop) => total + workshop.level, 0);

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

function holdScrutiny(world: World, events: EventDraft[], dormant: ReadonlySet<PersonId>, random: () => number): void {
  const elections: EventDraft[] = [];
  // One person, one office: a person already elected during this scrutiny is
  // not a candidate for another seat on the same day. A town too small to fill
  // every seat leaves one vacant rather than electing the same person twice.
  const electedPersonIds = new Set<PersonId>();
  for (const seatId of SEATS) {
    contestSeat(world, seatId, elections, electedPersonIds, dormant, random);
  }

  events.push(...elections);
}

/** The scrutiny a candidacy lodged now counts for: the coming one. */
function countsAtFor(world: World): number {
  return Math.ceil(world.hour / HOURS_PER_YEAR) * HOURS_PER_YEAR;
}

/**
 * At the first hour of a year, an AI person that holds no seat and can pay
 * tries a random vacant seat. A seated AI is the incumbent and defends it; the
 * climb waits for #55.
 */
function aiPeopleCampaign(
  world: World,
  events: EventDraft[],
  dormant: ReadonlySet<PersonId>,
  random: () => number,
): void {
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

    const seatId = vacant[Math.floor(random() * vacant.length)] as SeatId;

    person.favour -= RULES.campaignFavourCost;
    const seat = (world.campaigns[seatId] ??= []);

    if (!seat.includes(person.id)) {
      seat.push(person.id);
      seat.sort((left, right) => left - right);
    }

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
  random: () => number,
): void {
  const candidates = world.campaigns[seatId] ?? [];
  const incumbent = seatHolder(world, seatId);
  const incumbentPersonId = incumbent?.id;

  // A candidate is a person that stood and is still able to run, plus the
  // active incumbent. A dormant person neither stands nor is defended: with
  // nobody to take its seat, the seat falls vacant.
  const candidateIds = [
    ...new Set([
      ...candidates.filter((personId) => {
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
    delete world.campaigns[seatId];

    if (wasHeld) {
      events.push({ type: 'council.election_held', audience: 'town', seatId, winnerPersonId: null, votes: {} });
    }
    return;
  }

  // The vote is the town's, not the candidate's purse: a campaign buys the
  // candidacy, and the scrutiny rolls once for every candidate.
  const votes: Record<PersonId, number> = {};
  for (const personId of candidateIds) {
    votes[personId] = 1 + Math.floor(random() * 5);
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
  delete world.campaigns[seatId];

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
