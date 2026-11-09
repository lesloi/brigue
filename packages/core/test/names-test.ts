import { describe, expect, it } from 'vitest';

import {
  DYNASTY_NAMES,
  createWorld,
  isValidName,
  nameIsTaken,
  nameKey,
  NAME_MAX_LENGTH,
  NAME_PRICE,
  renamePerson,
  RULES,
  sanitizeName,
  withFirstPerson,
  type Action,
  type World,
} from '../src/index.ts';
import { LECLERC, TEST_FIRST_DYNASTY, tick, town } from './helpers.ts';

const SEED = 20261107;

describe('a name key', () => {
  it('folds the case, and nothing else: a name is letters and digits only', () => {
    // Act and assert: nothing to fold but the case, since no accent is a name.
    expect(nameKey('Caron')).toBe('caron');
    expect(nameKey('CARON')).toBe('caron');
    expect(nameKey('Caron2')).toBe('caron2');
  });
});

describe('a name as it is kept', () => {
  it('keeps a well-formed name, and trims it', () => {
    // Act and assert: the sanitizer is the one that trims.
    expect(sanitizeName('  Sacy  ')).toBe('Sacy');
    expect(isValidName('Sacy')).toBe(true);
    expect(isValidName('Leclerc2')).toBe(true);
    expect(isValidName('A'.repeat(NAME_MAX_LENGTH))).toBe(true);
  });

  it('strips what a screen would not show, rather than refusing the name', () => {
    // Arrange: a bidi override, a zero-width space and a control character.
    const poisoned = 'Ca\u202Ero\u200Bn\u0007';

    // Act
    const clean = sanitizeName(poisoned);

    // Assert
    expect(clean).toBe('Caron');
    expect(isValidName(clean)).toBe(true);
  });

  it('refuses an empty, an accented, a spaced, a punctuated, a digit-led or an over-long name', () => {
    // Act and assert: the tongue of the game is unaccented, and a name is one word.
    expect(isValidName('')).toBe(false);
    expect(isValidName(sanitizeName('   '))).toBe(false);
    expect(isValidName('Hébert')).toBe(false);
    expect(isValidName('Le Noir')).toBe(false);
    expect(isValidName("O'Neil")).toBe(false);
    expect(isValidName('de Sacy')).toBe(false);
    expect(isValidName('Caron;')).toBe(false);
    expect(isValidName('7 Sacy')).toBe(false);
    expect(isValidName('7Sacy')).toBe(false);
    expect(isValidName(`A${'a'.repeat(NAME_MAX_LENGTH)}`)).toBe(false);
  });
});

describe('a name taken across the server', () => {
  it('refuses what another account carries, whatever its case, and accepts its own', () => {
    // Arrange: the names the accounts and the AI composition carry.
    const names = ['Caron', 'Fournier', 'Charpentier', 'Leclerc'];

    // Act and assert: the renamed account's own name is asked without it.
    expect(nameIsTaken(names, 'caron')).toBe(true);
    expect(nameIsTaken(names, 'CARON')).toBe(true);
    expect(nameIsTaken(names, 'Moreau')).toBe(false);
    expect(
      nameIsTaken(
        names.filter((name) => name !== 'Caron'),
        'Caron',
      ),
    ).toBe(false);
  });
});

describe('the rename as the town asks for it', () => {
  it('refuses the queued rename: a name is identity, not a trade of the hour', () => {
    // Arrange
    const world = town(SEED);
    const queued = { type: 'dynasty.rename', personId: LECLERC, name: 'Moreau' } as unknown as Action;

    // Act
    const { world: after, events } = tick(world, [queued]);

    // Assert: refused as an action the town does not know, and the name did not
    // move — the upkeep of the hour is all that touched the purse.
    expect(events).toContainEqual(expect.objectContaining({ type: 'action.refused', reason: 'unknown_action' }));
    expect(after.people[LECLERC]?.name).toBe('Colin Leclerc');
    expect(after.people[LECLERC]?.treasuryCents).toBe(
      (world.people[LECLERC]?.treasuryCents ?? 0) - RULES.upkeepPerWorkshopLevelCents * 2,
    );
  });
});

describe('renaming a person', () => {
  it('keeps the given name and moves the family name', () => {
    expect(renamePerson('Colin Leclerc', 'Leclerc', 'Moreau')).toBe('Colin Moreau');
    expect(renamePerson('Hugues Leclerc', 'Leclerc', 'Moreau')).toBe('Hugues Moreau');
  });

  it('takes the new name whole when the old family name does not end the display name', () => {
    expect(renamePerson('Colin', 'Leclerc', 'Moreau')).toBe('Moreau');
    expect(renamePerson('Colin Leclerc', '', 'Moreau')).toBe('Moreau');
  });

  it('prices the rename as calibration, outside the ruleset', () => {
    // Arrange
    const world: World = createWorld(SEED);

    // Assert: the price is calibration, and the world holds no rule of its own.
    expect(NAME_PRICE.renameCents).toBeGreaterThan(0);
    expect(Object.values(world.people).length).toBe(3);
  });
});

describe('the creation', () => {
  it('names the first person from what it is given', () => {
    // Arrange
    const identity = { ...TEST_FIRST_DYNASTY, personName: 'Colin Moreau' };

    // Act
    const world = withFirstPerson(createWorld(SEED), 'weaver', identity);

    // Assert
    expect(world.people[LECLERC]?.name).toBe('Colin Moreau');
  });
});

describe('the suggested names', () => {
  it('never carries an AI family name and never repeats itself', () => {
    // Arrange
    const seen = new Set<string>();

    // Act
    for (const name of DYNASTY_NAMES) {
      seen.add(nameKey(name));
    }

    // Assert: the pool is distinct on the key the uniqueness reads.
    expect(seen.size).toBe(DYNASTY_NAMES.length);
    for (const ai of ['Caron', 'Fournier', 'Charpentier']) {
      expect(seen.has(nameKey(ai))).toBe(false);
    }
  });
});
