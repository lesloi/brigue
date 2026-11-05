import { describe, expect, it } from 'vitest';

import { createFounder, createWorld, RULES, stateHash, tick, TRADES, TRADE_CHAINS } from '../src/index.ts';

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
      expect(founder.house.stock).toEqual({ [chain.input]: 8 });
      // The trade is a name for a real recipe, not a second table to drift.
      expect(RULES.recipes[chain.output]).toEqual({ input: chain.input, perUnit: 1 });
    }
  });

  it('makes a world whose founder carries the chosen trade', () => {
    const world = createWorld(1, 'baker');

    expect(world.houses.brigue.workshops).toEqual([{ good: 'bread', level: 2, workers: 2 }]);
    expect(world.houses.brigue.stock).toEqual({ grain: 8 });
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(createWorld(1, trade));

      expect(world.houses.brigue.stock[chain.output]).toBe(4);
      expect(world.houses.brigue.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = createWorld(1, 'weaver');
    const baker = createWorld(1, 'baker');

    expect(baker.houses.brigue.treasuryCents).toBe(weaver.houses.brigue.treasuryCents);
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
