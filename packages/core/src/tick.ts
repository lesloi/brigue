import { drawBelow } from './prng.ts';
import type { Action, Event, EventDraft, RefusalReason } from './events.ts';
import {
  FORMAT_VERSION,
  GOODS,
  PRICE_HISTORY_BELLS,
  RULES,
  seatHolder,
  SEATS,
  START_YEAR,
  stockUnits,
  takeSeat,
  HOURS_PER_YEAR,
  type GoodId,
  type Person,
  type SeatId,
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
        houseId: 'unknown',
        reason: 'unknown_action',
      });
      continue;
    }

    applyAction(next, candidate, events, flow);
  }

  // What fell due is paid before the hour's trade, so an engagement resolved in
  // the same hour as its last action already counts for that hour.
  resolveEngagements(next, events);

  // The AI houses decide in the same breath as the players, at the same price:
  // both buy before the hour moves the market.
  aiHousesBuy(next, flow, events);

  // Production, then the AI's sale, then wages: an AI pays its workers from the
  // price it just took. The prices move at the bells only, so every trade of the
  // half-day happens at the price the players saw.
  runWorkshops(next, events);
  aiHousesSell(next, flow, events);
  payWages(next, events);

  const bell = next.hour % (HOURS_PER_YEAR / 2) === 0;

  // The flow accumulates over the half-day: the bell prices the town's whole
  // trade, not the last hour of it.
  for (const good of GOODS) {
    next.marketFlow[good] = (next.marketFlow[good] ?? 0) + flow[good];
  }

  if (bell) {
    driftPrices(next, events);
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
    holdScrutiny(next, events);
  }

  next.hour += 1;
  next.year = START_YEAR + Math.floor((next.hour - 1) / HOURS_PER_YEAR);
}

function isKnownAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return type === 'market.buy' || type === 'market.sell' || type === 'council.campaign';
}

/** A stored action's good went through a database and a JSON parser too. */
function isKnownGood(good: unknown): good is GoodId {
  return typeof good === 'string' && (GOODS as readonly string[]).includes(good);
}

function refuse(
  events: EventDraft[],
  action: Action,
  houseId: unknown,
  reason: RefusalReason,
  knownHouse: boolean,
): void {
  const id = typeof houseId === 'string' && houseId.length > 0 ? houseId : 'unknown';

  events.push({
    type: 'action.refused',
    // A house's own refusal is its business; one naming a house the town no
    // longer holds has no reader but the town.
    audience: knownHouse ? { houseId: id } : 'town',
    action: action.type,
    houseId: id,
    reason,
  });
}

function applyAction(world: World, action: Action, events: EventDraft[], flow: Record<GoodId, number>): void {
  const house = world.houses[action.houseId];
  if (!house) {
    refuse(events, action, action.houseId, 'unknown_house', false);
    return;
  }

  if (house.dormant) {
    refuse(events, action, house.id, 'dormant_house', true);
    return;
  }

  switch (action.type) {
    case 'market.buy': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, house.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, house.id, 'invalid_quantity', true);
        return;
      }

      const priceCents = world.market[action.good];
      const totalCents = priceCents * action.units;
      if (house.treasuryCents < totalCents) {
        refuse(events, action, house.id, 'insufficient_funds', true);
        return;
      }
      // The warehouse is one capacity for all goods, and a purchase is atomic:
      // it is refused whole, never trimmed to what would fit.
      if (stockUnits(house) + action.units > RULES.stockCapacityUnits) {
        refuse(events, action, house.id, 'stock_full', true);
        return;
      }

      house.treasuryCents -= totalCents;
      house.stock[action.good] = (house.stock[action.good] ?? 0) + action.units;
      flow[action.good] -= action.units;
      events.push({
        type: 'market.bought',
        audience: 'town',
        houseId: house.id,
        good: action.good,
        units: action.units,
        priceCents,
        totalCents,
      });
      return;
    }

    case 'market.sell': {
      if (!isKnownGood(action.good)) {
        refuse(events, action, house.id, 'unknown_good', true);
        return;
      }
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, house.id, 'invalid_quantity', true);
        return;
      }

      const held = house.stock[action.good] ?? 0;
      if (held < action.units) {
        refuse(events, action, house.id, 'insufficient_stock', true);
        return;
      }

      const priceCents = world.market[action.good];
      const revenueCents = priceCents * action.units;
      house.treasuryCents += revenueCents;
      const left = held - action.units;
      if (left === 0) {
        delete house.stock[action.good];
      } else {
        house.stock[action.good] = left;
      }
      flow[action.good] += action.units;
      events.push({
        type: 'market.sold',
        audience: 'town',
        houseId: house.id,
        good: action.good,
        units: action.units,
        priceCents,
        revenueCents,
      });
      return;
    }

    case 'council.campaign': {
      if (!(action.seatId in world.seats)) {
        refuse(events, action, house.id, 'unknown_seat', true);
        return;
      }
      if (house.favour < RULES.campaignFavourCost) {
        refuse(events, action, house.id, 'insufficient_favour', true);
        return;
      }

      house.favour -= RULES.campaignFavourCost;

      // A candidacy has no run behind it: it is lodged, and the noon bell
      // decides which scrutiny it counts for. The event says which, so the
      // screen can tell the player what they bought.
      const localHour = ((world.hour - 1) % HOURS_PER_YEAR) + 1;
      const scrutiny = Math.ceil(world.hour / HOURS_PER_YEAR) * HOURS_PER_YEAR;
      const countsAt = localHour <= HOURS_PER_YEAR / 2 ? scrutiny : scrutiny + HOURS_PER_YEAR;

      const seat = (world.campaigns[action.seatId] ??= {});
      seat[house.id] = (seat[house.id] ?? 0) + RULES.campaignVoteBonus;

      events.push({
        type: 'council.campaigned',
        audience: 'town',
        houseId: house.id,
        seatId: action.seatId,
        favourSpent: RULES.campaignFavourCost,
        countsAt,
      });
      return;
    }
  }
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
 * The other houses are not puppets: an AI house buys the input its workshops
 * lack, at the hour's price, as far as its purse goes, and decides nothing
 * else. It is not an action, so a house that cannot pay produces no refusal:
 * its workshop simply idles, which `runWorkshops` reports.
 *
 * No margin check on purpose. A guard that stops buying once the input costs
 * more than the output makes the AI's demand switch on and off with a one-hour
 * lag, and the price saws. The price is the guard.
 */
function aiHousesBuy(world: World, flow: Record<GoodId, number>, events: EventDraft[]): void {
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];

    if (house.controller !== 'ai' || house.dormant) {
      continue;
    }

    for (const workshop of house.workshops) {
      const recipe = RULES.recipes[workshop.good];

      if (recipe === null) {
        continue;
      }

      const wanted = workshop.level * RULES.outputPerLevel;
      const shortfall = wanted * recipe.perUnit - (house.stock[recipe.input] ?? 0);

      if (shortfall <= 0) {
        continue;
      }

      const priceCents = world.market[recipe.input];
      const affordable = Math.floor(house.treasuryCents / priceCents);
      const room = RULES.stockCapacityUnits - stockUnits(house);
      const units = Math.min(shortfall, affordable, room);

      if (units <= 0) {
        continue;
      }

      house.treasuryCents -= units * priceCents;
      house.stock[recipe.input] = (house.stock[recipe.input] ?? 0) + units;
      flow[recipe.input] -= units;
      events.push({
        type: 'market.bought',
        audience: 'town',
        houseId: house.id,
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
    // The outside supply sells the raw goods at the current price: their price
    // is not moved by the town's flow, only by chance and the pull home.
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
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];

    // A dormant house runs nothing: the workshop is idle, the stock is still a
    // target, and its money is untouched. Wages are part of running it.
    if (house.dormant) {
      continue;
    }

    for (const workshop of house.workshops) {
      const wanted = workshop.level * RULES.outputPerLevel;
      const recipe = RULES.recipes[workshop.good];
      const available = recipe ? (house.stock[recipe.input] ?? 0) : Number.POSITIVE_INFINITY;
      const makeable = recipe ? Math.min(wanted, Math.floor(available / recipe.perUnit)) : wanted;

      if (recipe && makeable < wanted) {
        events.push({
          type: 'workshop.idle',
          audience: { houseId: house.id },
          houseId: house.id,
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
      const room = RULES.stockCapacityUnits - stockUnits(house);
      const units = netPerUnit <= 0 ? makeable : Math.min(makeable, Math.floor(Math.max(0, room) / netPerUnit));

      if (units < makeable) {
        events.push({
          type: 'workshop.overflow',
          audience: { houseId: house.id },
          houseId: house.id,
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
          delete house.stock[recipe.input];
        } else {
          house.stock[recipe.input] = left;
        }
      }

      // Production credits the warehouse, never the purse: the sale is a
      // separate action, at the hour's price.
      house.stock[workshop.good] = (house.stock[workshop.good] ?? 0) + units;
      events.push({
        type: 'workshop.produced',
        audience: { houseId: house.id },
        houseId: house.id,
        good: workshop.good,
        units,
      });
    }
  }
}

/**
 * The AI takes the price and does not time it: every hour it sells whatever
 * its workshops left in the warehouse, at the hour's price. A human house
 * keeps its stock, because holding for a better hour is the player's bet; a
 * dormant house keeps everything it had.
 */
function aiHousesSell(world: World, flow: Record<GoodId, number>, events: EventDraft[]): void {
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];

    if (house.controller !== 'ai' || house.dormant) {
      continue;
    }

    for (const good of GOODS) {
      const units = house.stock[good] ?? 0;
      if (units <= 0) {
        continue;
      }

      const priceCents = world.market[good];
      const revenueCents = units * priceCents;
      house.treasuryCents += revenueCents;
      delete house.stock[good];
      flow[good] += units;
      events.push({
        type: 'market.sold',
        audience: 'town',
        houseId: house.id,
        good,
        units,
        priceCents,
        revenueCents,
      });
    }
  }
}

/** Wages come after the AI's sale, so a house pays from the price it just took. */
function payWages(world: World, events: EventDraft[]): void {
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];

    if (house.dormant) {
      continue;
    }

    let workers = 0;
    for (const workshop of house.workshops) {
      workers += workshop.workers;
    }

    employeesArePaid(world, houseId, workers, events);
  }
}

function employeesArePaid(world: World, houseId: string, workers: number, events: EventDraft[]): void {
  const house = world.houses[houseId];
  const wages = workers * RULES.wagePerWorkerCents;

  if (wages > 0) {
    const paid = Math.min(house.treasuryCents, wages);
    house.treasuryCents -= paid;

    if (paid > 0) {
      events.push({ type: 'house.wages_paid', audience: { houseId }, houseId, amountCents: paid });
    }
    if (paid < wages) {
      const shortfallCents = wages - paid;
      house.debtCents += shortfallCents;
      events.push({ type: 'house.penniless', audience: { houseId }, houseId, shortfallCents });
    }
  }

  if (house.debtCents > 0 && house.treasuryCents > 0) {
    const repaid = Math.min(house.treasuryCents, house.debtCents);
    house.treasuryCents -= repaid;
    house.debtCents -= repaid;
    events.push({ type: 'house.debt_repaid', audience: { houseId }, houseId, amountCents: repaid });
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

  world.engagements = world.engagements.filter((engagement) => engagement.dueAt > world.hour);

  for (const engagement of due) {
    events.push({
      type: 'engagement.resolved',
      audience: 'town',
      engagementId: engagement.id,
      kind: engagement.kind,
      houseId: engagement.houseId,
      dueAt: engagement.dueAt,
      resolvedAt: world.hour,
    });
  }
}

function holdScrutiny(world: World, events: EventDraft[]): void {
  const year = world.year;

  // Age belongs to the calendar: every living person takes a year at the
  // scrutiny, whatever they did with it. The death roll is #7.
  for (const person of Object.values(world.people)) {
    if (person.alive) {
      person.age += 1;
    }
  }

  const elections: Event[] = [];
  // One person, one office: a person already elected during this scrutiny is
  // not a candidate for another seat on the same day. A town too small to fill
  // every seat leaves one vacant rather than electing the same person twice.
  const electedPersonIds = new Set<string>();
  for (const seatId of SEATS) {
    contestSeat(world, seatId, elections, electedPersonIds);
  }

  events.push({ type: 'council.scrutiny_held', audience: 'town', year, seats: [...SEATS] });
  events.push(...elections);
}

function contestSeat(world: World, seatId: SeatId, events: EventDraft[], electedPersonIds: Set<string>): void {
  const campaigns = world.closedCampaigns[seatId] ?? {};
  const incumbent = seatHolder(world, seatId);
  const incumbentHouseId = incumbent?.houseId;
  const incumbentDormant = incumbentHouseId !== undefined && world.houses[incumbentHouseId]?.dormant === true;
  const contested = Object.keys(campaigns).some((houseId) => {
    const house = world.houses[houseId];

    return house !== undefined && !house.dormant && house.id !== incumbentHouseId;
  });

  // A dormant house keeps its seat while nobody contests it. The placeholder
  // election has no separate candidacy; #55 gives the holder its default
  // candidacy and turns a challenger into a normal contest. Its own campaign
  // stays where it is: it was paid for, and a later contested election or #55
  // consumes it.
  if (incumbentDormant && !contested) {
    return;
  }

  // A dormant house neither votes nor stands. Its seat is only cleared by an
  // election, never by dormancy itself.
  const candidates = Object.keys(world.houses)
    .filter((houseId) => world.houses[houseId].dormant !== true)
    .filter((houseId) => {
      const person = livingPersonOf(world, houseId);

      return person !== undefined && !electedPersonIds.has(person.id);
    })
    .sort();

  if (candidates.length === 0) {
    world.seats[seatId] = { personId: null };
    delete world.closedCampaigns[seatId];
    return;
  }

  const votes: Record<string, number> = {};
  for (const houseId of candidates) {
    const [rng, roll] = drawBelow(world.rng, 5);
    world.rng = rng;
    votes[houseId] = roll + 1 + (campaigns[houseId] ?? 0);
  }

  // Highest vote wins; a tie goes to the house that comes first by id, so the
  // result never depends on the order of the object.
  const winnerHouseId = candidates.reduce((best, houseId) => (votes[houseId] > votes[best] ? houseId : best));
  const winner = livingPersonOf(world, winnerHouseId);

  if (winner !== undefined) {
    // One office per person: to climb, the winner gives up the seat held.
    for (const seat of Object.values(world.seats)) {
      if (seat.personId === winner.id) {
        seat.personId = null;
      }
    }

    const assignment = takeSeat(world, winnerHouseId, winner.id);
    if (assignment.ok) {
      world.seats[seatId] = assignment.seat;
      electedPersonIds.add(winner.id);
    }
  }
  delete world.closedCampaigns[seatId];

  events.push({ type: 'council.election_held', audience: 'town', seatId, winnerHouseId, votes });
}

/** The first living person of a house by id, so a choice never depends on object order. */
function livingPersonOf(world: World, houseId: string): Person | undefined {
  return Object.values(world.people)
    .filter((person) => person.houseId === houseId && person.alive)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
