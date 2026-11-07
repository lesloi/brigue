import { afterEach, describe, expect, it, vi } from 'vitest';

import { PACING, stateHash, withNewcomer, type Action, type Event, type World } from '@brigue/core';

import { createLogger } from '../src/logger.ts';
import { MemoryPlayerStore } from '../src/identity/players.ts';
import { playDue, startScheduler } from '../src/town/scheduler.ts';
import { issueToken } from '../src/identity/session.ts';
import {
  HOUR_MS,
  MemoryWorldStore,
  UnknownWorldError,
  type StoredAction,
  type WorldSession,
  type WorldStore,
} from '../src/town/worlds.ts';
import { TEST_FIRST_DYNASTY, TEST_TOWN, town as playableTown } from './helpers.ts';

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

async function playersWith(dynastyId = TEST_FIRST_DYNASTY.id, at = START): Promise<MemoryPlayerStore> {
  const players = new MemoryPlayerStore();
  await issueToken(players, TEST_TOWN.id, dynastyId, at);

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
  const action: Action = { type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units };

  return { id, dynastyId: 'leclerc', playsAt: at, action, receivedAt: new Date(START), cancelledAt: null };
}

/** One chronicle line per hour, so a cut has a visible order to work on. */
function priceAt(hour: number): Event {
  return {
    type: 'council.election_held',
    audience: 'town',
    at: hour,
    seatId: 'maire',
    winnerDynastyId: null,
    votes: {},
  };
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
    // Arrange: two refusals share an hour, a buy follows on the next one. A
    // refusal keeps the order it was received in, which is what the row order is.
    const store = await town();
    const refused = (id: string, at: number, action: Action): StoredAction => ({
      id,
      dynastyId: 'leclerc',
      playsAt: at,
      action,
      receivedAt: new Date(START),
      cancelledAt: null,
    });
    await withTown(store, async (session) => {
      await session.append(refused('first', 2, { type: 'market.sell', dynastyId: 'leclerc', good: 'grain', units: 1 }));
      await session.append(buy('second', 3, 4));
      await session.append(refused('third', 2, { type: 'dynasty.buy_title', dynastyId: 'leclerc' }));
    });

    // Act
    const due = await pass(store, new Date(START.getTime() + 3 * HOUR));

    // Assert: the two refusals of hour two come in received order, before the
    // third hour's buy.
    const mine = due.events.flatMap((event) =>
      event.type === 'action.refused' && event.dynastyId === 'leclerc' ? [{ at: event.at, action: event.action }] : [],
    );
    expect(mine).toEqual([
      { at: 2, action: 'market.sell' },
      { at: 2, action: 'dynasty.buy_title' },
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

  it('prunes the journal past the real-time window on a pass that plays nothing', async () => {
    // Arrange: a town re-anchored eight days later, holding entries written
    // before the window. Nothing is due, so the pass has no save to hang a prune
    // on.
    vi.useFakeTimers();
    const clock = { now: START.getTime() };
    const store = new MemoryWorldStore(() => new Date(clock.now));
    await store.createTown(TEST_TOWN.name, { ...playableTown(20261105), hour: 200 }, START);
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, session.snapshot.hourStartedAt, hours(1, 31));
    }, TEST_TOWN.id);
    clock.now += 8 * 24 * HOUR;
    await store.withWorld(async (session) => {
      await session.save(session.snapshot.world, new Date(clock.now), hours(32, 120));
    }, TEST_TOWN.id);
    const scheduler = startScheduler({
      store,
      players: await playersWith(),
      logger: createLogger(() => {}),
      now: () => new Date(clock.now),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the town did not move, and nothing older than the window is left.
    const read = await store.withWorld(
      async (session) => ({
        hour: session.snapshot.world.hour,
        page: await session.recentChronicle(200),
      }),
      TEST_TOWN.id,
    );
    expect(read.hour).toBe(200);
    expect(read.page[0]?.at).toBe(32);
    expect(read.page).toHaveLength(89);
  });

  it('plays every town in the same pass', async () => {
    // Arrange: two towns, each with a player.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const a = await store.createTown('A', playableTown(20261105), START);
    const b = await store.createTown('B', playableTown(20261106), START);
    await issueToken(players, a.id, TEST_FIRST_DYNASTY.id, START);
    await issueToken(players, b.id, TEST_FIRST_DYNASTY.id, START);
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
    await issueToken(players, bad.id, TEST_FIRST_DYNASTY.id, START);
    await issueToken(players, good.id, TEST_FIRST_DYNASTY.id, START);
    const broken: WorldStore = {
      createTown: (name, world, hourStartedAt) => real.createTown(name, world, hourStartedAt),
      listTowns: () => real.listTowns(),
      listHumanNames: () => real.listHumanNames(),
      withWorld: (run, townId) =>
        townId === bad.id ? Promise.reject(new Error('the row is locked')) : real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      markMessagesRead: (dynastyId) => real.markMessagesRead(dynastyId),
      pruneJournal: (townId, chronicleBefore, messagesBefore) =>
        real.pruneJournal(townId, chronicleBefore, messagesBefore),
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
      TEST_FIRST_DYNASTY.id,
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

    // Assert: the dynasty, the row and the town are gone.
    await expect(store.withWorld(async (session) => session.snapshot, TEST_TOWN.id)).rejects.toBeInstanceOf(
      UnknownWorldError,
    );
    expect(await players.listByTown(TEST_TOWN.id)).toEqual([]);
  });

  it('erases one dynasty and leaves the town to the others', async () => {
    // Arrange: two humans, one of them past the deadline.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const identity = { id: 'moreau', dynastyName: 'Moreau', personName: 'Colin Moreau' };
    await store.createTown(TEST_TOWN.name, withNewcomer(playableTown(20261105), 'baker', identity), START);
    const gone = await issueToken(players, TEST_TOWN.id, TEST_FIRST_DYNASTY.id, START);
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

    // Assert: the erased dynasty and its row are gone, the other keeps the town.
    const world = (await store.withWorld(async (session) => session.snapshot, TEST_TOWN.id)).world;
    expect(world.dynasties[TEST_FIRST_DYNASTY.id]).toBeUndefined();
    expect(world.dynasties[identity.id]).toBeDefined();
    expect(await players.findByTokenHash(gone.player.tokenHash)).toBeNull();
    expect(await players.findByTokenHash(stays.player.tokenHash)).not.toBeNull();
  });

  it('erases an account a reset left without a dynasty at its deadline', async () => {
    // Arrange: no town, and one account between towns whose week is over.
    vi.useFakeTimers();
    const store = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const tokenHash = 'a'.repeat(64);
    await players.insert({
      tokenHash,
      townId: null,
      dynastyId: null,
      createdAt: START,
      lastSeenAt: START,
      revokedAt: null,
      deleteAfter: new Date(START.getTime() - HOUR),
    });
    const logs: string[] = [];
    const scheduler = startScheduler({
      store,
      players,
      logger: createLogger((line) => logs.push(line)),
      now: () => new Date(START),
      everyMs: 1_000,
    });

    // Act
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();

    // Assert: the account is erased, and the pass says so.
    expect(await players.findByTokenHash(tokenHash)).toBeNull();
    expect(logs.join('\n')).toContain('player.deleted_unbound');
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
      listHumanNames: () => real.listHumanNames(),
      withWorld: (run, townId) => real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      markMessagesRead: (dynastyId) => real.markMessagesRead(dynastyId),
      pruneJournal: (townId, chronicleBefore, messagesBefore) => {
        pruned.push(townId);

        return real.pruneJournal(townId, chronicleBefore, messagesBefore);
      },
      close: () => real.close(),
    };
    const players = new MemoryPlayerStore();
    await issueToken(players, TEST_TOWN.id, TEST_FIRST_DYNASTY.id, new Date(START.getTime() - 31 * 24 * HOUR));
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

    // Assert: the town went with its last human dynasty, without a read, and its
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
      listHumanNames: () => real.listHumanNames(),
      withWorld: (run, townId) => real.withWorld(run, townId),
      withJoinLock: (run) => real.withJoinLock(run),
      markMessagesRead: (dynastyId) => real.markMessagesRead(dynastyId),
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
      listHumanNames: () => real.listHumanNames(),
      withWorld: (run, townId) => {
        attempts += 1;

        return attempts === 1 ? Promise.reject(new Error('the database is down')) : real.withWorld(run, townId);
      },
      withJoinLock: (run) => real.withJoinLock(run),
      markMessagesRead: (dynastyId) => real.markMessagesRead(dynastyId),
      pruneJournal: (townId, chronicleBefore, messagesBefore) =>
        real.pruneJournal(townId, chronicleBefore, messagesBefore),
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
