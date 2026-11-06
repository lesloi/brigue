import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createWorld, RULES, WorldVersionError, type Action, type Event, type World } from '@brigue/core';

import { applyMigrations } from '../src/migrations.ts';
import { PgWorldStore } from '../src/pg-worlds.ts';
import { DuplicateActionError, UnknownWorldError, type StoredAction, type WorldSession } from '../src/worlds.ts';
import { TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const databaseUrl = process.env.DATABASE_URL ?? '';

// Skips as a whole when there is no database to talk to, so `pnpm test` stays
// green without DATABASE_URL.
describe.runIf(databaseUrl !== '')('PgWorldStore', () => {
  let pool: Pool;
  let store: PgWorldStore;
  const withWorld = <T>(run: (session: WorldSession) => Promise<T>) => store.withWorld(run, TEST_TOWN.id);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
    store = new PgWorldStore(pool);
  });

  afterEach(async () => {
    // Deleting the towns cascades their tables; the sealed seasons stay outside.
    await pool.query(
      `DELETE FROM towns;
       DELETE FROM town_names;
       DELETE FROM actions;
       DELETE FROM events;
       DELETE FROM seats;
       DELETE FROM laws;
       DELETE FROM engagements;
       DELETE FROM campaigns;
       DELETE FROM stock;
       DELETE FROM workshops;
       DELETE FROM people;
       DELETE FROM market_history;
       DELETE FROM market;
       DELETE FROM houses;
       DELETE FROM state;
       DELETE FROM archive_houses;
       DELETE FROM kings;`,
    );
  });

  afterAll(async () => {
    // The store owns no pool of its own; the test built this one and closes it.
    await pool.end();
  });

  it('keeps the first world when the same town is created twice', async () => {
    // Arrange
    const first = { ...createWorld(11), hour: 5 };
    const second = { ...createWorld(22), hour: 9 };
    const firstAt = new Date(START);
    const laterAt = new Date(START.getTime() + 60 * 60 * 1000);

    // Act
    await store.createTown(TEST_TOWN, first, firstAt);
    await store.createTown(TEST_TOWN, second, laterAt);
    const snapshot = await withWorld(async (session) => session.snapshot);

    // Assert
    expect(snapshot.world).toEqual(first);
    expect(snapshot.hourStartedAt).toEqual(firstAt);
  });

  it('refuses a world it does not hold', async () => {
    // Arrange

    // Act
    const attempt = store.withWorld(async () => null, 'nowhere');

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('serialises two writers on the row lock', async () => {
    // Arrange
    const startHour = 5;
    await store.createTown(TEST_TOWN, { ...createWorld(3), hour: startHour }, START);
    const order: string[] = [];
    let markFirstRunning = (): void => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });

    const first = withWorld(async (session) => {
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
    const second = withWorld(async (session) => {
      order.push('second:start');
      await session.save(oneHourLater(session.snapshot.world), START, []);
      order.push('second:end');
    });
    await Promise.all([first, second]);

    // Assert
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
    const world = await withWorld(async (session) => session.snapshot.world);
    // Two saves of +1 applied on top of each other: the second saw the first's
    // commit. A missing lock would leave both at startHour + 1.
    expect(world.hour).toBe(startHour + 2);
  });

  it('raises DuplicateActionError on a UUID it already stored', async () => {
    // Arrange
    await store.createTown(TEST_TOWN, createWorld(4), START);
    const action = storedAction(randomUUID(), 1, buy(2));
    await withWorld(async (session) => session.append(action));

    // Act
    const replay = withWorld(async (session) => session.append(action));

    // Assert
    await expect(replay).rejects.toBeInstanceOf(DuplicateActionError);
    const found = await withWorld(async (session) => session.findAction(action.id));
    expect(found).toEqual(action);
  });

  it('returns a hour actions in the order they were received', async () => {
    // Arrange: insert the lexically greater UUID first, so only `seq` can put
    // them back in insertion order. Ids are random per run because actions are
    // kept across runs on a developer's database.
    await store.createTown(TEST_TOWN, createWorld(5), START);
    const [lexicallyFirst, lexicallyLast] = [randomUUID(), randomUUID()].sort();
    const first = storedAction(lexicallyLast, 1, buy(1));
    const second = storedAction(lexicallyFirst, 1, buy(2));
    const otherHour = storedAction(randomUUID(), 2, buy(3));
    await withWorld(async (session) => {
      await session.append(first);
      await session.append(second);
      await session.append(otherHour);
    });

    // Act
    const queued = await withWorld(async (session) => session.actionsBetween(1, 1));

    // Assert
    expect(queued.map((action) => action.id)).toEqual([first.id, second.id]);
    expect(queued.map((action) => action.action)).toEqual([first.action, second.action]);
  });

  it('stops returning an action once it is cancelled, and keeps its row', async () => {
    // Arrange
    await store.createTown(TEST_TOWN, createWorld(6), START);
    const action = storedAction(randomUUID(), 1, buy(2));
    await withWorld(async (session) => {
      await session.append(action);
      await session.cancel(action.id, START);
    });

    // Act
    const queued = await withWorld(async (session) => session.actionsBetween(1, 1));
    const found = await withWorld(async (session) => session.findAction(action.id));

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
        houseId: 'leclerc',
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
        votes: { leclerc: 1, caron: 2 },
      },
      {
        type: 'workshop.idle',
        audience: { houseId: 'leclerc' },
        at: 7,
        houseId: 'leclerc',
        good: 'cloth',
        input: 'wool',
        missingUnits: 0,
      },
    ];
    const hourStartedAt = new Date(START.getTime() + 42_000);
    await store.createTown(TEST_TOWN, createWorld(1), START);

    // Act
    await withWorld(async (session) => {
      await session.save(world, hourStartedAt, events);
    });
    const read = await withWorld(async (session) => ({
      snapshot: session.snapshot,
      journal: await session.eventsSince(0, 50, 'leclerc'),
    }));

    // Assert
    expect(read.snapshot.world).toEqual(world);
    expect(read.snapshot.hourStartedAt).toEqual(hourStartedAt);
    expect(read.journal.events).toEqual(events);
    expect(read.journal.lastId).toBeGreaterThan(0);
    expect(read.journal.counts).toEqual({});
    expect(read.journal.refusals).toEqual({});
  });

  it('reads the newest page and counts the entries it leaves behind', async () => {
    // Arrange: four town events, one private to another house, read two at a
    // time for this house.
    const world = createWorld(3);
    await store.createTown(TEST_TOWN, world, START);
    const events: Event[] = [
      {
        type: 'market.bought',
        audience: 'town',
        at: 1,
        houseId: 'leclerc',
        good: 'wool',
        units: 1,
        priceCents: 380,
        totalCents: 380,
      },
      {
        type: 'action.refused',
        audience: { houseId: 'leclerc' },
        at: 2,
        houseId: 'leclerc',
        action: 'market.buy',
        reason: 'insufficient_funds',
      },
      {
        type: 'market.sold',
        audience: 'town',
        at: 3,
        houseId: 'caron',
        good: 'cloth',
        units: 2,
        priceCents: 1240,
        revenueCents: 2480,
      },
      {
        type: 'workshop.produced',
        audience: { houseId: 'leclerc' },
        at: 4,
        houseId: 'leclerc',
        good: 'cloth',
        units: 3,
      },
    ];

    // Act
    await withWorld(async (session) => {
      await session.save(world, START, events);
    });
    const page = await withWorld(async (session) => session.eventsSince(0, 2, 'leclerc'));

    // Assert: the last two entries, in time order, and the earlier two counted
    // — one of them a refusal, by reason.
    expect(page.events).toEqual(events.slice(2));
    expect(page.counts).toEqual({ 'market.bought': 1, 'action.refused': 1 });
    expect(page.refusals).toEqual({ insufficient_funds: 1 });
  });

  it('clears the town, its queue and its journal, and keeps players and the sealed seasons', async () => {
    // Arrange: a town with an action and an event, plus what lives outside it.
    const world = { ...createWorld(8), hour: 5 };
    await store.createTown(TEST_TOWN, world, START);
    await withWorld(async (session) => {
      await session.append(storedAction(randomUUID(), 5, buy(2)));
      await session.save(world, START, [
        {
          type: 'market.bought',
          audience: 'town',
          at: 5,
          houseId: 'leclerc',
          good: 'wool',
          units: 1,
          priceCents: 380,
          totalCents: 380,
        },
      ]);
    });
    const tokenHash = 'b'.repeat(64);
    await pool.query(`INSERT INTO players (token_hash, world_id, house_id) VALUES ($1, 'saint-aubin', 'leclerc')`, [
      tokenHash,
    ]);
    await pool.query(
      `INSERT INTO archive_houses (town_id, season, name, prestige, offices_held, title, generations, wealth_cents)
       VALUES ('saint-aubin', 1, 'Leclerc', 12, 3, 'roturier', 2, 5000)`,
    );
    await pool.query(
      `INSERT INTO kings (town_id, season, crowned_at, token_hash, house_name, person_name)
       VALUES ('saint-aubin', 1, 12, $1, 'Leclerc', 'Aubin')`,
      [tokenHash],
    );

    // Act
    await withWorld(async (session) => session.clear());

    // Assert: the town is gone whole, the people and the register stay.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const houses = await pool.query('SELECT count(*)::int AS count FROM houses');
    const events = await pool.query('SELECT count(*)::int AS count FROM events');
    const actions = await pool.query('SELECT count(*)::int AS count FROM actions');
    const players = await pool.query('SELECT count(*)::int AS count FROM players');
    const archive = await pool.query('SELECT count(*)::int AS count FROM archive_houses');
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(houses.rows[0]?.count).toBe(0);
    expect(events.rows[0]?.count).toBe(0);
    expect(actions.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(1);
    expect(archive.rows[0]?.count).toBe(1);
    expect(kings.rows[0]?.count).toBe(1);
    await expect(withWorld(async (session) => session.snapshot)).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('keeps two towns apart', async () => {
    // Arrange
    await store.createTown({ id: 'a', name: 'A' }, { ...createWorld(1), seed: 1 }, START);
    await store.createTown({ id: 'b', name: 'B' }, { ...createWorld(2), seed: 2 }, START);

    // Act
    const first = await store.withWorld(async (session) => session.snapshot, 'a');
    const second = await store.withWorld(async (session) => session.snapshot, 'b');
    const towns = await store.listTowns();

    // Assert: each town reads its own state and name.
    expect(first.town).toEqual({ id: 'a', name: 'A' });
    expect(second.town).toEqual({ id: 'b', name: 'B' });
    expect(first.world.seed).toBe(1);
    expect(second.world.seed).toBe(2);
    // Same size, so the older town comes first.
    expect(towns.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('serialises two joins on the advisory lock', async () => {
    // Arrange: the first join holds the lock long enough for the second to be
    // waiting on it if the lock were missing.
    const order: string[] = [];

    // Act
    await Promise.all([
      store.withJoinLock(async () => {
        order.push('first:start');
        await delay(150);
        order.push('first:end');
      }),
      store.withJoinLock(async () => {
        order.push('second');
      }),
    ]);

    // Assert
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('keeps a place name spent when its town is gone', async () => {
    // Arrange
    await store.createTown({ id: 'a', name: 'Amiens' }, createWorld(1), START);

    // Act
    await store.withWorld(async (session) => session.clear(), 'a');

    // Assert: the dead town's name is never drawn again.
    expect(await store.usedTownNames()).toContain('Amiens');
    expect(await store.listTowns()).toEqual([]);
  });

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four houses and a younger one of three.
    await store.createTown({ id: 'old', name: 'Old' }, town(9), START);
    await store.createTown({ id: 'new', name: 'New' }, createWorld(8), START);

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('rolls the world and the actions back when the callback throws', async () => {
    // Arrange
    const world = { ...createWorld(6), hour: 3 };
    await store.createTown(TEST_TOWN, world, START);
    const action = storedAction(randomUUID(), 3, buy(1));

    // Act: a catch-up that refuses the world version, after writing both tables.
    const attempt = withWorld(async (session) => {
      await session.append(action);
      await session.save(oneHourLater(session.snapshot.world), START, []);
      throw new WorldVersionError({ ...world, rulesetVersion: RULES.version + 1 });
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(WorldVersionError);
    const after = await withWorld(async (session) => ({
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
  return { type: 'market.buy', houseId: 'leclerc', good: 'wool', units };
}

function storedAction(id: string, hour: number, action: Action): StoredAction {
  return { id, houseId: 'leclerc', playsAt: hour, action, receivedAt: new Date(START), cancelledAt: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
