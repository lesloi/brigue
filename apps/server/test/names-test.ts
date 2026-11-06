import { createWorld, type House } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { drawHouseIdentity, drawTownIdentity, HOUSE_NAMES, PERSON_NAMES, TOWN_NAMES } from '../src/names.ts';

describe('the first house name', () => {
  it('draws a name the town does not use, and an id from it', () => {
    // Arrange
    const world = createWorld(1);

    // Act and assert: a hundred draws stay inside the pool, free, and shaped
    // like an id, with a person named after the house.
    for (let draw = 0; draw < 100; draw += 1) {
      const identity = drawHouseIdentity(world);

      expect(HOUSE_NAMES).toContain(identity.houseName);
      expect(world.houses[identity.id]).toBeUndefined();
      expect(identity.id).toMatch(/^[a-z0-9-]+$/);
      expect(identity.personName.endsWith(identity.houseName)).toBe(true);
      expect(PERSON_NAMES.some((firstName) => identity.personName.startsWith(`${firstName} `))).toBe(true);
    }
  });

  it('falls back to a made-up name when every pool name is taken', () => {
    // Arrange: a town carrying every name of the pool.
    const world = createWorld(1);
    for (const [index, name] of HOUSE_NAMES.entries()) {
      world.houses[`taken-${index}`] = {
        ...(world.houses.caron as House),
        id: `taken-${index}`,
        name,
      };
    }

    // Act
    const identity = drawHouseIdentity(world);

    // Assert: a name outside the pool, and an id nothing else holds.
    expect(identity.houseName).toMatch(/^Maison \d+$/);
    expect(world.houses[identity.id]).toBeUndefined();
  });

  it('never picks a name an AI house already carries', () => {
    // Arrange: an AI house takes one of the pool's names.
    const world = createWorld(1);
    const taken = HOUSE_NAMES[0];
    world.houses.caron.name = taken;

    // Act and assert
    for (let draw = 0; draw < 100; draw += 1) {
      expect(drawHouseIdentity(world).houseName).not.toBe(taken);
    }
  });
});

describe('the town name', () => {
  it('draws a name no database has spent, and an id from it', () => {
    // Arrange
    const taken: string[] = [];

    // Act and assert: every draw takes a free name, and the pool is spent one
    // name at a time.
    for (let draw = 0; draw < TOWN_NAMES.length; draw += 1) {
      const town = drawTownIdentity(taken);

      expect(TOWN_NAMES).toContain(town.name);
      expect(taken).not.toContain(town.name);
      expect(town.id).toMatch(/^[a-z0-9-]+$/);
      taken.push(town.name);
    }
  });

  it('falls back to the first free numbered place once every name is spent', () => {
    // Arrange: a database holding the whole pool, and the first fallback.
    const taken = [...TOWN_NAMES, 'Bourg 1'];

    // Act
    const town = drawTownIdentity(taken);

    // Assert: a name outside the pool and outside the taken fallbacks.
    expect(town.name).toBe('Bourg 2');
    expect(taken).not.toContain(town.name);
  });
});
