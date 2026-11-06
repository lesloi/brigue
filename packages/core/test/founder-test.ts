import { describe, expect, it } from 'vitest';

import {
  createFounder,
  createWorld,
  FOUNDER_HOUSE_ID,
  RULES,
  stateHash,
  TRADE_CHAINS,
  TRADES,
  withFounder,
} from '../src/index.ts';
import { tick } from './helpers.ts';

describe('the founder', () => {
  it('starts as a weaver by default', () => {
    const founder = createFounder();

    expect(founder.house.workshops).toEqual([{ good: 'cloth', level: 2, workers: 2 }]);
    expect(founder.house.stock).toEqual({ wool: 8 });
  });

  it('starts every trade with its own chain and input', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const founder = createFounder(trade);

      expect(founder.house.workshops).toEqual([{ good: chain.output, level: 2, workers: 2 }]);
      expect(founder.house.stock).toEqual({ [chain.input]: RULES.founderInputUnits });
      // The trade is a name for a real recipe, not a second table to drift.
      expect(RULES.recipes[chain.output]).toEqual({ input: chain.input, perUnit: 1 });
    }
  });

  it('builds the town without a human house', () => {
    // Arrange and act: the town is the AI houses and nothing else.
    const world = createWorld(1);

    // Assert
    expect(world.houses[FOUNDER_HOUSE_ID]).toBeUndefined();
    expect(Object.values(world.houses).every((house) => house.controller === 'ai')).toBe(true);
    expect(world.houses.caron).toBeDefined();
  });

  it('adds the founder, with the chosen trade, when the first player joins', () => {
    // Act
    const world = withFounder(createWorld(1), 'baker');

    // Assert
    expect(world.houses.brigue.workshops).toEqual([{ good: 'bread', level: 2, workers: 2 }]);
    expect(world.houses.brigue.stock).toEqual({ grain: RULES.founderInputUnits });
    expect(world.people['person-brigue']?.houseId).toBe('brigue');
  });

  it('adds the founder once', () => {
    // Arrange
    const once = withFounder(createWorld(1), 'weaver');

    // Act
    const twice = withFounder(once, 'baker');

    // Assert: the house is already there, and the second trade changes nothing.
    expect(twice).toBe(once);
    expect(twice.houses.brigue.workshops).toEqual([{ good: 'cloth', level: 2, workers: 2 }]);
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(withFounder(createWorld(1), trade));

      expect(world.houses.brigue.stock[chain.output]).toBe(4);
      expect(world.houses.brigue.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = withFounder(createWorld(1), 'weaver');
    const baker = withFounder(createWorld(1), 'baker');

    expect(baker.houses.brigue.treasuryCents).toBe(weaver.houses.brigue.treasuryCents);
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
