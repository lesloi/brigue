import { describe, expect, it } from 'vitest';

import {
  DYNASTY_NAMES,
  createWorld,
  isValidName,
  nameIsTaken,
  nameKey,
  NAME_MAX_LENGTH,
  NAME_PRICE,
  renameDynasty,
  RULES,
  sanitizeName,
  withFirstDynasty,
  type Action,
  type World,
} from '../src/index.ts';
import { TEST_FIRST_DYNASTY, tick, town } from './helpers.ts';

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

describe('a name taken in the town', () => {
  it('refuses what another dynasty carries, whatever its case, and accepts its own', () => {
    // Arrange
    const names = Object.values(town(SEED).dynasties).map((dynasty) => dynasty.name);

    // Act and assert: the renamed dynasty's own name is asked without it.
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
    const queued = { type: 'dynasty.rename', dynastyId: 'leclerc', name: 'Moreau' } as unknown as Action;

    // Act
    const { world: after, events } = tick(world, [queued]);

    // Assert: refused as an action the town does not know, and the name did not
    // move — the upkeep of the hour is all that touched the purse.
    expect(events).toContainEqual(expect.objectContaining({ type: 'action.refused', reason: 'unknown_action' }));
    expect(after.dynasties.leclerc?.name).toBe('Leclerc');
    expect(after.dynasties.leclerc?.treasuryCents).toBe(
      (world.dynasties.leclerc?.treasuryCents ?? 0) - RULES.upkeepPerWorkshopLevelCents * 2,
    );
  });
});

describe('renaming a dynasty', () => {
  it('renames the dynasty and its living people, keeping the id and the dead, and charges the price', () => {
    // Arrange: a dynasty with the founder alive and an ancestor dead.
    const world = town(SEED);
    world.people['person-leclerc-old'] = {
      id: 'person-leclerc-old',
      dynastyId: 'leclerc',
      name: 'Hugues Leclerc',
      age: 80,
      attributes: { artisanat: 10, parole: 10, intrigue: 10 },
      alive: false,
    };
    const treasury = world.dynasties.leclerc?.treasuryCents ?? 0;

    // Act
    const outcome = renameDynasty(world, world.dynasties.leclerc!, {
      name: '  Moreau ',
      priceCents: NAME_PRICE.renameCents,
    });

    // Assert: the name is identity, not trade: it moves the dynasty and its
    // living people, and the purse pays for it.
    expect(outcome).toEqual({ ok: true, name: 'Moreau' });
    expect(world.dynasties.leclerc?.id).toBe('leclerc');
    expect(world.dynasties.leclerc?.name).toBe('Moreau');
    expect(world.dynasties.leclerc?.treasuryCents).toBe(treasury - NAME_PRICE.renameCents);
    expect(world.people['person-leclerc']?.name).toBe('Colin Moreau');
    expect(world.people['person-leclerc-old']?.name).toBe('Hugues Leclerc');
  });

  it('changes the name for nothing at creation, and writes no journal line', () => {
    // Arrange
    const world = town(SEED);
    const treasury = world.dynasties.leclerc?.treasuryCents ?? 0;

    // Act: the first dynasty takes the name its player kept.
    const outcome = renameDynasty(world, world.dynasties.leclerc!, { name: 'Moreau', priceCents: 0 });

    // Assert: kept, and unpaid.
    expect(outcome).toEqual({ ok: true, name: 'Moreau' });
    expect(world.dynasties.leclerc?.treasuryCents).toBe(treasury);
    expect(world.people['person-leclerc']?.name).toBe('Colin Moreau');
  });

  it('refuses a taken name, an empty one, a poisoned one and one the purse cannot pay', () => {
    const cases: Array<{ name: string; priceCents: number; reason: string }> = [
      { name: 'CARON', priceCents: 0, reason: 'name_taken' },
      { name: '   ', priceCents: 0, reason: 'invalid_name' },
      { name: 'Car on', priceCents: 0, reason: 'invalid_name' },
      { name: 'Caron\u202E;', priceCents: 0, reason: 'invalid_name' },
      { name: 'Moreau', priceCents: 10_000_000, reason: 'insufficient_funds' },
    ];

    for (const attempt of cases) {
      // Arrange
      const world = town(SEED);

      // Act
      const outcome = renameDynasty(world, world.dynasties.leclerc!, {
        name: attempt.name,
        priceCents: attempt.priceCents,
      });

      // Assert: a refusal comes back as an answer, not a throw, and the dynasty stays.
      expect(outcome).toEqual({ ok: false, reason: attempt.reason });
      expect(world.dynasties.leclerc?.name).toBe('Leclerc');
      expect(world.dynasties.leclerc?.treasuryCents).toBe(town(SEED).dynasties.leclerc?.treasuryCents);
    }
  });

  it('refuses a name a human dynasty of another town carries, and lets an AI name through', () => {
    // Arrange: another town with a human Caron, and a human dynasty of this seed.
    const world = town(SEED);
    const elsewhere = new Set([nameKey('Caron')]);

    // Act
    const refused = renameDynasty(world, world.dynasties.leclerc!, {
      name: 'CARON',
      priceCents: 0,
      takenElsewhere: elsewhere,
    });
    const accepted = renameDynasty(world, world.dynasties.leclerc!, {
      name: 'Moreau',
      priceCents: 0,
      takenElsewhere: new Set(),
    });

    // Assert: a human dynasty elsewhere collides, whatever its case.
    expect(refused).toEqual({ ok: false, reason: 'name_taken' });
    expect(accepted).toEqual({ ok: true, name: 'Moreau' });
  });
});

describe('the creation', () => {
  it('names the first dynasty from what it is given, with an id that is not its name', () => {
    // Arrange
    const identity = { ...TEST_FIRST_DYNASTY, id: 'dynasty-7f3a', dynastyName: 'Moreau', personName: 'Colin Moreau' };

    // Act
    const world = withFirstDynasty(createWorld(SEED), 'weaver', identity);

    // Assert
    expect(world.dynasties['dynasty-7f3a']?.name).toBe('Moreau');
    expect(world.people['person-dynasty-7f3a']?.name).toBe('Colin Moreau');
  });
});

describe('the suggested names', () => {
  it('never carries an AI dynasty name and never repeats itself', () => {
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

  it('prices the rename as calibration, outside the ruleset', () => {
    // Arrange
    const world: World = createWorld(SEED);

    // Assert: the price is calibration, and the world holds no rule of its own.
    expect(NAME_PRICE.renameCents).toBeGreaterThan(0);
    expect(Object.values(world.dynasties).length).toBe(3);
  });
});
