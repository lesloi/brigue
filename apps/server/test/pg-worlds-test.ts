import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createWorld, RULES, WorldVersionError, type Action, type Event, type World } from '@brigue/core';

import { applyMigrations } from '../src/migrations.ts';
import { PgWorldStore } from '../src/pg-worlds.ts';
import { DuplicateActionError, UnknownWorldError, type StoredAction } from '../src/worlds.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const databaseUrl = process.env.DATABASE_URL ?? '';

// Skips as a whole when there is no database to talk to, so `pnpm test` stays
// green without DATABASE_URL.
describe.runIf(databaseUrl !== '')('PgWorldStore', () => {
  let pool: Pool;
  let store: PgWorldStore;
  const worldIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
    store = new PgWorldStore(pool);
  });

  afterEach(async () => {
    for (const id of worldIds.splice(0)) {
      await pool.query('DELETE FROM worlds WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    // The store owns no pool of its own; the test built this one and closes it.
    await pool.end();
  });

  function newWorldId(): string {
    const id = randomUUID();
    worldIds.push(id);

    return id;
  }

  it('keeps the first world when createIfAbsent is called twice', async () => {
    // Arrange
    const id = newWorldId();
    const first = { ...createWorld(11), hour: 5 };
    const second = { ...createWorld(22), hour: 9 };
    const firstAt = new Date(START);
    const laterAt = new Date(START.getTime() + 60 * 60 * 1000);

    // Act
    await store.createIfAbsent(first, firstAt, firstAt);
    await store.createIfAbsent(second, laterAt, laterAt);
    const snapshot = await store.withWorld(async (session) => session.snapshot);

    // Assert
    expect(snapshot.world).toEqual(first);
    expect(snapshot.hourStartedAt).toEqual(firstAt);
  });

  it('refuses a world it does not hold', async () => {
    // Arrange
    const id = newWorldId();

    // Act
    const attempt = store.withWorld(async () => null);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('serialises two writers on the row lock', async () => {
    // Arrange
    const id = newWorldId();
    const startWeek = 5;
    await store.createIfAbsent({ ...createWorld(3), hour: startWeek }, START, START);
    const order: string[] = [];
    let markFirstRunning = (): void => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });

    const first = store.withWorld(async (session) => {
      order.push('first:start');
      markFirstRunning();
      // Holds the lock long enough for a second writer to barge in if the lock
      // were missing. This delay is load-bearing: without it a broken lock
      // would go unnoticed most of the time.
      await delay(150);
      await session.save(oneHourLater(session.snapshot.world), START, []);
      order.push('first:end');
    });

    // Act: the second writer starts only once the first one holds the lock.
    await firstEntered;
    const second = store.withWorld(async (session) => {
      order.push('second:start');
      await session.save(oneHourLater(session.snapshot.world), START, []);
      order.push('second:end');
    });
    await Promise.all([first, second]);

    // Assert
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    const world = await store.withWorld(async (session) => session.snapshot.world);
    // Two saves of +1 applied on top of each other: the second saw the first's
    // commit. A missing lock would leave both at startWeek + 1.
    expect(world.hour).toBe(startWeek + 2);
  });

  it('raises DuplicateActionError on a UUID it already stored', async () => {
    // Arrange
    const id = newWorldId();
    await store.createIfAbsent(createWorld(4), START, START);
    const action = storedAction(randomUUID(), 1, buy(2));
    await store.withWorld(async (session) => session.append(action));

    // Act
    const replay = store.withWorld(async (session) => session.append(action));

    // Assert
    await expect(replay).rejects.toBeInstanceOf(DuplicateActionError);
    const found = await store.withWorld(async (session) => session.findAction(action.id));
    expect(found).toEqual(action);
  });

  it('returns a hour actions in the order they were received', async () => {
    // Arrange: insert the lexically greater UUID first, so only `seq` can put
    // them back in insertion order. Ids are random per run because actions are
    // kept across runs on a developer's database.
    const id = newWorldId();
    await store.createIfAbsent(createWorld(5), START, START);
    const [lexicallyFirst, lexicallyLast] = [randomUUID(), randomUUID()].sort();
    const first = storedAction(lexicallyLast, 1, buy(1));
    const second = storedAction(lexicallyFirst, 1, buy(2));
    const otherWeek = storedAction(randomUUID(), 2, buy(3));
    await store.withWorld(async (session) => {
      await session.append(first);
      await session.append(second);
      await session.append(otherWeek);
    });

    // Act
    const queued = await store.withWorld(async (session) => session.actionsBetween(1, 1));

    // Assert
    expect(queued.map((action) => action.id)).toEqual([first.id, second.id]);
    expect(queued.map((action) => action.action)).toEqual([first.action, second.action]);
  });

  it('stops returning an action once it is cancelled, and keeps its row', async () => {
    // Arrange
    const id = newWorldId();
    await store.createIfAbsent(createWorld(6), START, START);
    const action = storedAction(randomUUID(), 1, buy(2));
    await store.withWorld(async (session) => {
      await session.append(action);
      await session.cancel(action.id, START);
    });

    // Act
    const queued = await store.withWorld(async (session) => session.actionsBetween(1, 1));
    const found = await store.withWorld(async (session) => session.findAction(action.id));

    // Assert: the tick no longer sees it, but a retried POST still finds the id.
    expect(queued).toEqual([]);
    expect(found?.cancelledAt).toBeInstanceOf(Date);
  });

  it('appends the events of a pass to the journal and reads them back for a house', async () => {
    // Arrange: three shapes, one of them private to a house.
    const world: World = {
      ...createWorld(2_147_483_646),
      hour: 7,
      rng: 1_234_567_890,
      market: { cloth: 1301, wool: 377, grain: 259, bread: 521, wood: 301, planks: 979 },
    };
    const events: Event[] = [
      {
        type: 'market.bought',
        audience: 'town',
        at: 7,
        houseId: 'brigue',
        good: 'wool',
        units: 2,
        priceCents: 380,
        totalCents: 760,
      },
      {
        type: 'council.election_held',
        audience: 'town',
        at: 7,
        seatId: 'maire',
        winnerHouseId: 'caron',
        votes: { brigue: 1, caron: 2 },
      },
      {
        type: 'workshop.idle',
        audience: { houseId: 'brigue' },
        at: 7,
        houseId: 'brigue',
        good: 'cloth',
        input: 'wool',
        missingUnits: 0,
      },
    ];
    const hourStartedAt = new Date(START.getTime() + 42_000);
    await store.createIfAbsent(createWorld(1), START, START);

    // Act
    await store.withWorld(async (session) => {
      await session.save(world, hourStartedAt, events);
    });
    const read = await store.withWorld(async (session) => ({
      snapshot: session.snapshot,
      journal: await session.eventsSince(0, 50, 'brigue'),
    }));

    // Assert
    expect(read.snapshot.world).toEqual(world);
    expect(read.snapshot.hourStartedAt).toEqual(hourStartedAt);
    expect(read.journal.events).toEqual(events);
    expect(read.journal.lastId).toBeGreaterThan(0);
    expect(read.journal.remaining).toBe(0);
  });

  it('rolls the world and the actions back when the callback throws', async () => {
    // Arrange
    const id = newWorldId();
    const world = { ...createWorld(6), hour: 3 };
    await store.createIfAbsent(world, START, START);
    const action = storedAction(randomUUID(), 3, buy(1));

    // Act: a catch-up that refuses the world version, after writing both tables.
    const attempt = store.withWorld(async (session) => {
      await session.append(action);
      await session.save(oneHourLater(session.snapshot.world), START, []);
      throw new WorldVersionError({ ...world, rulesetVersion: RULES.version + 1 });
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(WorldVersionError);
    const after = await store.withWorld(async (session) => ({
      snapshot: session.snapshot,
      action: await session.findAction(action.id),
    }));
    expect(after.snapshot.world).toEqual(world);
    expect(after.action).toBeNull();
  });
});

function oneHourLater(world: World): World {
  return { ...world, hour: world.hour + 1 };
}

function buy(units: number): Action {
  return { type: 'market.buy', houseId: 'brigue', good: 'wool', units };
}

function storedAction(id: string, hour: number, action: Action): StoredAction {
  return { id, houseId: 'brigue', playsAt: hour, action, receivedAt: new Date(START), cancelledAt: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
