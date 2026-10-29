import { drawBelow } from './prng.ts';
import type { Action, Event } from './events.ts';
import { RULES, SEATS, START_YEAR, WEEKS_PER_YEAR, type World } from './world.ts';

export interface TickResult {
  world: World;
  events: Event[];
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
  const next = structuredClone(world);
  const events: Event[] = [];

  for (const action of actions) {
    applyAction(next, action, events);
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

function applyAction(world: World, action: Action, events: Event[]): void {
  const house = world.houses[action.houseId];
  if (!house) {
    throw new Error(`unknown house ${action.houseId}`);
  }

  switch (action.type) {
    case 'market.buy': {
      if (!Number.isInteger(action.units) || action.units <= 0) {
        throw new RangeError(`market.buy needs a positive integer, got ${action.units}`);
      }
      const priceCents = world.market[action.good];
      const totalCents = priceCents * action.units;
      if (house.treasuryCents < totalCents) {
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
        throw new Error(`unknown seat ${action.seatId}`);
      }
      if (house.favour < RULES.campaignFavourCost) {
        return;
      }
      house.favour -= RULES.campaignFavourCost;
      world.campaigns[house.id] = (world.campaigns[house.id] ?? 0) + RULES.campaignVoteBonus;
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
      const units = workshop.level * RULES.outputPerLevel;
      const priceCents = world.market[workshop.good];
      const revenueCents = units * priceCents;

      house.stock[workshop.good] = (house.stock[workshop.good] ?? 0) + units;
      house.treasuryCents += revenueCents;
      workers += workshop.workers;

      events.push({
        type: 'market.sold',
        houseId: house.id,
        good: workshop.good,
        units,
        priceCents,
        revenueCents,
      });
    }

    const wages = workers * RULES.wagePerWorkerCents;
    if (wages === 0) {
      continue;
    }

    if (house.treasuryCents >= wages) {
      house.treasuryCents -= wages;
      events.push({ type: 'house.wages_paid', houseId: house.id, amountCents: wages });
    } else {
      const shortfallCents = wages - house.treasuryCents;
      house.treasuryCents = 0;
      events.push({ type: 'house.penniless', houseId: house.id, shortfallCents });
    }
  }
}

function holdElection(world: World, events: Event[]): void {
  const round = world.week / RULES.electionPeriodWeeks;
  const seatId = SEATS[(round - 1) % SEATS.length];

  const votes: Record<string, number> = {};
  for (const houseId of Object.keys(world.houses).sort()) {
    const [rng, roll] = drawBelow(world.rng, 5);
    world.rng = rng;
    votes[houseId] = roll + 1 + (world.campaigns[houseId] ?? 0);
  }

  const winnerHouseId = Object.keys(votes)
    .sort()
    .reduce((best, houseId) => (votes[houseId] > votes[best] ? houseId : best));

  world.seats[seatId] = { houseId: winnerHouseId };
  world.campaigns = {};

  events.push({ type: 'council.election_held', seatId, winnerHouseId, votes });
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
