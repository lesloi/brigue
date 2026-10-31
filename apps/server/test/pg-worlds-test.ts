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
    const first = { ...createWorld(11), week: 5 };
    const second = { ...createWorld(22), week: 9 };
    const firstAt = new Date(START);
    const laterAt = new Date(START.getTime() + 60 * 60 * 1000);

    // Act
    await store.createIfAbsent(id, first, firstAt, firstAt);
    await store.createIfAbsent(id, second, laterAt, laterAt);
    const snapshot = await store.withWorld(id, async (session) => session.snapshot);

    // Assert
    expect(snapshot.world).toEqual(first);
    expect(snapshot.weekStartedAt).toEqual(firstAt);
    expect(snapshot.lastEvents).toEqual([]);
  });

  it('refuses a world it does not hold', async () => {
    // Arrange
    const id = newWorldId();

    // Act
    const attempt = store.withWorld(id, async () => null);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('serialises two writers on the row lock', async () => {
    // Arrange
    const id = newWorldId();
    const startWeek = 5;
    await store.createIfAbsent(id, { ...createWorld(3), week: startWeek }, START, START);
    const order: string[] = [];
    let markFirstRunning = (): void => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });

    const first = store.withWorld(id, async (session) => {
      order.push('first:start');
      markFirstRunning();
      // Holds the lock long enough for a second writer to barge in if the lock
      // were missing. This delay is load-bearing: without it a broken lock
      // would go unnoticed most of the time.
      await delay(150);
      await session.save(oneWeekLater(session.snapshot.world), START, [], START);
      order.push('first:end');
    });

    // Act: the second writer starts only once the first one holds the lock.
    await firstEntered;
    const second = store.withWorld(id, async (session) => {
      order.push('second:start');
      await session.save(oneWeekLater(session.snapshot.world), START, [], START);
      order.push('second:end');
    });
    await Promise.all([first, second]);

    // Assert
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    const world = await store.withWorld(id, async (session) => session.snapshot.world);
    // Two saves of +1 applied on top of each other: the second saw the first's
    // commit. A missing lock would leave both at startWeek + 1.
    expect(world.week).toBe(startWeek + 2);
  });

  it('raises DuplicateActionError on a UUID it already stored', async () => {
    // Arrange
    const id = newWorldId();
    await store.createIfAbsent(id, createWorld(4), START, START);
    const action = storedAction(randomUUID(), 1, buy(2));
    await store.withWorld(id, async (session) => session.append(action));

    // Act
    const replay = store.withWorld(id, async (session) => session.append(action));

    // Assert
    await expect(replay).rejects.toBeInstanceOf(DuplicateActionError);
    const found = await store.withWorld(id, async (session) => session.findAction(action.id));
    expect(found).toEqual(action);
  });

  it('returns a week actions in the order they were received', async () => {
    // Arrange: insert the lexically greater UUID first, so only `seq` can put
    // them back in insertion order. Ids are random per run because actions are
    // kept across runs on a developer's database.
    const id = newWorldId();
    await store.createIfAbsent(id, createWorld(5), START, START);
    const [lexicallyFirst, lexicallyLast] = [randomUUID(), randomUUID()].sort();
    const first = storedAction(lexicallyLast, 1, buy(1));
    const second = storedAction(lexicallyFirst, 1, buy(2));
    const otherWeek = storedAction(randomUUID(), 2, buy(3));
    await store.withWorld(id, async (session) => {
      await session.append(first);
      await session.append(second);
      await session.append(otherWeek);
    });

    // Act
    const week = await store.withWorld(id, async (session) => session.actionsFor(1));

    // Assert
    expect(week.map((action) => action.id)).toEqual([first.id, second.id]);
    expect(week.map((action) => action.action)).toEqual([first.action, second.action]);
  });

  it('round-trips the world, the last events and an action through jsonb', async () => {
    // Arrange
    const id = newWorldId();
    const world: World = {
      ...createWorld(2_147_483_646),
      week: 7,
      rng: 1_234_567_890,
      market: { cloth: 1301, wool: 377, grain: 259 },
    };
    // Heterogeneous events: `last_events` is a JS array, which `pg` used to
    // serialise as a Postgres array literal instead of jsonb.
    const lastEvents: Event[] = [
      { type: 'market.bought', houseId: 'brigue', good: 'wool', units: 2, priceCents: 380, totalCents: 760 },
      { type: 'council.election_held', seatId: 'maire', winnerHouseId: 'caron', votes: { brigue: 1, caron: 2 } },
      { type: 'workshop.idle', houseId: 'brigue', good: 'cloth', input: 'wool', missingUnits: 0 },
    ];
    const weekStartedAt = new Date(START.getTime() + 42_000);
    const action = storedAction(randomUUID(), 7, buy(3));
    await store.createIfAbsent(id, createWorld(1), START, START);

    // Act
    await store.withWorld(id, async (session) => {
      await session.append(action);
      await session.save(world, weekStartedAt, lastEvents, new Date(START.getTime() + 60_000));
    });
    const read = await store.withWorld(id, async (session) => ({
      snapshot: session.snapshot,
      action: await session.findAction(action.id),
    }));

    // Assert
    expect(read.snapshot.world).toEqual(world);
    expect(read.snapshot.lastEvents).toEqual(lastEvents);
    expect(read.snapshot.weekStartedAt).toEqual(weekStartedAt);
    expect(read.action).toEqual(action);
  });

  it('rolls the world and the actions back when the callback throws', async () => {
    // Arrange
    const id = newWorldId();
    const world = { ...createWorld(6), week: 3 };
    await store.createIfAbsent(id, world, START, START);
    const action = storedAction(randomUUID(), 3, buy(1));

    // Act: a catch-up that refuses the world version, after writing both tables.
    const attempt = store.withWorld(id, async (session) => {
      await session.append(action);
      await session.save(oneWeekLater(session.snapshot.world), START, [], START);
      throw new WorldVersionError({ ...world, rulesetVersion: RULES.version + 1 });
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(WorldVersionError);
    const after = await store.withWorld(id, async (session) => ({
      snapshot: session.snapshot,
      action: await session.findAction(action.id),
    }));
    expect(after.snapshot.world).toEqual(world);
    expect(after.snapshot.lastEvents).toEqual([]);
    expect(after.action).toBeNull();
  });
});

function oneWeekLater(world: World): World {
  return { ...world, week: world.week + 1 };
}

function buy(units: number): Action {
  return { type: 'market.buy', houseId: 'brigue', good: 'wool', units };
}

function storedAction(id: string, week: number, action: Action): StoredAction {
  return { id, houseId: 'brigue', week, action, receivedAt: new Date(START) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
