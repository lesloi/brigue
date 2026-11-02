import { drawBelow } from './prng.ts';
import type { Action, Event, RefusalReason } from './events.ts';
import { FORMAT_VERSION, RULES, SEATS, START_YEAR, WEEKS_PER_YEAR, type GoodId, type World } from './world.ts';

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
 * Advances one game week.
 *
 * Pure: the world passed in is never touched. We clone it up front instead of
 * threading immutable updates through every rule, which keeps the rules
 * readable; the clone is the boundary, and a test pins that the input is
 * untouched.
 *
 * Actions are applied in the order given, before the world moves. That order is
 * part of the contract: the caller (the server) is responsible for storing it,
 * because two different orders are two different weeks.
 */
export function tick(world: World, actions: readonly Action[] = []): TickResult {
  if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
    throw new WorldVersionError(world);
  }

  const next = structuredClone(world);
  const events: Event[] = [];
  // The week's own trade, good by good: sold minus bought. It is written on the
  // world once the week is over, because it prices the week that follows.
  const flow: Record<GoodId, number> = { cloth: 0, wool: 0, grain: 0 };

  for (const candidate of actions as readonly unknown[]) {
    // A stored action can be anything: it went through a database and a JSON
    // parser. An unknown one is refused, never skipped, and never thrown.
    if (!isKnownAction(candidate)) {
      events.push({ type: 'action.refused', action: 'unknown', houseId: 'unknown', reason: 'unknown_action' });
      continue;
    }

    applyAction(next, candidate, events, flow);
  }

  // The AI houses decide in the same breath as the players, at the same price:
  // both buy before the week moves the market.
  aiHousesBuy(next, flow, events);

  driftPrices(next, events);
  runWorkshops(next, flow, events);

  next.marketFlow = flow;

  if (next.week % RULES.electionPeriodWeeks === 0) {
    holdElection(next, events);
  }

  next.week += 1;
  next.year = START_YEAR + Math.floor((next.week - 1) / WEEKS_PER_YEAR);

  return { world: next, events };
}

function isKnownAction(value: unknown): value is Action {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const type = (value as { type?: unknown }).type;

  return type === 'market.buy' || type === 'council.campaign';
}

function refuse(events: Event[], action: Action, houseId: unknown, reason: RefusalReason): void {
  events.push({
    type: 'action.refused',
    action: action.type,
    houseId: typeof houseId === 'string' && houseId.length > 0 ? houseId : 'unknown',
    reason,
  });
}

function applyAction(world: World, action: Action, events: Event[], flow: Record<GoodId, number>): void {
  const house = world.houses[action.houseId];
  if (!house) {
    refuse(events, action, action.houseId, 'unknown_house');
    return;
  }

  switch (action.type) {
    case 'market.buy': {
      if (!Number.isInteger(action.units) || action.units <= 0) {
        refuse(events, action, house.id, 'invalid_quantity');
        return;
      }

      const priceCents = world.market[action.good];
      const totalCents = priceCents * action.units;
      if (house.treasuryCents < totalCents) {
        refuse(events, action, house.id, 'insufficient_funds');
        return;
      }

      house.treasuryCents -= totalCents;
      house.stock[action.good] = (house.stock[action.good] ?? 0) + action.units;
      flow[action.good] -= action.units;
      events.push({
        type: 'market.bought',
        houseId: house.id,
        good: action.good,
        units: action.units,
        priceCents,
        totalCents,
      });
      return;
    }

    case 'council.campaign': {
      if (!(action.seatId in world.seats)) {
        refuse(events, action, house.id, 'unknown_seat');
        return;
      }
      if (house.favour < RULES.campaignFavourCost) {
        refuse(events, action, house.id, 'insufficient_favour');
        return;
      }

      house.favour -= RULES.campaignFavourCost;
      const byHouse = (world.campaigns[action.seatId] ??= {});
      byHouse[house.id] = (byHouse[house.id] ?? 0) + RULES.campaignVoteBonus;
      events.push({
        type: 'council.campaigned',
        houseId: house.id,
        seatId: action.seatId,
        favourSpent: RULES.campaignFavourCost,
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
   * Net units the town put on the market last week: sold minus bought.
   * Undefined when the world has no week behind it, or none for that good: the
   * market then has no imbalance to price.
   */
  flowUnits?: number;
  /** This week's random drift, already drawn. */
  driftCents: number;
  /** The imbalance, in scales, that moves the price by a tenth of the reference. */
  pressureDivisor: number;
  /** How many weeks the gap back to the reference takes to close. */
  reversionDivisor: number;
  floorCents: number;
  ceilCents: number;
}

/**
 * The rule of the price, in whole cents.
 *
 * A week's imbalance moves the price by a tenth of the reference per scale, and
 * the price closes a fixed share of its gap back to the reference every week, so
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
 * lack, at the week's price, as far as its purse goes, and decides nothing
 * else. It is not an action, so a house that cannot pay produces no refusal:
 * its workshop simply idles, which `runWorkshops` reports.
 *
 * No margin check on purpose. A guard that stops buying once the input costs
 * more than the output makes the AI's demand switch on and off with a one-week
 * lag, and the price saws. The price is the guard.
 */
function aiHousesBuy(world: World, flow: Record<GoodId, number>, events: Event[]): void {
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];

    if (house.controller !== 'ai') {
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
      const units = Math.min(shortfall, affordable);

      if (units <= 0) {
        continue;
      }

      house.treasuryCents -= units * priceCents;
      house.stock[recipe.input] = (house.stock[recipe.input] ?? 0) + units;
      flow[recipe.input] -= units;
      events.push({
        type: 'market.bought',
        houseId: house.id,
        good: recipe.input,
        units,
        priceCents,
        totalCents: units * priceCents,
      });
    }
  }
}

function driftPrices(world: World, events: Event[]): void {
  const goods = Object.keys(world.market).sort() as Array<keyof World['market']>;

  for (const good of goods) {
    const [rng, roll] = drawBelow(world.rng, RULES.priceDriftCents * 2 + 1);
    world.rng = rng;

    const before = world.market[good];
    const after = nextPriceCents({
      priceCents: before,
      referenceCents: RULES.market[good].referenceCents,
      absorbedUnits: RULES.market[good].absorbedUnits,
      scaleUnits: RULES.market[good].scaleUnits,
      flowUnits: world.marketFlow[good],
      driftCents: roll - RULES.priceDriftCents,
      pressureDivisor: RULES.pricePressureDivisor,
      reversionDivisor: RULES.priceReversionDivisor,
      floorCents: RULES.priceFloorCents,
      ceilCents: RULES.priceCeilCents,
    });

    if (after !== before) {
      world.market[good] = after;
      events.push({ type: 'market.price_changed', good, before, after });
    }
  }
}

function runWorkshops(world: World, flow: Record<GoodId, number>, events: Event[]): void {
  for (const houseId of Object.keys(world.houses).sort()) {
    const house = world.houses[houseId];
    let workers = 0;

    for (const workshop of house.workshops) {
      workers += workshop.workers;

      const wanted = workshop.level * RULES.outputPerLevel;
      const recipe = RULES.recipes[workshop.good];
      const available = recipe ? (house.stock[recipe.input] ?? 0) : Number.POSITIVE_INFINITY;
      const units = recipe ? Math.min(wanted, Math.floor(available / recipe.perUnit)) : wanted;

      if (recipe && units < wanted) {
        events.push({
          type: 'workshop.idle',
          houseId: house.id,
          good: workshop.good,
          input: recipe.input,
          missingUnits: wanted - units,
        });
      }
      if (units === 0) {
        continue;
      }

      if (recipe) {
        house.stock[recipe.input] = available - units * recipe.perUnit;
      }

      // The market clears what the workshop makes, at the week's price: holding
      // finished cloth for a better week is not a mechanic yet, and crediting
      // both the goods and the coin would count the output twice.
      const priceCents = world.market[workshop.good];
      const revenueCents = units * priceCents;
      house.treasuryCents += revenueCents;
      flow[workshop.good] += units;

      events.push({
        type: 'market.sold',
        houseId: house.id,
        good: workshop.good,
        units,
        priceCents,
        revenueCents,
      });
    }

    employeesArePaid(world, house.id, workers, events);
  }
}

function employeesArePaid(world: World, houseId: string, workers: number, events: Event[]): void {
  const house = world.houses[houseId];
  const wages = workers * RULES.wagePerWorkerCents;

  if (wages > 0) {
    const paid = Math.min(house.treasuryCents, wages);
    house.treasuryCents -= paid;

    if (paid > 0) {
      events.push({ type: 'house.wages_paid', houseId, amountCents: paid });
    }
    if (paid < wages) {
      const shortfallCents = wages - paid;
      house.debtCents += shortfallCents;
      events.push({ type: 'house.penniless', houseId, shortfallCents });
    }
  }

  if (house.debtCents > 0 && house.treasuryCents > 0) {
    const repaid = Math.min(house.treasuryCents, house.debtCents);
    house.treasuryCents -= repaid;
    house.debtCents -= repaid;
    events.push({ type: 'house.debt_repaid', houseId, amountCents: repaid });
  }
}

function holdElection(world: World, events: Event[]): void {
  const round = world.week / RULES.electionPeriodWeeks;
  const seatId = SEATS[(round - 1) % SEATS.length];
  const bonuses = world.campaigns[seatId] ?? {};

  const votes: Record<string, number> = {};
  for (const houseId of Object.keys(world.houses).sort()) {
    const [rng, roll] = drawBelow(world.rng, 5);
    world.rng = rng;
    votes[houseId] = roll + 1 + (bonuses[houseId] ?? 0);
  }

  // Highest vote wins; a tie goes to the house that comes first by id, so the
  // result never depends on the order of the object.
  const winnerHouseId = Object.keys(votes)
    .sort()
    .reduce((best, houseId) => (votes[houseId] > votes[best] ? houseId : best));

  world.seats[seatId] = { houseId: winnerHouseId };
  delete world.campaigns[seatId];

  events.push({ type: 'council.election_held', seatId, winnerHouseId, votes });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
