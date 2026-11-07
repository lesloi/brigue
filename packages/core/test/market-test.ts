import { describe, expect, it } from 'vitest';

import { GOODS, HOURS_PER_YEAR, nextPriceCents, RULES, stockCapacityUnits, stockUnits } from '../src/index.ts';
import type { Action, Event, World } from '../src/index.ts';
import { playHalfDay, playUntil, tick, town } from './helpers.ts';

const SEED = 20261029;

/** A world where the weaver is idle, so the hour's flow is only the town's. */
function playWeek(world: World, actions: Action[] = []): { world: World; events: Event[] } {
  return tick(world, actions);
}

/**
 * One period: the town plays the actions on its first hour, then runs to the
 * bell, where the accumulated flow prices the market.
 */
function playPeriod(world: World, actions: Action[] = []): World {
  return playHalfDay(world, actions).world;
}

/** The cloth price the bell sets for a half-day flow, drift aside. */
function pricedCloth(flowUnits: number): number {
  const hours = HOURS_PER_YEAR / 2;

  return nextPriceCents({
    priceCents: RULES.market.cloth.referenceCents,
    referenceCents: RULES.market.cloth.referenceCents,
    absorbedUnits: RULES.market.cloth.absorbedUnits * hours,
    scaleUnits: RULES.market.cloth.scaleUnits * hours,
    flowUnits,
    driftCents: 0,
    pressureDivisor: RULES.pricePressureDivisor,
    reversionDivisor: RULES.priceReversionDivisor,
    floorCents: RULES.priceFloorCents,
    ceilCents: RULES.priceCeilCents,
  });
}

describe('nextPriceCents', () => {
  const base = {
    priceCents: 1240,
    referenceCents: 1240,
    absorbedUnits: 10,
    scaleUnits: 10,
    driftCents: 0,
    pressureDivisor: RULES.pricePressureDivisor,
    reversionDivisor: RULES.priceReversionDivisor,
    floorCents: RULES.priceFloorCents,
    ceilCents: RULES.priceCeilCents,
  };

  it('holds at the reference when the town supplies what the market absorbs', () => {
    expect(nextPriceCents({ ...base, flowUnits: 10 })).toBe(1240);
  });

  it('falls by a tenth of the reference for a surplus of one scale', () => {
    expect(nextPriceCents({ ...base, flowUnits: 20 })).toBe(1116);
    expect(nextPriceCents({ ...base, flowUnits: 5 })).toBe(1302);
  });

  it('takes no view on a good the town has never traded', () => {
    expect(nextPriceCents({ ...base, flowUnits: undefined })).toBe(1240);
  });

  it("prices the town's standing demand, not just what is offered", () => {
    // Arrange: bread's absorption is ten in this table. A hour with nothing
    // offered and nothing bought is a hour in which the town went short.
    const bread = { ...base, priceCents: 520, referenceCents: 520 };

    // Act and assert: a full scale of shortage is a tenth of the reference.
    expect(nextPriceCents({ ...bread, flowUnits: 0 })).toBe(572);
    expect(nextPriceCents({ ...bread, flowUnits: 10 })).toBe(520);
  });

  it('closes a quarter of the gap to the reference', () => {
    expect(nextPriceCents({ ...base, priceCents: 840, flowUnits: 10 })).toBe(940);
  });

  it('stays between the floor and the ceiling', () => {
    expect(nextPriceCents({ ...base, flowUnits: 10_000 })).toBe(RULES.priceFloorCents);
    expect(nextPriceCents({ ...base, flowUnits: -10_000 })).toBe(RULES.priceCeilCents);
  });

  it('always answers in whole cents', () => {
    for (const priceCents of [100, 381, 1240, 4999]) {
      for (const flowUnits of [-13, -1, 0, 3, 27]) {
        expect(Number.isInteger(nextPriceCents({ ...base, priceCents, flowUnits }))).toBe(true);
      }
    }
  });
});

describe('the market of a hour', () => {
  it('holds its price until the first bell', () => {
    // Arrange: a fresh world has no hour behind it, so nothing has been traded.
    const { world } = playWeek(town(SEED));

    // Assert: only the hour's own drift moved the prices.
    for (const good of GOODS) {
      const drift = world.market[good] - RULES.market[good].referenceCents;
      expect(Math.abs(drift)).toBeLessThanOrEqual(RULES.priceDriftCents);
    }
  });

  it('records the flow the next bell will price', () => {
    // Arrange
    const { world } = playWeek(town(SEED));

    // Act and assert: sold minus bought, per good. The first dynasty produces but
    // does not sell; every AI dynasty buys its input and sells what it produced.
    expect(world.marketFlow).toEqual({
      wool: -6,
      cloth: 6,
      grain: -4,
      bread: 4,
      wood: -4,
      planks: 4,
    });
  });

  it('takes a sale into the flow, not the price', () => {
    // Arrange: a dynasty with cloth to sell and no workshop of its own.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [];
    world.dynasties.leclerc.stock = { cloth: 20 };

    // Act
    const { world: after } = playWeek(world, [{ type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 20 }]);

    // Assert: the price only drifted; the flow is stored for the next hour.
    expect(Math.abs(after.market.cloth - RULES.market.cloth.referenceCents)).toBeLessThanOrEqual(RULES.priceDriftCents);
    expect(after.marketFlow.cloth).toBe(26);
  });

  it('lets a purchase of a finished good raise the price the following hour', () => {
    // Arrange: Caron makes and sells six cloth an hour, so a half-day prices
    // seventy-two units; the player buys twenty more.
    const control = playPeriod(town(SEED));
    const bought = playPeriod(town(SEED), [{ type: 'market.buy', dynastyId: 'leclerc', good: 'cloth', units: 20 }]);
    const townFlow = 6 * (HOURS_PER_YEAR / 2);

    // Act: twenty fewer cloth on the market than in the control hour.
    const difference = bought.market.cloth - control.market.cloth;

    // Assert
    expect(difference).toBe(pricedCloth(townFlow - 20) - pricedCloth(townFlow));
  });

  it('lets an unclaimed cloth glut lower the price', () => {
    // Arrange: a dynasty sells twenty cloth it did not make, against the town
    // that only sold what its workshops produced.
    const selling = town(SEED);
    selling.dynasties.leclerc.workshops = [];
    selling.dynasties.leclerc.stock = { cloth: 20 };
    const glut = playPeriod(selling, [{ type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 20 }]);
    const control = playPeriod(town(SEED));
    const townFlow = 6 * (HOURS_PER_YEAR / 2);

    // Act: twenty units of extra cloth on top of the AI's own seventy-two.
    const difference = glut.market.cloth - control.market.cloth;

    // Assert
    expect(difference).toBe(pricedCloth(townFlow + 20) - pricedCloth(townFlow));
  });

  it('prices a sale against the town that did not sell', () => {
    // Arrange: one town sells twenty cloth, the other keeps it in the warehouse.
    const selling = town(SEED);
    selling.dynasties.leclerc.workshops = [];
    selling.dynasties.leclerc.stock = { cloth: 20 };
    const control = town(SEED);

    // Act: twenty extra cloth on the market, against a market that absorbs
    // eight.
    const withSale = playPeriod(selling, [{ type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 20 }]);
    const withoutSale = playPeriod(control);

    // Assert: the same first-bell price and the same drift, so only the flow
    // differs. The pull's integer truncation is part of the rule and stays in
    // the expected value rather than being approximated.
    const hours = HOURS_PER_YEAR / 2;
    const rule = {
      referenceCents: RULES.market.cloth.referenceCents,
      absorbedUnits: RULES.market.cloth.absorbedUnits * hours,
      scaleUnits: RULES.market.cloth.scaleUnits * hours,
      driftCents: 0,
      pressureDivisor: RULES.pricePressureDivisor,
      reversionDivisor: RULES.priceReversionDivisor,
      floorCents: RULES.priceFloorCents,
      ceilCents: RULES.priceCeilCents,
    };
    // Both towns leave the same market: the AI sells six cloth an hour, and one
    // first dynasty adds twenty on top of it.
    const expected =
      nextPriceCents({ ...rule, priceCents: RULES.market.cloth.referenceCents, flowUnits: 6 * hours }) -
      nextPriceCents({ ...rule, priceCents: RULES.market.cloth.referenceCents, flowUnits: 6 * hours + 20 });

    expect(withoutSale.market.cloth - withSale.market.cloth).toBe(expected);
  });
});

describe('the prices of a month', () => {
  const halfDay = HOURS_PER_YEAR / 2;
  const monthHours = 30 * HOURS_PER_YEAR;
  const finishedGoods = GOODS.filter((good) => RULES.recipes[good] !== null);

  it('turns the finished prices around their reference in a one-player town', () => {
    // Arrange: the issue's town, a baker who never trades, played for thirty
    // days. The three AI dynasties alone are short of the town's demand, so the
    // chains nobody works sit in the upper half of the badge's band.
    let world = town(SEED, 'baker');
    const prices = finishedGoods.map(() => [] as number[]);

    // Act
    for (let bell = halfDay; bell <= monthHours; bell += halfDay) {
      world = playUntil(world, bell).world;
      finishedGoods.forEach((good, index) => prices[index].push(world.market[good]));
    }

    // Assert
    finishedGoods.forEach((good, index) => {
      const reference = RULES.market[good].referenceCents;
      const bells = prices[index];
      const sum = bells.reduce((total, price) => total + price, 0);

      // The mean sits a little above the reference: the town is one workshop
      // short, and a player working the chain is what closes the gap.
      expect(sum * 100).toBeGreaterThan(reference * 105 * bells.length);
      expect(sum * 100).toBeLessThan(reference * 112 * bells.length);

      // Every bell stays inside a twenty-per-cent band around the reference,
      // both sides included; the badge, at ten, marks the edges the town's own
      // flow pushes past.
      for (const price of bells) {
        expect(Math.abs(price - reference) * 100).toBeLessThanOrEqual(reference * 20);
      }
    });
  });

  it('lets the badge mark both sides of the reference in a normal month', () => {
    // Arrange: the same town, played as a standing order — the player sells the
    // bread the workshop made and buys the grain it needs, every hour.
    let world = town(SEED, 'baker');
    const cheap = new Set<string>();
    const dear = new Set<string>();
    const refusals: Event[] = [];
    const breadPrices: number[] = [];

    // Act
    for (let hour = 1; hour <= monthHours; hour += 1) {
      const dynasty = world.dynasties.leclerc;
      const wanted = dynasty.workshops[0].level * RULES.outputPerLevel;
      const actions: Action[] = [];
      const bread = dynasty.stock.bread ?? 0;
      const missing = wanted - (dynasty.stock.grain ?? 0);

      if (bread > 0) {
        actions.push({ type: 'market.sell', dynastyId: 'leclerc', good: 'bread', units: bread });
      }
      if (missing > 0) {
        actions.push({ type: 'market.buy', dynastyId: 'leclerc', good: 'grain', units: missing });
      }

      const result = tick(world, actions);
      world = result.world;
      refusals.push(
        ...result.events.filter((event) => event.type === 'action.refused' && event.dynastyId === 'leclerc'),
      );
      if (hour % halfDay !== 0) {
        continue;
      }

      breadPrices.push(world.market.bread);
      for (const good of finishedGoods) {
        const reference = RULES.market[good].referenceCents;
        if (world.market[good] * 100 <= reference * 90) {
          cheap.add(good);
        }
        if (world.market[good] * 100 >= reference * 110) {
          dear.add(good);
        }
      }
    }

    // Assert: the orders always filled, so the prices below are the ones the
    // player actually faced.
    expect(refusals).toEqual([]);

    // The bread the player sold glutted its chain, while a chain nobody worked
    // stayed dear: both edges of the badge fire in the same month. The worked
    // chain also sits at or below its reference, as the decision says.
    const breadReference = RULES.market.bread.referenceCents;
    const breadSum = breadPrices.reduce((total, price) => total + price, 0);
    expect(breadSum * 100).toBeLessThanOrEqual(breadReference * 100 * breadPrices.length);
    expect(cheap.size).toBeGreaterThan(0);
    expect(dear.size).toBeGreaterThan(0);
  });
});

describe('the warehouse', () => {
  it('credits production to the stock, not to the purse', () => {
    // Arrange: the upkeep of the loom is the only thing that may move money.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'cloth', level: 2 }];
    world.dynasties.leclerc.stock = { wool: 8 };
    const treasuryCents = world.dynasties.leclerc.treasuryCents - 2 * RULES.upkeepPerWorkshopLevelCents;

    // Act
    const { world: after, events } = playWeek(world);

    // Assert
    expect(after.dynasties.leclerc.stock.cloth).toBe(4);
    expect(after.dynasties.leclerc.stock.wool).toBe(4);
    expect(after.dynasties.leclerc.treasuryCents).toBe(treasuryCents);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'workshop.produced',
        audience: { dynastyId: 'leclerc' },
        dynastyId: 'leclerc',
        good: 'cloth',
        units: 4,
      }),
    );
  });

  it("credits a sale at the hour's price", () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [];
    world.dynasties.leclerc.stock = { cloth: 10 };
    world.dynasties.leclerc.treasuryCents = 0;
    const priceCents = world.market.cloth;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 4 },
    ]);

    // Assert
    expect(after.dynasties.leclerc.treasuryCents).toBe(priceCents * 4);
    expect(after.dynasties.leclerc.stock.cloth).toBe(6);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'market.sold',
        audience: 'town',
        dynastyId: 'leclerc',
        good: 'cloth',
        units: 4,
        priceCents,
        revenueCents: priceCents * 4,
      }),
    );
  });

  it('refuses a sale of more stock than the dynasty holds', () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [];
    world.dynasties.leclerc.stock = { cloth: 2 };
    const treasuryCents = world.dynasties.leclerc.treasuryCents;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 3 },
    ]);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { dynastyId: 'leclerc' },
        action: 'market.sell',
        dynastyId: 'leclerc',
        reason: 'insufficient_stock',
      }),
    );
    expect(after.dynasties.leclerc.treasuryCents).toBe(treasuryCents);
    expect(after.dynasties.leclerc.stock.cloth).toBe(2);
  });

  it('refuses a purchase that would overflow the warehouse', () => {
    // Arrange: a full warehouse and a purse that could pay. The loom runs on
    // nothing, so its upkeep is the only charge between here and the refusal.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 2 }];
    world.dynasties.leclerc.stock = { wool: stockCapacityUnits(world.dynasties.leclerc) };
    world.dynasties.leclerc.treasuryCents = 1_000_000;
    const upkeep = 2 * RULES.upkeepPerWorkshopLevelCents;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 1 },
    ]);

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'action.refused',
        audience: { dynastyId: 'leclerc' },
        action: 'market.buy',
        dynastyId: 'leclerc',
        reason: 'stock_full',
      }),
    );
    expect(stockUnits(after.dynasties.leclerc)).toBe(stockCapacityUnits(after.dynasties.leclerc));
    expect(after.dynasties.leclerc.treasuryCents).toBe(1_000_000 - upkeep);
  });

  it('refuses production that does not fit in the warehouse', () => {
    // Arrange: a raw workshop with one unit of room left.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 2 }];
    world.dynasties.leclerc.stock = { cloth: stockCapacityUnits(world.dynasties.leclerc) - 1 };

    // Act
    const { world: after, events } = playWeek(world);

    // Assert: four wool were wanted, one fit, and the three refused are named.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'workshop.overflow',
        audience: { dynastyId: 'leclerc' },
        dynastyId: 'leclerc',
        good: 'wool',
        refusedUnits: 3,
      }),
    );
    expect(stockUnits(after.dynasties.leclerc)).toBe(stockCapacityUnits(after.dynasties.leclerc));
    expect(after.dynasties.leclerc.stock.wool).toBe(1);
  });

  it('lets a full dynasty make room by selling, then produce again', () => {
    // Arrange: a warehouse full of cloth and a loom that cannot start.
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'cloth', level: 2 }];
    world.dynasties.leclerc.stock = { cloth: stockCapacityUnits(world.dynasties.leclerc) };
    world.dynasties.leclerc.treasuryCents = 1_000_000;

    // Act: a purchase is refused while the warehouse is full; selling makes
    // room, and the bought wool is then woven.
    const full = playWeek(world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 1 }]);
    const sold = playWeek(full.world, [{ type: 'market.sell', dynastyId: 'leclerc', good: 'cloth', units: 10 }]);
    const bought = playWeek(sold.world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 10 }]);

    // Assert
    expect(full.events).toContainEqual(expect.objectContaining({ type: 'action.refused', reason: 'stock_full' }));
    expect(bought.events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', dynastyId: 'leclerc', good: 'wool', units: 10 }),
    );
    expect(bought.events).toContainEqual(
      expect.objectContaining({ type: 'workshop.produced', dynastyId: 'leclerc', good: 'cloth', units: 4 }),
    );
    expect(stockUnits(bought.world.dynasties.leclerc)).toBe(stockCapacityUnits(bought.world.dynasties.leclerc));
  });

  it('refuses an unknown good before it can touch the purse', () => {
    for (const type of ['market.buy', 'market.sell'] as const) {
      // Arrange: a poisoned stored action, which a database and a JSON parser
      // can still hand to the tick. The upkeep is the only charge, so the action
      // is the only thing that could otherwise move money.
      const world = town(SEED);
      world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'cloth', level: 2 }];
      const treasuryCents = world.dynasties.leclerc.treasuryCents - 2 * RULES.upkeepPerWorkshopLevelCents;
      const malformed = { type, dynastyId: 'leclerc', good: 'gold', units: 1 } as unknown as Action;

      // Act
      const { world: after, events } = playWeek(world, [malformed]);

      // Assert
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'action.refused',
          audience: { dynastyId: 'leclerc' },
          action: type,
          dynastyId: 'leclerc',
          reason: 'unknown_good',
        }),
      );
      expect(after.dynasties.leclerc.treasuryCents).toBe(treasuryCents);
    }
  });
});

describe('an AI dynasty', () => {
  it('buys the input its chain lacks instead of idling', () => {
    // Arrange: Caron has no wool, Fournier no grain, Charpentier no wood.
    const { events, world } = playWeek(town(SEED));

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', dynastyId: 'caron', good: 'wool', units: 6 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', dynastyId: 'fournier', good: 'grain', units: 4 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', dynastyId: 'charpentier', good: 'wood', units: 4 }),
    );
    expect(world.dynasties.caron.stock).toEqual({});
    expect(world.dynasties.fournier.stock).toEqual({});
    expect(world.dynasties.charpentier.stock).toEqual({});
  });

  it('sells its whole stock every hour', () => {
    // Arrange
    let current = town(SEED);

    // Act and assert: no AI dynasty holds a unit across the hour.
    for (let hour = 0; hour < 10; hour += 1) {
      current = playWeek(current).world;
      for (const dynasty of Object.values(current.dynasties)) {
        if (dynasty.controller === 'ai') {
          expect(stockUnits(dynasty)).toBe(0);
        }
      }
    }
  });

  it("does not sell a human dynasty's stock", () => {
    // Arrange: the first dynasty is the weaver and must keep its bet.
    const { world, events } = playWeek(town(SEED));

    // Assert
    expect(world.dynasties.leclerc.stock.cloth).toBe(4);
    expect(world.dynasties.leclerc.stock.wool).toBe(4);
    expect(events.filter((event) => event.type === 'market.sold' && event.dynastyId === 'leclerc')).toEqual([]);
  });

  it("does not sell a dormant dynasty's stock", () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.caron.dormant = true;
    world.dynasties.caron.stock = { cloth: 5 };

    // Act
    const { world: after, events } = playWeek(world);

    // Assert
    expect(after.dynasties.caron.stock.cloth).toBe(5);
    expect(events.filter((event) => event.type === 'market.sold' && event.dynastyId === 'caron')).toEqual([]);
  });

  it('never idles once it can pay for its input', () => {
    // Arrange
    let current = town(SEED);
    const idles: Event[] = [];

    // Act: a long run, because a demand that switches on and off would show here.
    for (let hour = 0; hour < 200; hour += 1) {
      const result = playWeek(current);
      current = result.world;
      idles.push(...result.events.filter((event) => event.type === 'workshop.idle' && event.dynastyId === 'caron'));
    }

    // Assert
    expect(idles).toEqual([]);
  });

  it('settles the prices instead of making them saw', () => {
    // Arrange
    let current = town(SEED);

    // Act
    for (let hour = 0; hour < 200; hour += 1) {
      current = playWeek(current).world;
    }

    // Assert: the equilibria are derived from the half-day's flows and the
    // price rule. Caron makes six cloth against an absorption of eight, so the
    // cloth pressure is +24 and the pull closes a quarter of the gap:
    // 1240 + 4 × 24. Fournier makes four bread against six, so 520 + 4 × 10;
    // Charpentier four planks against six, so 980 + 4 × 24. Wool, grain and
    // wood carry no flow and only drift around their references. The drift is
    // ±30 and the reversion keeps it within about four drifts.
    expect(current.market.wool).toBeGreaterThan(300);
    expect(current.market.wool).toBeLessThan(620);
    expect(current.market.cloth).toBeGreaterThan(1240);
    expect(current.market.cloth).toBeLessThan(1430);
    expect(current.market.grain).toBeGreaterThan(110);
    expect(current.market.grain).toBeLessThan(410);
    expect(current.market.bread).toBeGreaterThan(500);
    expect(current.market.bread).toBeLessThan(620);
    expect(current.market.wood).toBeGreaterThan(150);
    expect(current.market.wood).toBeLessThan(450);
    expect(current.market.planks).toBeGreaterThan(990);
    expect(current.market.planks).toBeLessThan(1160);
    for (const price of Object.values(current.market)) {
      expect(price).toBeGreaterThan(RULES.priceFloorCents);
      expect(price).toBeLessThan(RULES.priceCeilCents);
    }
  });

  it('stays idle, without buying, when it cannot pay', () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.caron.treasuryCents = 0;
    world.dynasties.caron.stock = {};

    // Act
    const { events } = playWeek(world);

    // Assert
    expect(events.filter((event) => event.type === 'market.bought' && event.dynastyId === 'caron')).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'workshop.idle',
        audience: { dynastyId: 'caron' },
        dynastyId: 'caron',
        good: 'cloth',
        input: 'wool',
        missingUnits: 6,
      }),
    );
  });

  it('never buys an input it does not need', () => {
    // Arrange
    let current = town(SEED);
    const bought = new Map<string, Set<string>>();

    // Act
    for (let hour = 0; hour < 20; hour += 1) {
      const result = playWeek(current);
      current = result.world;
      for (const event of result.events) {
        if (event.type !== 'market.bought') {
          continue;
        }
        const goods = bought.get(event.dynastyId) ?? new Set<string>();
        goods.add(event.good);
        bought.set(event.dynastyId, goods);
      }
    }

    // Assert: one input per chain, and only the chain that needs it.
    expect([...bought.keys()].sort()).toEqual(['caron', 'charpentier', 'fournier']);
    expect([...(bought.get('caron') ?? [])]).toEqual(['wool']);
    expect([...(bought.get('charpentier') ?? [])]).toEqual(['wood']);
    expect([...(bought.get('fournier') ?? [])]).toEqual(['grain']);
  });

  it('pays the same price as the player does in the same hour', () => {
    // Arrange
    const world = town(SEED);
    const priceCents = world.market.wool;

    // Act
    const { events } = playWeek(world, [{ type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units: 2 }]);

    // Assert
    const purchases = events.filter((event) => event.type === 'market.bought' && event.good === 'wool');
    expect(purchases).toHaveLength(2);
    for (const purchase of purchases) {
      expect(purchase).toMatchObject({ priceCents });
    }
  });
});
