import { afterEach, describe, expect, it, vi } from 'vitest';

import { PACING, stateHash, withNewcomer, type Action, type Event, type World } from '@brigue/core';

import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/players.ts';
import { playDue, startScheduler } from '../src/scheduler.ts';
import { issueToken } from '../src/session.ts';
import {
  HOUR_MS,
  MemoryWorldStore,
  UnknownWorldError,
  type StoredAction,
  type WorldSession,
  type WorldStore,
} from '../src/worlds.ts';
import { TEST_FIRST_HOUSE, TEST_TOWN, town as playableTown } from './helpers.ts';

const START = new Date('2026-11-05T00:00:00.000Z');
const HOUR = HOUR_MS;

async function town(options: { at?: Date; world?: World } = {}): Promise<MemoryWorldStore> {
  const store = new MemoryWorldStore();
  const at = options.at ?? START;
  await store.createTown(TEST_TOWN.name, options.world ?? playableTown(20261105), at);

  return store;
}

/** One town of the fixtures: every pass below plays the one the helper built. */
function withTown<T>(store: MemoryWorldStore, run: (session: WorldSession) => Promise<T>): Promise<T> {
  return store.withWorld(run, TEST_TOWN.id);
}

async function playersWith(houseId = TEST_FIRST_HOUSE.id, at = START): Promise<MemoryPlayerStore> {
  const players = new MemoryPlayerStore();
  await issueToken(players, TEST_TOWN.id, houseId, at);

  return players;
}

/** One pass of the loop: play what is due, then keep it when an hour was lived. */
async function pass(store: MemoryWorldStore, now: Date, minHours = 1) {
  return withTown(store, async (session) => {
    const due = await playDue(session, session.snapshot, now, minHours);

    if (due.hours > 0) {
      await session.save(due.world, due.hourStartedAt, due.events);
    }

    return due;
  });
}

async function worldOf(store: MemoryWorldStore) {
  return withTown(store, async (session) => session.snapshot);
}

function buy(id: string, at: number, units: number): StoredAction {
  const action: Action = { type: 'market.buy', houseId: 'leclerc', good: 'wool', units };

  return { id, houseId: 'leclerc', playsAt: at, action, receivedAt: new Date(START), cancelledAt: null };
}

/** One town event per hour, so a cut has a visible order to work on. */
function priceAt(hour: number): Event {
  return { type: 'market.price_changed', audience: 'town', at: hour, good: 'wool', before: 100, after: 101 };
}

function hours(from: number, to: number): Event[] {
  return Array.from({ length: to - from + 1 }, (_, index) => priceAt(from + index));
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
    const hashes = await withTown(store, async (session) => {
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
    await withTown(store, async (session) => {
      await session.append(buy('first', 2, 2));
      await session.append(buy('second', 3, 4));
      await session.append(buy('third', 2, 1));
    });

    // Act
    const due = await pass(store, new Date(START.getTime() + 3 * HOUR));

    // Assert
    const mine = due.events.flatMap((event) =>
      event.type === 'market.bought' && event.houseId === 'leclerc' ? [{ at: event.at, units: event.units }] : [],
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
      players: await playersWith(),
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
      players: await playersWith(),
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

  it('prunes the journal past the window on a pass that plays nothing', async () => {
    // Arrange: a town whose clock is past the window, holding entries older
    // than it. Nothing is due, so the pass has no save to hang a prune on.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    await store.createTown(TEST_TOWN.name, { ...playableTown(20261105), hour: 200 }, START);
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 120));
    }, TEST_TOWN.id);
    const scheduler = startScheduler({
      store,
      players: await playersWith(),
      logger: createLogger(() => {}),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the town did not move, and nothing older than the window is left.
    const read = await store.withWorld(
      async (session) => ({
        hour: session.snapshot.world.hour,
        page: await session.eventsSince(0, 200, TEST_FIRST_HOUSE.id),
      }),
      TEST_TOWN.id,
    );
    expect(read.hour).toBe(200);
    expect(read.page.events[0]?.at).toBe(32);
    expect(read.page.events).toHaveLength(89);
  });

  it('plays every town in the same pass', async () => {
    // Arrange: two towns, each with a player.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const a = await store.createTown('A', playableTown(20261105), START);
    const b = await store.createTown('B', playableTown(20261106), START);
    await issueToken(players, a.id, TEST_FIRST_HOUSE.id, START);
    await issueToken(players, b.id, TEST_FIRST_HOUSE.id, START);
    const clock = { now: START.getTime() };
    const scheduler = startScheduler({
      store,
      players,
      logger: createLogger(() => {}),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    clock.now += HOUR;
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: both towns lived the hour, each on its own clock.
    expect((await store.withWorld(async (session) => session.snapshot, a.id)).world.hour).toBe(2);
    expect((await store.withWorld(async (session) => session.snapshot, b.id)).world.hour).toBe(2);
  });

  it('keeps playing the other towns when one fails', async () => {
    // Arrange: a town the store refuses and one it plays.
    vi.useFakeTimers();
    const real = new MemoryWorldStore();
    const bad = await real.createTown('Bad', playableTown(20261105), START);
    const good = await real.createTown('Good', playableTown(20261106), START);
    const players = new MemoryPlayerStore();
    await issueToken(players, bad.id, TEST_FIRST_HOUSE.id, START);
    await issueToken(players, good.id, TEST_FIRST_HOUSE.id, START);
    const broken: WorldStore = {
      createTown: (name, world, hourStartedAt) => real.createTown(name, world, hourStartedAt),
      listTowns: () => real.listTowns(),
      withWorld: (run, townId) =>
        townId === bad.id ? Promise.reject(new Error('the row is locked')) : real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      pruneJournal: (townId, oldestKeptHour) => real.pruneJournal(townId, oldestKeptHour),
      close: () => real.close(),
    };
    const clock = { now: START.getTime() + HOUR };
    const logs: string[] = [];
    const scheduler = startScheduler({
      store: broken,
      players,
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the failure is named, and the sound town still moves.
    expect(logs.some((line) => line.includes('town.advance_failed') && line.includes(String(bad.id)))).toBe(true);
    expect((await real.withWorld(async (session) => session.snapshot, good.id)).world.hour).toBe(2);
    expect((await real.withWorld(async (session) => session.snapshot, bad.id)).world.hour).toBe(1);
  });

  it('erases an identity whose week is over, and the town with it', async () => {
    // Arrange: the only human asked for the deletion a week ago.
    vi.useFakeTimers();
    const store = await town();
    const players = new MemoryPlayerStore();
    const { player } = await issueToken(
      players,
      TEST_TOWN.id,
      TEST_FIRST_HOUSE.id,
      new Date(START.getTime() - 8 * 24 * HOUR),
    );
    await players.markDeletion(player.tokenHash, new Date(START.getTime() - HOUR));
    const scheduler = startScheduler({
      store,
      players,
      logger: createLogger(() => {}),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the house, the row and the town are gone.
    await expect(store.withWorld(async (session) => session.snapshot, TEST_TOWN.id)).rejects.toBeInstanceOf(
      UnknownWorldError,
    );
    expect(await players.listByTown(TEST_TOWN.id)).toEqual([]);
  });

  it('erases one house and leaves the town to the others', async () => {
    // Arrange: two humans, one of them past the deadline.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const identity = { id: 'moreau', houseName: 'Moreau', personName: 'Colin Moreau' };
    await store.createTown(TEST_TOWN.name, withNewcomer(playableTown(20261105), 'baker', identity), START);
    const gone = await issueToken(players, TEST_TOWN.id, TEST_FIRST_HOUSE.id, START);
    const stays = await issueToken(players, TEST_TOWN.id, identity.id, START);
    await players.markDeletion(gone.player.tokenHash, new Date(START.getTime() - HOUR));
    const scheduler = startScheduler({
      store,
      players,
      logger: createLogger(() => {}),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the erased house and its row are gone, the other keeps the town.
    const world = (await store.withWorld(async (session) => session.snapshot, TEST_TOWN.id)).world;
    expect(world.houses[TEST_FIRST_HOUSE.id]).toBeUndefined();
    expect(world.houses[identity.id]).toBeDefined();
    expect(await players.findByTokenHash(gone.player.tokenHash)).toBeNull();
    expect(await players.findByTokenHash(stays.player.tokenHash)).not.toBeNull();
  });

  it('stays quiet when there is no town yet', async () => {
    // Arrange: a database with no town, as after the last player left.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const logs: string[] = [];
    const scheduler = startScheduler({
      store,
      players: new MemoryPlayerStore(),
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.stop();

    // Assert: no town is not a failure.
    expect(logs).toEqual([]);
  });

  it('deletes a town whose last human has been silent for a month, and does not prune it', async () => {
    // Arrange: the player's last visit is past the deletion threshold, and
    // nobody will read the town to notice. The store watches for a prune.
    vi.useFakeTimers();
    const real = await town();
    const pruned: number[] = [];
    const store: WorldStore = {
      createTown: (name, world, at) => real.createTown(name, world, at),
      listTowns: () => real.listTowns(),
      withWorld: (run, townId) => real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      pruneJournal: (townId, oldestKeptHour) => {
        pruned.push(townId);

        return real.pruneJournal(townId, oldestKeptHour);
      },
      close: () => real.close(),
    };
    const players = new MemoryPlayerStore();
    await issueToken(players, TEST_TOWN.id, TEST_FIRST_HOUSE.id, new Date(START.getTime() - 31 * 24 * HOUR));
    const scheduler = startScheduler({
      store,
      players,
      logger: createLogger(() => {}),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the town went with its last human house, without a read, and its
    // journal went with it, so there was nothing left to prune.
    await expect(withTown(real, async (session) => session.snapshot)).rejects.toBeInstanceOf(UnknownWorldError);
    expect(pruned).toEqual([]);
  });

  it('keeps the town moving when the journal cannot be pruned', async () => {
    // Arrange: a store whose journal fails on every pass.
    vi.useFakeTimers();
    const real = await town();
    const guarded: WorldStore = {
      createTown: (name, world, at) => real.createTown(name, world, at),
      listTowns: () => real.listTowns(),
      withWorld: (run, townId) => real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      pruneJournal: () => Promise.reject(new Error('the journal is stuck')),
      close: () => real.close(),
    };
    const clock = { now: START.getTime() + HOUR };
    const logs: string[] = [];
    const scheduler = startScheduler({
      store: guarded,
      players: await playersWith(),
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the hour played, and the prune failure is its own line, not the
    // town's.
    expect((await worldOf(real)).world.hour).toBe(2);
    expect(logs.some((line) => line.includes('town.journal_prune_failed'))).toBe(true);
    expect(logs.some((line) => line.includes('town.advance_failed'))).toBe(false);
  });

  it('logs a failing pass and keeps looking at the clock', async () => {
    // Arrange: the first pass cannot reach the town, the next one can.
    vi.useFakeTimers();
    const real = await town();
    let attempts = 0;
    const flaky: WorldStore = {
      createTown: (name, world, hourStartedAt) => real.createTown(name, world, hourStartedAt),
      listTowns: () => real.listTowns(),
      withWorld: (run, townId) => {
        attempts += 1;

        return attempts === 1 ? Promise.reject(new Error('the database is down')) : real.withWorld(run, townId);
      },
      withJoinLock: (run) => real.withJoinLock(run),
      pruneJournal: (townId, oldestKeptHour) => real.pruneJournal(townId, oldestKeptHour),
      close: () => real.close(),
    };
    const clock = { now: START.getTime() + HOUR };
    const logs: string[] = [];
    const scheduler = startScheduler({
      store: flaky,
      players: await playersWith(),
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
