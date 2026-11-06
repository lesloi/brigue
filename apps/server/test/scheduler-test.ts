import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorld, PACING, stateHash, type Action, type Event, type World } from '@brigue/core';

import { createLogger } from '../src/logger.ts';
import { playDue, startScheduler } from '../src/scheduler.ts';
import { HOUR_MS, MemoryWorldStore, type StoredAction, type WorldStore } from '../src/worlds.ts';

const START = new Date('2026-11-05T00:00:00.000Z');
const HOUR = HOUR_MS;

async function town(options: { at?: Date; world?: World } = {}): Promise<MemoryWorldStore> {
  const store = new MemoryWorldStore();
  const at = options.at ?? START;
  await store.createIfAbsent(options.world ?? createWorld(20261105), at, at);

  return store;
}

/** One pass of the loop: play what is due, then keep it when an hour was lived. */
async function pass(store: MemoryWorldStore, now: Date, minHours = 1) {
  return store.withWorld(async (session) => {
    const due = await playDue(session, session.snapshot, now, minHours);

    if (due.hours > 0) {
      await session.save(due.world, due.hourStartedAt, due.events);
    }

    return due;
  });
}

async function worldOf(store: MemoryWorldStore) {
  return store.withWorld(async (session) => session.snapshot);
}

function buy(id: string, at: number, units: number): StoredAction {
  const action: Action = { type: 'market.buy', houseId: 'brigue', good: 'wool', units };

  return { id, houseId: 'brigue', playsAt: at, action, receivedAt: new Date(START), cancelledAt: null };
}

describe('playDue', () => {
  it('plays nothing while the current hour is not over', async () => {
    // Arrange
    const store = await town();

    // Act: one millisecond short of the hour's end.
    const due = await pass(store, new Date(START.getTime() + HOUR - 1));

    // Assert
    expect(due.hours).toBe(0);
    expect(due.skipped).toBe(0);
    expect(due.world.hour).toBe(1);
    expect(due.hourStartedAt).toEqual(START);
    expect(due.events).toEqual([]);
  });

  it('plays the hours the wall clock owes and moves the anchor with them', async () => {
    // Arrange
    const store = await town();
    const now = new Date(START.getTime() + 3 * HOUR);

    // Act
    const due = await pass(store, now);

    // Assert: the town lived three hours, so its hour went from 1 to 4.
    expect(due.hours).toBe(3);
    expect(due.skipped).toBe(0);
    expect(due.world.hour).toBe(4);
    expect(due.hourStartedAt).toEqual(now);
    expect(due.events.length).toBeGreaterThan(0);
  });

  it('leaves the same town whether it catches up at once or an hour at a time', async () => {
    // Arrange: two towns over the same seed.
    const atOnce = await town();
    const stepByStep = await town();

    // Act
    const bulk = await pass(atOnce, new Date(START.getTime() + 3 * HOUR));
    const stepped: Event[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const due = await pass(stepByStep, new Date(START.getTime() + index * HOUR));
      expect(due.hours).toBe(1);
      stepped.push(...due.events);
    }

    // Assert: a late pass and three on-time passes are the same town.
    const [bulkSnapshot, steppedSnapshot] = await Promise.all([worldOf(atOnce), worldOf(stepByStep)]);
    expect(stateHash(steppedSnapshot.world)).toBe(stateHash(bulkSnapshot.world));
    expect(stepped).toEqual(bulk.events);
    expect(steppedSnapshot.hourStartedAt).toEqual(bulkSnapshot.hourStartedAt);
  });

  it('jumps over a backlog past the cap and counts the hours it skipped', async () => {
    // Arrange
    const store = await town();
    const elapsed = PACING.maxCatchUpHours + 5;
    const now = new Date(START.getTime() + elapsed * HOUR);

    // Act
    const due = await pass(store, now);

    // Assert: the unplayed hours are not simulated, but the anchor still meets
    // the wall clock, or the town would owe them forever.
    expect(due.hours).toBe(PACING.maxCatchUpHours);
    expect(due.skipped).toBe(5);
    expect(due.world.hour).toBe(1 + PACING.maxCatchUpHours);
    expect(due.hourStartedAt).toEqual(now);

    // Act: five more wall hours pass.
    const later = await pass(store, new Date(now.getTime() + 5 * HOUR));

    // Assert: only the new hours are played; the skipped ones are gone.
    expect(later.hours).toBe(5);
    expect(later.skipped).toBe(0);
    expect(later.world.hour).toBe(1 + PACING.maxCatchUpHours + 5);
  });

  it('plays a backlog exactly at the cap without skipping', async () => {
    // Arrange: the boundary is where an off-by-one would hide.
    const store = await town();
    const now = new Date(START.getTime() + PACING.maxCatchUpHours * HOUR);

    // Act
    const due = await pass(store, now);

    // Assert
    expect(due.hours).toBe(PACING.maxCatchUpHours);
    expect(due.skipped).toBe(0);
    expect(due.world.hour).toBe(1 + PACING.maxCatchUpHours);
    expect(due.hourStartedAt).toEqual(now);
  });

  it('does not touch the world it is given', async () => {
    // Arrange: the memory store hands out its live snapshot, so an in-place
    // step would corrupt the stored town even without a save.
    const store = await town();

    // Act
    const hashes = await store.withWorld(async (session) => {
      const before = stateHash(session.snapshot.world);
      await playDue(session, session.snapshot, new Date(START.getTime() + 2 * HOUR));

      return { before, after: stateHash(session.snapshot.world) };
    });

    // Assert
    expect(hashes.after).toBe(hashes.before);
  });

  it('leaves a town one hour behind to the scheduler and wakes it at two', async () => {
    // Arrange: the reader's floor is what tells a live loop from a dead one.
    const store = await town();

    // Act
    const one = await pass(store, new Date(START.getTime() + HOUR), 2);
    const two = await pass(store, new Date(START.getTime() + 2 * HOUR), 2);

    // Assert
    expect(one.hours).toBe(0);
    expect(one.hourStartedAt).toEqual(START);
    expect(two.hours).toBe(2);
    expect(two.world.hour).toBe(3);
  });

  it('plays the actions of the hours it sweeps, on their own hour and in order', async () => {
    // Arrange: two actions share an hour, one follows it.
    const store = await town();
    await store.withWorld(async (session) => {
      await session.append(buy('first', 2, 2));
      await session.append(buy('second', 3, 4));
      await session.append(buy('third', 2, 1));
    });

    // Act
    const due = await pass(store, new Date(START.getTime() + 3 * HOUR));

    // Assert
    const mine = due.events.flatMap((event) =>
      event.type === 'market.bought' && event.houseId === 'brigue' ? [{ at: event.at, units: event.units }] : [],
    );
    expect(mine).toEqual([
      { at: 2, units: 2 },
      { at: 2, units: 1 },
      { at: 3, units: 4 },
    ]);
  });
});

describe('startScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wakes the town on its own and never plays the same hour twice', async () => {
    // Arrange
    vi.useFakeTimers();
    const store = await town();
    const clock = { now: START.getTime() };
    const logs: string[] = [];
    const scheduler = startScheduler({
      store,
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act: an hour passes while the loop is the only thing looking at it.
    clock.now += HOUR;
    await vi.advanceTimersByTimeAsync(1_000);

    // Assert: the pass played the hour and moved the anchor with it.
    const played = await worldOf(store);
    expect(played.world.hour).toBe(2);
    expect(played.hourStartedAt).toEqual(new Date(clock.now));

    // Act: more passes on the same hour.
    await vi.advanceTimersByTimeAsync(5_000);

    // Assert: they change nothing.
    expect((await worldOf(store)).world.hour).toBe(2);

    // Act: the loop stops, then the clock moves again.
    scheduler.stop();
    clock.now += HOUR;
    await vi.advanceTimersByTimeAsync(5_000);

    // Assert
    expect((await worldOf(store)).world.hour).toBe(2);
  });

  it('plays a whole backlog in one pass', async () => {
    // Arrange
    vi.useFakeTimers();
    const store = await town();
    const clock = { now: START.getTime() };
    const scheduler = startScheduler({
      store,
      logger: createLogger(() => {}),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    clock.now += 3 * HOUR;
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert
    expect((await worldOf(store)).world.hour).toBe(4);
  });

  it('logs a failing pass and keeps looking at the clock', async () => {
    // Arrange: the first pass cannot reach the town, the next one can.
    vi.useFakeTimers();
    const real = await town();
    let attempts = 0;
    const flaky: WorldStore = {
      createIfAbsent: (world, hourStartedAt, at) => real.createIfAbsent(world, hourStartedAt, at),
      withWorld: (run) => {
        attempts += 1;

        return attempts === 1 ? Promise.reject(new Error('the database is down')) : real.withWorld(run);
      },
      close: () => real.close(),
    };
    const clock = { now: START.getTime() + HOUR };
    const logs: string[] = [];
    const scheduler = startScheduler({
      store: flaky,
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.stop();

    // Assert
    expect(logs.some((line) => line.includes('town.advance_failed'))).toBe(true);
    expect((await worldOf(real)).world.hour).toBe(2);
  });
});
