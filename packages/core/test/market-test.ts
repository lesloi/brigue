import { describe, expect, it } from 'vitest';

import { createWorld, nextPriceCents, RULES, tick } from '../src/index.ts';
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
    // Arrange: grain is absorbed four a week. A week with nothing offered and
    // nothing bought is a week in which the town went short.
    const grain = { ...base, priceCents: 260, referenceCents: 260, absorbedUnits: 4, scaleUnits: 4 };

    // Act and assert: a full scale of shortage is a tenth of the reference.
    expect(nextPriceCents({ ...grain, flowUnits: 0 })).toBe(286);
    expect(nextPriceCents({ ...grain, flowUnits: 4 })).toBe(260);
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
    for (const good of ['cloth', 'wool', 'grain'] as const) {
      const drift = world.market[good] - RULES.market[good].referenceCents;
      expect(Math.abs(drift)).toBeLessThanOrEqual(RULES.priceDriftCents);
    }
  });

  it('lets an unclaimed wool glut lower the price', () => {
    // Arrange: Vandermeersch sells four wool a week; here the weaver buys four,
    // so the town's wool balance is nil and the glut is sold.
    const glut = twoWeeks(createWorld(SEED));
    const balanced = twoWeeks(createWorld(SEED), [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 4 }]);

    // Act: four units of imbalance, half a scale of four.
    const difference = balanced.market.wool - glut.market.wool;

    // Assert
    expect(difference).toBe(Math.trunc((4 * RULES.market.wool.referenceCents) / (10 * RULES.market.wool.scaleUnits)));
  });

  it('lets a purchase raise the price the following week', () => {
    // Arrange
    const control = twoWeeks(createWorld(SEED));
    const bought = twoWeeks(createWorld(SEED), [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 20 }]);

    // Act: twenty fewer wool on the market than in the control week.
    const difference = bought.market.wool - control.market.wool;

    // Assert
    expect(difference).toBe(Math.trunc((20 * RULES.market.wool.referenceCents) / (10 * RULES.market.wool.scaleUnits)));
  });

  it('records the week it will price next week', () => {
    // Arrange
    const { world } = playWeek(createWorld(SEED));

    // Act and assert: sold minus bought, per good.
    expect(world.marketFlow).toEqual({ cloth: 10, wool: 4, grain: 4 });
  });

  it('prices a surplus against a house that over-produces', () => {
    // Arrange
    const flooded = createWorld(SEED);
    flooded.houses.brigue.workshops = [{ good: 'cloth', level: 10, workers: 2 }];
    flooded.houses.brigue.stock = { wool: 100 };
    const control = createWorld(SEED);

    // Act: sixteen extra cloth on the market, against a market that absorbs ten.
    const withSurplus = twoWeeks(flooded);
    const withBalance = twoWeeks(control);

    // Assert
    expect(withBalance.market.cloth - withSurplus.market.cloth).toBe(
      Math.trunc((16 * RULES.market.cloth.referenceCents) / (10 * RULES.market.cloth.scaleUnits)),
    );
  });
});

describe('an AI house', () => {
  it('buys the input its workshop lacks instead of idling', () => {
    // Arrange: Caron has forty wool and eats six a week.
    let current = createWorld(SEED);
    const weeks: Array<Event[]> = [];

    // Act
    for (let week = 0; week < 10; week += 1) {
      const result = playWeek(current, []);
      current = result.world;
      weeks.push(result.events);
    }

    // Assert: it runs dry before its seventh week and buys the two it misses.
    expect(weeks[5].filter((event) => event.type === 'market.bought')).toEqual([]);
    expect(weeks[6]).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'caron', good: 'wool', units: 2 }),
    );
    expect(weeks[7]).toContainEqual(
      expect.objectContaining({ type: 'market.bought', houseId: 'caron', good: 'wool', units: 6 }),
    );
  });

  it('never idles once it can pay for its input', () => {
    // Arrange
    let current = createWorld(SEED);
    const idles: Event[] = [];

    // Act: a long run, because a demand that switches on and off would show here.
    for (let week = 0; week < 200; week += 1) {
      const result = playWeek(current, []);
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
      current = playWeek(current, []).world;
    }

    // Assert: the town is scarce in cloth and tight in wool, and both settle
    // inside a band instead of running to a bound or oscillating.
    expect(current.market.cloth).toBeGreaterThan(1200);
    expect(current.market.cloth).toBeLessThan(1600);
    expect(current.market.wool).toBeGreaterThan(300);
    expect(current.market.wool).toBeLessThan(600);
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
    const bought: Event[] = [];

    // Act
    for (let week = 0; week < 20; week += 1) {
      const result = playWeek(current, []);
      current = result.world;
      bought.push(...result.events.filter((event) => event.type === 'market.bought'));
    }

    // Assert: only the house that weaves cloth buys anything, and only wool.
    expect(bought.map((event) => (event.type === 'market.bought' ? event.houseId : ''))).toEqual(
      expect.arrayContaining(['caron']),
    );
    for (const event of bought) {
      expect(event).toMatchObject({ houseId: 'caron', good: 'wool' });
    }
  });

  it('pays the same price as the player does in the same week', () => {
    // Arrange: play up to the week Caron runs dry.
    let current = createWorld(SEED);
    for (let week = 0; week < 6; week += 1) {
      current = playWeek(current, []).world;
    }
    const priceCents = current.market.wool;

    // Act
    const { events } = playWeek(current, [{ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 2 }]);

    // Assert
    const purchases = events.filter((event) => event.type === 'market.bought');
    expect(purchases).toHaveLength(2);
    for (const purchase of purchases) {
      expect(purchase).toMatchObject({ priceCents });
    }
  });
});
