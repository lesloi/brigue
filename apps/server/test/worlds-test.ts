import { createWorld, type Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { MemoryWorldStore, UnknownWorldError, type TownInfo } from '../src/worlds.ts';
import { town } from './helpers.ts';

/** One town event per hour, so a cut has a visible order to work on. */
function priceAt(hour: number): Event {
  return { type: 'market.price_changed', audience: 'town', at: hour, good: 'wool', before: 100, after: 101 };
}

function hours(from: number, to: number): Event[] {
  return Array.from({ length: to - from + 1 }, (_, index) => priceAt(from + index));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

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

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four houses and a younger one of three.
    const store = new MemoryWorldStore();
    await store.createTown({ id: 'old', name: 'Old' }, town(1), new Date());
    await store.createTown({ id: 'new', name: 'New' }, createWorld(2), new Date());

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual(['new', 'old']);
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

  it('drops the journal older than the cut and keeps the newest page', async () => {
    // Arrange: two pages and a bit of entries, one per hour.
    const store = new MemoryWorldStore();
    await store.createTown({ id: 'a', name: 'A' }, createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 120));
    }, 'a');

    // Act: the cut alone would leave twelve entries; the page floor keeps the
    // newest fifty whatever their age.
    await store.pruneJournal('a', 109);

    // Assert: the page still reads, and nothing older than it survives.
    const page = await store.withWorld(async (session) => session.eventsSince(0, 100, 'leclerc'), 'a');
    expect(page.events.map((event) => event.at)).toEqual(range(71, 120));
  });

  it('keeps an entry exactly on the cut, and counts what the page leaves', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    await store.createTown({ id: 'a', name: 'A' }, createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 120));
    }, 'a');

    // Act: seventy-one entries are at or after the cut, so the page floor does
    // not decide the boundary.
    await store.pruneJournal('a', 50);

    // Assert: the strict cut keeps its own hour; the page counts the rest.
    const page = await store.withWorld(async (session) => session.eventsSince(0, 10, 'leclerc'), 'a');
    expect(page.events.map((event) => event.at)).toEqual(range(111, 120));
    expect(page.counts).toEqual({ 'market.price_changed': 61 });
  });

  it('keeps a journal shorter than a page whole', async () => {
    // Arrange: ten entries, all older than the cut.
    const store = new MemoryWorldStore();
    await store.createTown({ id: 'a', name: 'A' }, createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 10));
    }, 'a');

    // Act: there is no newer page to protect the entries with, so only the
    // floor keeps them.
    await store.pruneJournal('a', 1_000);

    // Assert
    const page = await store.withWorld(async (session) => session.eventsSince(0, 100, 'leclerc'), 'a');
    expect(page.events.map((event) => event.at)).toEqual(range(1, 10));
  });
});
