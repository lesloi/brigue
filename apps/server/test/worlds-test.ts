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
    // Arrange: an older town of four dynasties and a younger one of three.
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

  it('drops the journal written more than seven days ago', async () => {
    // Arrange: two batches written a week apart.
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => now);
    const created = await store.createTown('A', createWorld(1), now);
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 60));
    }, created.id);
    now = new Date('2026-01-09T00:00:00.000Z');
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(61, 120));
    }, created.id);

    // Act: the cut is seven days after the first batch, before the second.
    await store.pruneJournal(created.id, new Date('2026-01-08T00:00:00.000Z'));

    // Assert: the second batch survives whole.
    const page = await store.withWorld(async (session) => session.recentEvents(120, 'leclerc'), created.id);
    expect(page.map((event) => event.at)).toEqual(range(61, 120));
  });

  it('keeps an entry exactly on the cut', async () => {
    // Arrange
    const written = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => written);
    const created = await store.createTown('A', createWorld(1), written);
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 10));
    }, created.id);

    // Act: the cut is the write instant itself.
    await store.pruneJournal(created.id, written);

    // Assert
    const page = await store.withWorld(async (session) => session.recentEvents(100, 'leclerc'), created.id);
    expect(page.map((event) => event.at)).toEqual(range(1, 10));
  });

  it('leaves no page behind when the whole journal is older than the cut', async () => {
    // Arrange: ten entries, all written before the cut.
    const written = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => written);
    const created = await store.createTown('A', createWorld(1), written);
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 10));
    }, created.id);

    // Act: there is no page floor any more.
    await store.pruneJournal(created.id, new Date('2026-01-08T00:00:00.000Z'));

    // Assert
    const page = await store.withWorld(async (session) => session.recentEvents(100, 'leclerc'), created.id);
    expect(page).toEqual([]);
  });
});
