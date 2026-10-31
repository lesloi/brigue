import { drawBelow } from './prng.ts';
import type { Action, Event, RefusalReason } from './events.ts';
import { FORMAT_VERSION, RULES, SEATS, START_YEAR, WEEKS_PER_YEAR, type World } from './world.ts';

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

  for (const candidate of actions as readonly unknown[]) {
    // A stored action can be anything: it went through a database and a JSON
    // parser. An unknown one is refused, never skipped, and never thrown.
    if (!isKnownAction(candidate)) {
      events.push({ type: 'action.refused', action: 'unknown', houseId: 'unknown', reason: 'unknown_action' });
      continue;
    }

    applyAction(next, candidate, events);
  }

  driftPrices(next, events);
  runWorkshops(next, events);

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

function applyAction(world: World, action: Action, events: Event[]): void {
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

function driftPrices(world: World, events: Event[]): void {
  const goods = Object.keys(world.market).sort() as Array<keyof World['market']>;

  for (const good of goods) {
    const [rng, roll] = drawBelow(world.rng, RULES.priceDriftCents * 2 + 1);
    world.rng = rng;

    const before = world.market[good];
    const after = clamp(before + roll - RULES.priceDriftCents, RULES.priceFloorCents, RULES.priceCeilCents);
    if (after !== before) {
      world.market[good] = after;
      events.push({ type: 'market.price_changed', good, before, after });
    }
  }
}

function runWorkshops(world: World, events: Event[]): void {
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
