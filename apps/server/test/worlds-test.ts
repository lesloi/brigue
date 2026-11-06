import { createWorld } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { MemoryWorldStore, UnknownWorldError, type TownInfo } from '../src/worlds.ts';

describe('the town store', () => {
  it('keeps two towns apart and clears one without the other', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const first: TownInfo = { id: 'a', name: 'A' };
    const second: TownInfo = { id: 'b', name: 'B' };
    await store.createTown(first, { ...createWorld(1), seed: 1 }, new Date());
    await store.createTown(second, { ...createWorld(2), seed: 2 }, new Date());

    // Act: each town reads its own snapshot.
    const a = await store.withWorld(async (session) => session.snapshot, 'a');
    const b = await store.withWorld(async (session) => session.snapshot, 'b');

    // Assert: names and states do not mix.
    expect(a.town).toEqual(first);
    expect(b.town).toEqual(second);
    expect(a.world.seed).toBe(1);
    expect(b.world.seed).toBe(2);
    expect((await store.listTowns()).map((town) => town.id)).toEqual(['a', 'b']);

    // Act: the first town goes, the second stays.
    await store.withWorld(async (session) => session.clear(), 'a');

    // Assert
    await expect(store.withWorld(async (session) => session.snapshot, 'a')).rejects.toBeInstanceOf(UnknownWorldError);
    expect((await store.withWorld(async (session) => session.snapshot, 'b')).town.id).toBe('b');
  });

  it('keeps a dead town name spent', async () => {
    // Arrange: a town that has lived and gone.
    const store = new MemoryWorldStore();
    await store.createTown({ id: 'a', name: 'Amiens' }, createWorld(1), new Date());
    await store.withWorld(async (session) => session.clear(), 'a');

    // Act and assert: the name is remembered, so it is never drawn again.
    expect(await store.usedTownNames()).toEqual(['Amiens']);
    expect(await store.listTowns()).toEqual([]);
  });

  it('creates a town once', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const town: TownInfo = { id: 'a', name: 'A' };
    await store.createTown(town, createWorld(1), new Date());

    // Act: a second creation with another name is ignored.
    await store.createTown({ id: 'a', name: 'Autre' }, createWorld(9), new Date());

    // Assert
    const snapshot = await store.withWorld(async (session) => session.snapshot, 'a');
    expect(snapshot.town.name).toBe('A');
    expect(snapshot.world.seed).toBe(1);
  });
});
