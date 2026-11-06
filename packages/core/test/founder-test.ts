import { describe, expect, it } from 'vitest';

import {
  createFounder,
  createWorld,
  firstHouseOf,
  RULES,
  stateHash,
  TRADE_CHAINS,
  TRADES,
  withFounder,
  type FounderIdentity,
} from '../src/index.ts';
import { tick } from './helpers.ts';

const IDENTITY: FounderIdentity = { id: 'brigue', houseName: 'Brigue', personName: 'Colin Brigue' };

describe('the founder', () => {
  it('starts a weaver with its chain and input', () => {
    const founder = createFounder('weaver', IDENTITY);

    expect(founder.house.workshops).toEqual([{ good: 'cloth', level: 2, workers: 2 }]);
    expect(founder.house.stock).toEqual({ wool: RULES.founderInputUnits });
    expect(founder.house.name).toBe(IDENTITY.houseName);
  });

  it('starts every trade with its own chain and input', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const founder = createFounder(trade, IDENTITY);

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
    expect(firstHouseOf(world)).toBeUndefined();
    expect(Object.values(world.houses).every((house) => house.controller === 'ai')).toBe(true);
    expect(world.houses.caron).toBeDefined();
  });

  it('adds the founder, with the chosen trade, when the first player joins', () => {
    // Act
    const world = withFounder(createWorld(1), 'baker', IDENTITY);

    // Assert
    expect(world.houses[IDENTITY.id]?.name).toBe(IDENTITY.houseName);
    expect(world.houses[IDENTITY.id]?.workshops).toEqual([{ good: 'bread', level: 2, workers: 2 }]);
    expect(world.houses[IDENTITY.id]?.stock).toEqual({ grain: RULES.founderInputUnits });
    expect(world.people[`person-${IDENTITY.id}`]?.houseId).toBe(IDENTITY.id);
    expect(firstHouseOf(world)?.id).toBe(IDENTITY.id);
  });

  it('adds the founder once', () => {
    // Arrange
    const once = withFounder(createWorld(1), 'weaver', IDENTITY);

    // Act
    const twice = withFounder(once, 'baker', { ...IDENTITY, id: 'other', houseName: 'Autre' });

    // Assert: a human house is already there, and the second identity is ignored.
    expect(twice).toBe(once);
    expect(twice.houses[IDENTITY.id]?.workshops).toEqual([{ good: 'cloth', level: 2, workers: 2 }]);
    expect(twice.houses.other).toBeUndefined();
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(withFounder(createWorld(1), trade, IDENTITY));

      expect(world.houses[IDENTITY.id]?.stock[chain.output]).toBe(4);
      expect(world.houses[IDENTITY.id]?.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = withFounder(createWorld(1), 'weaver', IDENTITY);
    const baker = withFounder(createWorld(1), 'baker', IDENTITY);

    expect(baker.houses[IDENTITY.id]?.treasuryCents).toBe(weaver.houses[IDENTITY.id]?.treasuryCents);
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
