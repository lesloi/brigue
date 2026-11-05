import { describe, expect, it } from 'vitest';

import { createWorld, GOODS, nextPriceCents, RULES, stockUnits, tick } from '../src/index.ts';
import type { Action, Event, World } from '../src/index.ts';

const SEED = 20261029;

/** A world where the weaver is idle, so the week's flow is only the town's. */
function playWeek(world: World, actions: Action[] = []): { world: World; events: Event[] } {
  return tick(world, actions);
}

/**
 * The price of a week is moved by the flow of the week before it, so a test of
 * the rule needs two weeks: the first records the flow, the second prices it.
 */
function twoWeeks(world: World, actions: Action[] = []): World {
  return playWeek(playWeek(world, actions).world).world;
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
    // Arrange: bread is absorbed ten a week. A week with nothing offered and
    // nothing bought is a week in which the town went short.
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

describe('the market of a week', () => {
  it('takes no view on the first week of a world', () => {
    // Arrange: a fresh world has no week behind it, so nothing has been traded.
    const { world } = playWeek(createWorld(SEED));

    // Assert: only the week's own drift moved the prices.
    for (const good of GOODS) {
      const drift = world.market[good] - RULES.market[good].referenceCents;
      expect(Math.abs(drift)).toBeLessThanOrEqual(RULES.priceDriftCents);
    }
  });

  it('records the week it will price next week', () => {
    // Arrange
    const { world } = playWeek(createWorld(SEED));

    // Act and assert: sold minus bought, per good. The founder produces but
    // does not sell; every AI house sells what it produced.
    expect(world.marketFlow).toEqual({
      wool: -2,
      cloth: 6,
      grain: 0,
      bread: 4,
      wood: 0,
      planks: 4,
    });
  });

  it("takes a week's sale into next week's flow, not this week's price", () => {
    // Arrange: a house with cloth to sell and no workshop of its own.
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [];
    world.houses.brigue.stock = { cloth: 20 };

    // Act
    const { world: after } = playWeek(world, [{ type: 'market.sell', houseId: 'brigue', good: 'cloth', units: 20 }]);

    // Assert: the price only drifted; the flow is stored for the next week.
    expect(Math.abs(after.market.cloth - RULES.market.cloth.referenceCents)).toBeLessThanOrEqual(RULES.priceDriftCents);
    expect(after.marketFlow.cloth).toBe(26);
  });

  it('lets a purchase raise the price the following week', () => {
    // Arrange
    const control = twoWeeks(createWorld(SEED));
    const bought = twoWeeks(createWorld(SEED), [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 20 }]);

    // Act: twenty fewer wool on the market than in the control week.
    const difference = bought.market.wool - control.market.wool;

    // Assert
    expect(difference).toBe(
      Math.trunc((20 * RULES.market.wool.referenceCents) / (RULES.pricePressureDivisor * RULES.market.wool.scaleUnits)),
    );
  });

  it('lets an unclaimed wool glut lower the price', () => {
    // Arrange: Vandermeersch sells four wool a week; here the weaver buys four,
    // so the town's wool balance is closer to level and the glut is smaller.
    const glut = twoWeeks(createWorld(SEED));
    const balanced = twoWeeks(createWorld(SEED), [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 4 }]);

    // Act: four units of imbalance, half a scale of four.
    const difference = balanced.market.wool - glut.market.wool;

    // Assert
    expect(difference).toBe(
      Math.trunc((4 * RULES.market.wool.referenceCents) / (RULES.pricePressureDivisor * RULES.market.wool.scaleUnits)),
    );
  });

  it('prices a sale against the town that did not sell', () => {
    // Arrange: one town sells twenty cloth, the other keeps it in the warehouse.
    const selling = createWorld(SEED);
    selling.houses.brigue.workshops = [];
    selling.houses.brigue.stock = { cloth: 20 };
    const control = createWorld(SEED);
    const weekOne = playWeek(createWorld(SEED)).world.market.cloth;

    // Act: twenty extra cloth on the market, against a market that absorbs ten.
    const withSale = twoWeeks(selling, [{ type: 'market.sell', houseId: 'brigue', good: 'cloth', units: 20 }]);
    const withoutSale = twoWeeks(control);

    // Assert: the same week-one price and the same drift, so only the flow
    // differs. The pull's integer truncation is part of the rule and stays in
    // the expected value rather than being approximated.
    const rule = {
      referenceCents: RULES.market.cloth.referenceCents,
      absorbedUnits: RULES.market.cloth.absorbedUnits,
      scaleUnits: RULES.market.cloth.scaleUnits,
      driftCents: 0,
      pressureDivisor: RULES.pricePressureDivisor,
      reversionDivisor: RULES.priceReversionDivisor,
      floorCents: RULES.priceFloorCents,
      ceilCents: RULES.priceCeilCents,
    };
    const expected =
      nextPriceCents({ ...rule, priceCents: weekOne, flowUnits: 6 }) -
      nextPriceCents({ ...rule, priceCents: weekOne, flowUnits: 26 });

    expect(withoutSale.market.cloth - withSale.market.cloth).toBe(expected);
  });
});

describe('the warehouse', () => {
  it('credits production to the stock, not to the purse', () => {
    // Arrange: a workshop with no wages, so only production could move money.
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [{ good: 'cloth', level: 2, workers: 0 }];
    world.houses.brigue.stock = { wool: 8 };
    const treasuryCents = world.houses.brigue.treasuryCents;

    // Act
    const { world: after, events } = playWeek(world);

    // Assert
    expect(after.houses.brigue.stock.cloth).toBe(4);
    expect(after.houses.brigue.stock.wool).toBe(4);
    expect(after.houses.brigue.treasuryCents).toBe(treasuryCents);
    expect(events).toContainEqual({
      type: 'workshop.produced',
      audience: { houseId: 'brigue' },
      houseId: 'brigue',
      good: 'cloth',
      units: 4,
    });
  });

  it("credits a sale at the week's price", () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [];
    world.houses.brigue.stock = { cloth: 10 };
    world.houses.brigue.treasuryCents = 0;
    const priceCents = world.market.cloth;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.sell', houseId: 'brigue', good: 'cloth', units: 4 },
    ]);

    // Assert
    expect(after.houses.brigue.treasuryCents).toBe(priceCents * 4);
    expect(after.houses.brigue.stock.cloth).toBe(6);
    expect(events).toContainEqual({
      type: 'market.sold',
      audience: 'town',
      houseId: 'brigue',
      good: 'cloth',
      units: 4,
      priceCents,
      revenueCents: priceCents * 4,
    });
  });

  it('refuses a sale of more stock than the house holds', () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [];
    world.houses.brigue.stock = { cloth: 2 };
    const treasuryCents = world.houses.brigue.treasuryCents;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.sell', houseId: 'brigue', good: 'cloth', units: 3 },
    ]);

    // Assert
    expect(events).toContainEqual({
      type: 'action.refused',
      audience: { houseId: 'brigue' },
      action: 'market.sell',
      houseId: 'brigue',
      reason: 'insufficient_stock',
    });
    expect(after.houses.brigue.treasuryCents).toBe(treasuryCents);
    expect(after.houses.brigue.stock.cloth).toBe(2);
  });

  it('refuses a purchase that would overflow the warehouse', () => {
    // Arrange: a full warehouse and a purse that could pay.
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [];
    world.houses.brigue.stock = { cloth: RULES.stockCapacityUnits };
    world.houses.brigue.treasuryCents = 1_000_000;

    // Act
    const { world: after, events } = playWeek(world, [
      { type: 'market.buy', houseId: 'brigue', good: 'wool', units: 1 },
    ]);

    // Assert
    expect(events).toContainEqual({
      type: 'action.refused',
      audience: { houseId: 'brigue' },
      action: 'market.buy',
      houseId: 'brigue',
      reason: 'stock_full',
    });
    expect(stockUnits(after.houses.brigue)).toBe(RULES.stockCapacityUnits);
    expect(after.houses.brigue.treasuryCents).toBe(1_000_000);
  });

  it('refuses production that does not fit in the warehouse', () => {
    // Arrange: a raw workshop with one unit of room left.
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [{ good: 'wool', level: 2, workers: 0 }];
    world.houses.brigue.stock = { cloth: RULES.stockCapacityUnits - 1 };

    // Act
    const { world: after, events } = playWeek(world);

    // Assert: four wool were wanted, one fit, and the three refused are named.
    expect(events).toContainEqual({
      type: 'workshop.overflow',
      audience: { houseId: 'brigue' },
      houseId: 'brigue',
      good: 'wool',
      refusedUnits: 3,
    });
    expect(stockUnits(after.houses.brigue)).toBe(RULES.stockCapacityUnits);
    expect(after.houses.brigue.stock.wool).toBe(1);
  });

  it('lets a full house make room by selling, then produce again', () => {
    // Arrange: a warehouse full of cloth and a loom that cannot start.
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [{ good: 'cloth', level: 2, workers: 0 }];
    world.houses.brigue.stock = { cloth: RULES.stockCapacityUnits };
    world.houses.brigue.treasuryCents = 1_000_000;

    // Act: a purchase is refused while the warehouse is full; selling makes
    // room, and the bought wool is then woven.
    const full = playWeek(world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 1 }]);
    const sold = playWeek(full.world, [{ type: 'market.sell', houseId: 'brigue', good: 'cloth', units: 10 }]);
    const bought = playWeek(sold.world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 10 }]);

    // Assert
    expect(full.events).toContainEqual(expect.objectContaining({ type: 'action.refused', reason: 'stock_full' }));
    expect(bought.events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'brigue', good: 'wool', units: 10 }),
    );
    expect(bought.events).toContainEqual(
      expect.objectContaining({ type: 'workshop.produced', houseId: 'brigue', good: 'cloth', units: 4 }),
    );
    expect(stockUnits(bought.world.houses.brigue)).toBe(RULES.stockCapacityUnits);
  });

  it('refuses an unknown good before it can touch the purse', () => {
    for (const type of ['market.buy', 'market.sell'] as const) {
      // Arrange: a poisoned stored action, which a database and a JSON parser
      // can still hand to the tick. No wages, so only the action could move money.
      const world = createWorld(SEED);
      world.houses.brigue.workshops = [{ good: 'cloth', level: 2, workers: 0 }];
      const treasuryCents = world.houses.brigue.treasuryCents;
      const malformed = { type, houseId: 'brigue', good: 'gold', units: 1 } as unknown as Action;

      // Act
      const { world: after, events } = playWeek(world, [malformed]);

      // Assert
      expect(events).toContainEqual({
        type: 'action.refused',
        audience: { houseId: 'brigue' },
        action: type,
        houseId: 'brigue',
        reason: 'unknown_good',
      });
      expect(after.houses.brigue.treasuryCents).toBe(treasuryCents);
    }
  });
});

describe('an AI house', () => {
  it('buys the input its chain lacks instead of idling', () => {
    // Arrange: Caron has no wool, Fournier no grain, Charpentier no wood.
    const { events, world } = playWeek(createWorld(SEED));

    // Assert
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'caron', good: 'wool', units: 6 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'fournier', good: 'grain', units: 4 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'charpentier', good: 'wood', units: 4 }),
    );
    expect(world.houses.caron.stock).toEqual({});
    expect(world.houses.fournier.stock).toEqual({});
    expect(world.houses.charpentier.stock).toEqual({});
  });

  it('sells its whole stock every week', () => {
    // Arrange
    let current = createWorld(SEED);

    // Act and assert: no AI house holds a unit across the week.
    for (let week = 0; week < 10; week += 1) {
      current = playWeek(current).world;
      for (const house of Object.values(current.houses)) {
        if (house.controller === 'ai') {
          expect(stockUnits(house)).toBe(0);
        }
      }
    }
  });

  it("does not sell a human house's stock", () => {
    // Arrange: the founder is the weaver and must keep its bet.
    const { world, events } = playWeek(createWorld(SEED));

    // Assert
    expect(world.houses.brigue.stock.cloth).toBe(4);
    expect(world.houses.brigue.stock.wool).toBe(4);
    expect(events.filter((event) => event.type === 'market.sold' && event.houseId === 'brigue')).toEqual([]);
  });

  it("does not sell a dormant house's stock", () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.caron.dormant = true;
    world.houses.caron.stock = { cloth: 5 };

    // Act
    const { world: after, events } = playWeek(world);

    // Assert
    expect(after.houses.caron.stock.cloth).toBe(5);
    expect(events.filter((event) => event.type === 'market.sold' && event.houseId === 'caron')).toEqual([]);
  });

  it('never idles once it can pay for its input', () => {
    // Arrange
    let current = createWorld(SEED);
    const idles: Event[] = [];

    // Act: a long run, because a demand that switches on and off would show here.
    for (let week = 0; week < 200; week += 1) {
      const result = playWeek(current);
      current = result.world;
      idles.push(...result.events.filter((event) => event.type === 'workshop.idle' && event.houseId === 'caron'));
    }

    // Assert
    expect(idles).toEqual([]);
  });

  it('settles the prices instead of making them saw', () => {
    // Arrange
    let current = createWorld(SEED);

    // Act
    for (let week = 0; week < 200; week += 1) {
      current = playWeek(current).world;
    }

    // Assert: the equilibria are derived from the weekly flows and the price
    // rule. Caron makes six cloth against an absorption of ten, so the cloth
    // pressure is +49 and its pull closes a quarter of the gap: 1240 + 4 × 49.
    // Wool is two short of six bought, so 380 + 4 × 19; bread and planks run
    // the same arithmetic; grain and wood are level and sit on their reference.
    // The drift is ±30 and the reversion keeps it within about four drifts.
    expect(current.market.wool).toBeGreaterThan(300);
    expect(current.market.wool).toBeLessThan(620);
    expect(current.market.cloth).toBeGreaterThan(1230);
    expect(current.market.cloth).toBeLessThan(1650);
    expect(current.market.grain).toBeGreaterThan(110);
    expect(current.market.grain).toBeLessThan(410);
    expect(current.market.bread).toBeGreaterThan(490);
    expect(current.market.bread).toBeLessThan(800);
    expect(current.market.wood).toBeGreaterThan(150);
    expect(current.market.wood).toBeLessThan(450);
    expect(current.market.planks).toBeGreaterThan(970);
    expect(current.market.planks).toBeLessThan(1390);
    for (const price of Object.values(current.market)) {
      expect(price).toBeGreaterThan(RULES.priceFloorCents);
      expect(price).toBeLessThan(RULES.priceCeilCents);
    }
  });

  it('stays idle, without buying, when it cannot pay', () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.caron.treasuryCents = 0;
    world.houses.caron.stock = {};

    // Act
    const { events } = playWeek(world);

    // Assert
    expect(events.filter((event) => event.type === 'market.bought' && event.houseId === 'caron')).toEqual([]);
    expect(events).toContainEqual({
      type: 'workshop.idle',
      audience: { houseId: 'caron' },
      houseId: 'caron',
      good: 'cloth',
      input: 'wool',
      missingUnits: 6,
    });
  });

  it('never buys an input it does not need', () => {
    // Arrange
    let current = createWorld(SEED);
    const bought = new Map<string, Set<string>>();

    // Act
    for (let week = 0; week < 20; week += 1) {
      const result = playWeek(current);
      current = result.world;
      for (const event of result.events) {
        if (event.type !== 'market.bought') {
          continue;
        }
        const goods = bought.get(event.houseId) ?? new Set<string>();
        goods.add(event.good);
        bought.set(event.houseId, goods);
      }
    }

    // Assert: one input per chain, and only the chain that needs it.
    expect([...bought.keys()].sort()).toEqual(['caron', 'charpentier', 'fournier']);
    expect([...(bought.get('caron') ?? [])]).toEqual(['wool']);
    expect([...(bought.get('charpentier') ?? [])]).toEqual(['wood']);
    expect([...(bought.get('fournier') ?? [])]).toEqual(['grain']);
  });

  it('pays the same price as the player does in the same week', () => {
    // Arrange
    const world = createWorld(SEED);
    const priceCents = world.market.wool;

    // Act
    const { events } = playWeek(world, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 2 }]);

    // Assert
    const purchases = events.filter((event) => event.type === 'market.bought' && event.good === 'wool');
    expect(purchases).toHaveLength(2);
    for (const purchase of purchases) {
      expect(purchase).toMatchObject({ priceCents });
    }
  });
});
