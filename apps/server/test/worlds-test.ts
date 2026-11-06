import { createWorld, type Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { MemoryWorldStore, UnknownWorldError } from '../src/town/worlds.ts';
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
    const first = await store.createTown('A', { ...createWorld(1), seed: 1 }, new Date());
    const second = await store.createTown('B', { ...createWorld(2), seed: 2 }, new Date());

    // Act: each town reads its own snapshot.
    const a = await store.withWorld(async (session) => session.snapshot, first.id);
    const b = await store.withWorld(async (session) => session.snapshot, second.id);

    // Assert: names and states do not mix.
    expect(a.town).toEqual(first);
    expect(b.town).toEqual(second);
    expect(a.world.seed).toBe(1);
    expect(b.world.seed).toBe(2);
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([first.id, second.id]);

    // Act: the first town goes, the second stays.
    await store.withWorld(async (session) => session.clear(), first.id);

    // Assert
    await expect(store.withWorld(async (session) => session.snapshot, first.id)).rejects.toBeInstanceOf(
      UnknownWorldError,
    );
    expect((await store.withWorld(async (session) => session.snapshot, second.id)).town.id).toBe(second.id);
  });

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four houses and a younger one of three.
    const store = new MemoryWorldStore();
    const old = await store.createTown('Old', town(1), new Date());
    const young = await store.createTown('New', createWorld(2), new Date());

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('gives a name that comes back a new id', async () => {
    // Arrange: a town that has lived and gone.
    const store = new MemoryWorldStore();
    const first = await store.createTown('Amiens', createWorld(1), new Date());
    await store.withWorld(async (session) => session.clear(), first.id);

    // Act: the same name comes back.
    const second = await store.createTown('Amiens', createWorld(2), new Date());

    // Assert: the id is new, the name is not.
    expect(second.name).toBe('Amiens');
    expect(second.id).not.toBe(first.id);
  });

  it('creates a new town on a second call', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const first = await store.createTown('A', createWorld(1), new Date());

    // Act: a second creation is a second town, not a retry.
    const second = await store.createTown('A', createWorld(9), new Date());

    // Assert
    expect(second.id).not.toBe(first.id);
    expect(await store.listTowns()).toHaveLength(2);
  });

  it('drops the journal older than the cut and keeps the newest page', async () => {
    // Arrange: two pages and a bit of entries, one per hour.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 120));
    }, created.id);

    // Act: the cut alone would leave twelve entries; the page floor keeps the
    // newest fifty whatever their age.
    await store.pruneJournal(created.id, 109);

    // Assert: the page still reads, and nothing older than it survives.
    const page = await store.withWorld(async (session) => session.eventsSince(0, 100, 'leclerc'), created.id);
    expect(page.events.map((event) => event.at)).toEqual(range(71, 120));
  });

  it('keeps an entry exactly on the cut, and counts what the page leaves', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 120));
    }, created.id);

    // Act: seventy-one entries are at or after the cut, so the page floor does
    // not decide the boundary.
    await store.pruneJournal(created.id, 50);

    // Assert: the strict cut keeps its own hour; the page counts the rest.
    const page = await store.withWorld(async (session) => session.eventsSince(0, 10, 'leclerc'), created.id);
    expect(page.events.map((event) => event.at)).toEqual(range(111, 120));
    expect(page.counts).toEqual({ 'market.price_changed': 61 });
  });

  it('keeps a journal shorter than a page whole', async () => {
    // Arrange: ten entries, all older than the cut.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', createWorld(1), new Date());
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 10));
    }, created.id);

    // Act: there is no newer page to protect the entries with, so only the
    // floor keeps them.
    await store.pruneJournal(created.id, 1_000);

    // Assert
    const page = await store.withWorld(async (session) => session.eventsSince(0, 100, 'leclerc'), created.id);
    expect(page.events.map((event) => event.at)).toEqual(range(1, 10));
  });
});
