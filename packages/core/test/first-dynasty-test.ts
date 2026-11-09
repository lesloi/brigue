import { describe, expect, it } from 'vitest';

import {
  createFirstDynasty,
  createWorld,
  humanDynastyOf,
  RULES,
  stateHash,
  TRADE_CHAINS,
  TRADES,
  withFirstDynasty,
  withNewcomer,
  type DynastyIdentity,
} from '../src/index.ts';
import { tick } from './helpers.ts';

const IDENTITY: DynastyIdentity = { id: 'leclerc', dynastyName: 'Leclerc', personName: 'Colin Leclerc' };

describe('the first dynasty', () => {
  it('starts a weaver with its chain and input', () => {
    const firstDynasty = createFirstDynasty('weaver', IDENTITY);

    expect(firstDynasty.dynasty.workshops).toEqual([{ id: 'workshop-1', good: 'cloth', level: 2 }]);
    expect(firstDynasty.dynasty.stock).toEqual({ wool: RULES.startingInputUnits });
    expect(firstDynasty.dynasty.name).toBe(IDENTITY.dynastyName);
  });

  it('starts every trade with its own chain and input', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const firstDynasty = createFirstDynasty(trade, IDENTITY);

      expect(firstDynasty.dynasty.workshops).toEqual([{ id: 'workshop-1', good: chain.output, level: 2 }]);
      expect(firstDynasty.dynasty.stock).toEqual({ [chain.input]: RULES.startingInputUnits });
      // The trade is a name for a real recipe, not a second table to drift.
      expect(RULES.recipes[chain.output]).toEqual({ input: chain.input, perUnit: 1 });
    }
  });

  it('builds the town without a human dynasty', () => {
    // Arrange and act: the town is the AI dynasties and nothing else.
    const world = createWorld(1);

    // Assert
    expect(humanDynastyOf(world)).toBeUndefined();
    expect(Object.values(world.dynasties).every((dynasty) => dynasty.controller === 'ai')).toBe(true);
    expect(world.dynasties.caron).toBeDefined();
  });

  it('adds the first dynasty, with the chosen trade, when the first player joins', () => {
    // Act
    const world = withFirstDynasty(createWorld(1), 'baker', IDENTITY);

    // Assert
    expect(world.dynasties[IDENTITY.id]?.name).toBe(IDENTITY.dynastyName);
    expect(world.dynasties[IDENTITY.id]?.workshops).toEqual([{ id: 'workshop-1', good: 'bread', level: 2 }]);
    expect(world.dynasties[IDENTITY.id]?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(world.people[`person-${IDENTITY.id}`]?.dynastyId).toBe(IDENTITY.id);
    expect(humanDynastyOf(world)?.id).toBe(IDENTITY.id);
  });

  it('adds the first dynasty once', () => {
    // Arrange
    const once = withFirstDynasty(createWorld(1), 'weaver', IDENTITY);

    // Act
    const twice = withFirstDynasty(once, 'baker', { ...IDENTITY, id: 'other', dynastyName: 'Autre' });

    // Assert: a human dynasty is already there, and the second identity is ignored.
    expect(twice).toBe(once);
    expect(twice.dynasties[IDENTITY.id]?.workshops).toEqual([{ id: 'workshop-1', good: 'cloth', level: 2 }]);
    expect(twice.dynasties.other).toBeUndefined();
  });

  it('adds a newcomer to a town that already has a player', () => {
    // Arrange
    const town = withFirstDynasty(createWorld(1), 'weaver', IDENTITY);

    // Act
    const two = withNewcomer(town, 'baker', { ...IDENTITY, id: 'moreau', dynastyName: 'Moreau' });

    // Assert: the same kit as the first dynasty, and a dynasty of its own.
    expect(two.dynasties.moreau?.controller).toBe('human');
    expect(two.people['person-moreau']?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(two.dynasties.moreau?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(two.people['person-moreau']?.dynastyId).toBe('moreau');
    expect(Object.values(two.dynasties).filter((dynasty) => dynasty.controller === 'human')).toHaveLength(2);
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(withFirstDynasty(createWorld(1), trade, IDENTITY));

      expect(world.dynasties[IDENTITY.id]?.stock[chain.output]).toBe(4);
      expect(world.dynasties[IDENTITY.id]?.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = withFirstDynasty(createWorld(1), 'weaver', IDENTITY);
    const baker = withFirstDynasty(createWorld(1), 'baker', IDENTITY);

    expect(baker.people[`person-${IDENTITY.id}`]?.treasuryCents).toBe(
      weaver.people[`person-${IDENTITY.id}`]?.treasuryCents,
    );
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
