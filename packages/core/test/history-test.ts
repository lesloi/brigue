import { describe, expect, it } from 'vitest';

import { GOODS, PRICE_HISTORY_BELLS, RULES } from '../src/index.ts';
import { playHalfDay, town } from './helpers.ts';

describe('the price history', () => {
  it('starts at the reference and gains one point per good per bell', () => {
    // Arrange
    const world = town(1);
    for (const good of GOODS) {
      expect(world.marketHistory?.[good]).toEqual([RULES.market[good].referenceCents]);
    }

    // Act: the market is only priced when a bell rings.
    const { world: after } = playHalfDay(world);

    // Assert
    for (const good of GOODS) {
      expect(after.marketHistory?.[good]).toHaveLength(2);
      expect(after.marketHistory?.[good]?.at(-1)).toBe(after.market[good]);
    }
  });

  it('keeps one point per bell when the price holds', () => {
    // Arrange: a price pinned at the floor, so the next price is unchanged.
    const world = town(1);
    world.market.cloth = RULES.priceFloorCents;
    world.marketHistory = { cloth: [RULES.priceFloorCents] };
    world.marketFlow = { cloth: 10_000 };

    // Act
    const { world: after } = playHalfDay(world);

    // Assert
    expect(after.market.cloth).toBe(RULES.priceFloorCents);
    expect(after.marketHistory?.cloth).toEqual([RULES.priceFloorCents, RULES.priceFloorCents]);
  });

  it('keeps the last year of prices', () => {
    // Arrange
    let world = town(1);

    // Act: one point per bell, and the window holds a year of them.
    for (let bell = 0; bell < PRICE_HISTORY_BELLS + 1; bell += 1) {
      world = playHalfDay(world).world;
    }

    // Assert
    for (const good of GOODS) {
      expect(world.marketHistory?.[good]).toHaveLength(PRICE_HISTORY_BELLS);
      expect(world.marketHistory?.[good]?.at(-1)).toBe(world.market[good]);
    }
  });

  it('gives a field-less world its first point at the next bell', () => {
    // Arrange: a world stored before the field existed.
    const world = town(1);
    delete world.marketHistory;

    // Act
    const { world: after } = playHalfDay(world);

    // Assert: the record starts now, without inventing a reference point.
    for (const good of GOODS) {
      expect(after.marketHistory?.[good]).toEqual([after.market[good]]);
    }
  });
});
