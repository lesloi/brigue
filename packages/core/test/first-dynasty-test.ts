import { describe, expect, it } from 'vitest';

import {
  createFirstPerson,
  createWorld,
  humanPersonOf,
  RULES,
  stateHash,
  TRADE_CHAINS,
  TRADES,
  withFirstPerson,
  withNewcomer,
  type PersonIdentity,
} from '../src/index.ts';
import { CARON, LECLERC, tick } from './helpers.ts';

const IDENTITY: PersonIdentity = { personName: 'Colin Leclerc' };

describe('the first person', () => {
  it('starts a weaver with its chain and input', () => {
    const first = createFirstPerson('weaver', IDENTITY);

    expect(first.workshops).toEqual([{ id: 1, trade: 'weaver', level: 2 }]);
    expect(first.stock).toEqual({ wool: RULES.startingInputUnits });
    expect(first.name).toBe(IDENTITY.personName);
    expect(first.ia).toBe(false);
  });

  it('starts every trade with its own chain and input', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const first = createFirstPerson(trade, IDENTITY);

      expect(first.workshops).toEqual([{ id: 1, trade, level: 2 }]);
      expect(first.stock).toEqual({ [chain.input]: RULES.startingInputUnits });
      // A workshop always has a trade, and a trade a recipe: nothing can be
      // built that eats nothing and grows the loft.
      expect(RULES.inputPerOutput[trade]).toBe(1);
    }
  });

  it('builds the town without a human person', () => {
    // Arrange and act: the town is the AI people and nothing else.
    const world = createWorld();

    // Assert
    expect(humanPersonOf(world)).toBeUndefined();
    expect(Object.values(world.people).every((person) => person.ia)).toBe(true);
    expect(world.people[CARON]?.name).toBe('Robert Caron');
  });

  it('adds the first person, with the chosen trade, when the first player joins', () => {
    // Act
    const world = withFirstPerson(createWorld(), 'baker', IDENTITY);

    // Assert
    expect(world.people[LECLERC]?.name).toBe(IDENTITY.personName);
    expect(world.people[LECLERC]?.workshops).toEqual([{ id: 4, trade: 'baker', level: 2 }]);
    expect(world.people[LECLERC]?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(world.people[LECLERC]?.ia).toBe(false);
    expect(humanPersonOf(world)?.id).toBe(LECLERC);
  });

  it('adds the first person once', () => {
    // Arrange
    const once = withFirstPerson(createWorld(), 'weaver', IDENTITY);

    // Act
    const twice = withFirstPerson(once, 'baker', { personName: 'Autre Personne' });

    // Assert: a human person is already there, and the second identity is ignored.
    expect(twice).toBe(once);
    expect(twice.people[LECLERC]?.workshops).toEqual([{ id: 4, trade: 'weaver', level: 2 }]);
    expect(Object.keys(twice.people)).toHaveLength(4);
  });

  it('adds a newcomer to a town that already has a player', () => {
    // Arrange
    const town = withFirstPerson(createWorld(), 'weaver', IDENTITY);

    // Act
    const two = withNewcomer(town, 'baker', { personName: 'Jean Moreau' });

    // Assert: the same kit as the first person, and a person of its own.
    expect(two.people[5]?.ia).toBe(false);
    expect(two.people[5]?.treasuryCents).toBe(RULES.startingPurseCents);
    expect(two.people[5]?.stock).toEqual({ grain: RULES.startingInputUnits });
    expect(two.people[5]?.name).toBe('Jean Moreau');
    expect(Object.values(two.people).filter((person) => !person.ia)).toHaveLength(2);
  });

  it('produces the chosen chain on the first tick', () => {
    for (const trade of TRADES) {
      const chain = TRADE_CHAINS[trade];
      const { world } = tick(withFirstPerson(createWorld(), trade, IDENTITY));

      expect(world.people[LECLERC]?.stock[chain.output]).toBe(4);
      expect(world.people[LECLERC]?.stock[chain.input]).toBe(4);
    }
  });

  it('keeps the same starting money and makes a different world per trade', () => {
    const weaver = withFirstPerson(createWorld(), 'weaver', IDENTITY);
    const baker = withFirstPerson(createWorld(), 'baker', IDENTITY);

    expect(baker.people[LECLERC]?.treasuryCents).toBe(weaver.people[LECLERC]?.treasuryCents);
    expect(stateHash(baker)).not.toBe(stateHash(weaver));
  });
});
