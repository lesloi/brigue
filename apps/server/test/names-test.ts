import { createWorld, DYNASTY_NAMES, isValidName, nameKey, type World } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { drawPersonIdentity, drawTownName, PERSON_NAMES, suggestFamilyName, TOWN_NAMES } from '../src/town/names.ts';

describe('the suggested family name', () => {
  it('draws a name from the pool, and an opaque id that carries nothing of it', () => {
    // Arrange
    const world = createWorld();
    const names = namesOf(world);

    // Act and assert: a hundred draws are free, and no two ids are the same.
    for (let draw = 0; draw < 100; draw += 1) {
      const name = suggestFamilyName(names);
      const identity = drawPersonIdentity(name);

      expect(DYNASTY_NAMES).toContain(name);
      expect(identity.familyName).toBe(name);
      expect(identity.id).toMatch(/^person-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(identity.id).not.toContain(nameKey(name));
      expect(isValidName(name)).toBe(true);
      expect(PERSON_NAMES.some((firstName) => identity.personName.startsWith(`${firstName} `))).toBe(true);
      expect(identity.personName.endsWith(name)).toBe(true);
    }
  });

  it('never draws a name the town or another human account already carries, and keeps trying past a taken draw', () => {
    // Arrange: a town whose free names are few, and the pool as it is.
    const elsewhere = new Set([nameKey('Leclerc'), nameKey('Moreau')]);
    const drawn = new Map<string, number>();
    // A pool of two free names among thirty draws: a draw that lands on one of
    // the other twenty-eight must be replaced by another, not accepted.
    const free = new Set(DYNASTY_NAMES.filter((name) => !elsewhere.has(nameKey(name))).map((name) => nameKey(name)));
    expect(free.size).toBeGreaterThan(1);

    // Act
    for (let draw = 0; draw < 200; draw += 1) {
      const name = suggestFamilyName(['Caron', 'Cáron', 'Fournier'], elsewhere);
      drawn.set(name, (drawn.get(name) ?? 0) + 1);
    }

    // Assert: every draw is free, and both free names came out.
    expect([...drawn.keys()].every((name) => free.has(nameKey(name)))).toBe(true);
    expect(drawn.size).toBeGreaterThan(1);
  });

  it('leaves the name empty when every draw is taken, so the player writes their own', () => {
    // Arrange: a town carrying the whole pool.
    const world = createWorld();
    const taken = [...DYNASTY_NAMES];

    // Act
    const name = suggestFamilyName(taken);

    // Assert: the pool is a suggestion, never a limit.
    expect(name).toBe('');
    expect(taken).toEqual([...DYNASTY_NAMES]);
    expect(namesOf(world)).not.toContain('');
  });
});

describe('the town name', () => {
  it('draws a name from the pool, and nothing else', () => {
    // Act and assert
    for (let draw = 0; draw < 100; draw += 1) {
      expect(TOWN_NAMES).toContain(drawTownName());
    }
  });
});

/** The family names the AI people of the opening town carry. */
function namesOf(world: World): string[] {
  return Object.values(world.people).map((person) => person.name.split(' ').at(-1) ?? person.name);
}
