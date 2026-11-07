import { describe, expect, it } from 'vitest';

import {
  createFirstHouse,
  createWorld,
  humanHouseOf,
  RULES,
  stateHash,
  TRADE_CHAINS,
  TRADES,
  withFirstHouse,
  withNewcomer,
  type HouseIdentity,
} from '../src/index.ts';
import { tick } from './helpers.ts';

const IDENTITY: HouseIdentity = { id: 'leclerc', houseName: 'Leclerc', personName: 'Colin Leclerc' };

describe('the first house', () => {
  it('starts a weaver with its chain and input', () => {
    const firstHouse = createFirstHouse('weaver', IDENTITY);

    expect(firstHouse.house.workshops).toEqual([{ id: 'workshop-1', good: 'cloth', level: 2 }]);
    expect(firstHouse.house.stock).toEqual({ wool: RULES.startingInputUnits });
    expect(firstHouse.house.name).toBe(IDENTITY.houseName);
  });

  it('starts every trade with its own chain and input', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const firstHouse = createFirstHouse(trade, IDENTITY);

      expect(firstHouse.house.workshops).toEqual([{ id: 'workshop-1', good: chain.output, level: 2 }]);
      expect(firstHouse.house.stock).toEqual({ [chain.input]: RULES.startingInputUnits });
      // The trade is a name for a real recipe, not a second table to drift.
      expect(RULES.recipes[chain.output]).toEqual({ input: chain.input, perUnit: 1 });
    }
  });

  it('builds the town without a human house', () => {
    // Arrange and act: the town is the AI houses and nothing else.
    const world = createWorld(1);

    // Assert
    expect(humanHouseOf(world)).toBeUndefined();
    expect(Object.values(world.houses).every((house) => house.controller === 'ai')).toBe(true);
    expect(world.houses.caron).toBeDefined();
  });

  it('adds the first house, with the chosen trade, when the first player joins', () => {
    // Act
    const world = withFirstHouse(createWorld(1), 'baker', IDENTITY);

    // Assert
    expect(world.houses[IDENTITY.id]?.name).toBe(IDENTITY.houseName);
    expect(world.houses[IDENTITY.id]?.workshops).toEqual([{ id: 'workshop-1', good: 'bread', level: 2 }]);
    expect(world.houses[IDENTITY.id]?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(world.people[`person-${IDENTITY.id}`]?.houseId).toBe(IDENTITY.id);
    expect(humanHouseOf(world)?.id).toBe(IDENTITY.id);
  });

  it('adds the first house once', () => {
    // Arrange
    const once = withFirstHouse(createWorld(1), 'weaver', IDENTITY);

    // Act
    const twice = withFirstHouse(once, 'baker', { ...IDENTITY, id: 'other', houseName: 'Autre' });

    // Assert: a human house is already there, and the second identity is ignored.
    expect(twice).toBe(once);
    expect(twice.houses[IDENTITY.id]?.workshops).toEqual([{ id: 'workshop-1', good: 'cloth', level: 2 }]);
    expect(twice.houses.other).toBeUndefined();
  });

  it('adds a newcomer to a town that already has a player', () => {
    // Arrange
    const town = withFirstHouse(createWorld(1), 'weaver', IDENTITY);

    // Act
    const two = withNewcomer(town, 'baker', { ...IDENTITY, id: 'moreau', houseName: 'Moreau' });

    // Assert: the same kit as the first house, and a house of its own.
    expect(two.houses.moreau?.controller).toBe('human');
    expect(two.houses.moreau?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(two.houses.moreau?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(two.people['person-moreau']?.houseId).toBe('moreau');
    expect(Object.values(two.houses).filter((house) => house.controller === 'human')).toHaveLength(2);
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(withFirstHouse(createWorld(1), trade, IDENTITY));

      expect(world.houses[IDENTITY.id]?.stock[chain.output]).toBe(4);
      expect(world.houses[IDENTITY.id]?.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = withFirstHouse(createWorld(1), 'weaver', IDENTITY);
    const baker = withFirstHouse(createWorld(1), 'baker', IDENTITY);

    expect(baker.houses[IDENTITY.id]?.treasuryCents).toBe(weaver.houses[IDENTITY.id]?.treasuryCents);
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
