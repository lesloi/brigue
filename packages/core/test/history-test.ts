import { describe, expect, it } from 'vitest';

import { createWorld, GOODS, PRICE_HISTORY_WEEKS, RULES, tick } from '../src/index.ts';

describe('the price history', () => {
  it('starts at the reference and gains one point per good per tick', () => {
    // Arrange
    const world = createWorld(1);
    for (const good of GOODS) {
      expect(world.marketHistory?.[good]).toEqual([RULES.market[good].referenceCents]);
    }

    // Act
    const { world: after } = tick(world);

    // Assert
    for (const good of GOODS) {
      expect(after.marketHistory?.[good]).toHaveLength(2);
      expect(after.marketHistory?.[good]?.at(-1)).toBe(after.market[good]);
    }
  });

  it('keeps one point per week when the price holds', () => {
    // Arrange: a price pinned at the floor, so the next price is unchanged.
    const world = createWorld(1);
    world.market.cloth = RULES.priceFloorCents;
    world.marketHistory = { cloth: [RULES.priceFloorCents] };
    world.marketFlow = { cloth: 10_000 };

    // Act
    const { world: after } = tick(world);

    // Assert
    expect(after.market.cloth).toBe(RULES.priceFloorCents);
    expect(after.marketHistory?.cloth).toEqual([RULES.priceFloorCents, RULES.priceFloorCents]);
  });

  it('keeps the last year of prices', () => {
    // Arrange
    let world = createWorld(1);

    // Act
    for (let week = 0; week < PRICE_HISTORY_WEEKS + 1; week += 1) {
      world = tick(world).world;
    }

    // Assert
    for (const good of GOODS) {
      expect(world.marketHistory?.[good]).toHaveLength(PRICE_HISTORY_WEEKS);
      expect(world.marketHistory?.[good]?.at(-1)).toBe(world.market[good]);
    }
  });

  it('gives a field-less world its first point on the next tick', () => {
    // Arrange: a world stored before the field existed.
    const world = createWorld(1);
    delete world.marketHistory;

    // Act
    const { world: after } = tick(world);

    // Assert: the record starts now, without inventing a reference point.
    for (const good of GOODS) {
      expect(after.marketHistory?.[good]).toEqual([after.market[good]]);
    }
  });
});
