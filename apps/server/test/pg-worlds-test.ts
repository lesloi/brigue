import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

  async function clean(): Promise<void> {
    // The town cascades its tables; the accounts and the book live outside it.
    // Restarting the identity keeps every case on the same town id; the book is
    // deleted before the accounts it names, and both are scoped to this fixture
    // so the parallel account test keeps its own rows.
    await pool.query('DELETE FROM kings WHERE player_id IN (SELECT player_id FROM players WHERE town_id = $1)', [
      TEST_TOWN.id,
    ]);
    await pool.query('DELETE FROM players WHERE town_id = $1', [TEST_TOWN.id]);
    await pool.query('TRUNCATE towns RESTART IDENTITY CASCADE');
  }

  beforeEach(clean);
  afterEach(clean);

  afterAll(async () => {
    // The store owns no pool of its own; the test built this one and closes it.
    await pool.end();
  });

  it('creates a second town when called twice', async () => {
    // Arrange
    const first = { ...createWorld(11), hour: 5 };
    const second = { ...createWorld(22), hour: 9 };

    // Act
    const created = await store.createTown(TEST_TOWN.name, first, START);
    const again = await store.createTown(TEST_TOWN.name, second, START);

    // Assert: an id is assigned, and a second call is a second town.
    expect(created.id).toBe(TEST_TOWN.id);
    expect(again.id).not.toBe(created.id);
    expect(await store.listTowns()).toHaveLength(2);
  });

  it('refuses a world it does not hold', async () => {
    // Arrange

    // Act
    const attempt = store.withWorld(async () => null, 999_999);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('serialises two writers on the row lock', async () => {
    // Arrange
    const startHour = 5;
    await store.createTown(TEST_TOWN.name, { ...createWorld(3), hour: startHour }, START);
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
    await store.createTown(TEST_TOWN.name, createWorld(4), START);
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
    await store.createTown(TEST_TOWN.name, createWorld(5), START);
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
    await store.createTown(TEST_TOWN.name, createWorld(6), START);
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
    await store.createTown(TEST_TOWN.name, world, START);

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
    await store.createTown(TEST_TOWN.name, world, START);
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
    await store.createTown(TEST_TOWN.name, world, START);
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
    const { rows: playerRows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, town_id, house_id) VALUES ($1, $2, 'leclerc') RETURNING player_id`,
      [tokenHash, TEST_TOWN.id],
    );
    await pool.query(
      `INSERT INTO kings (player_id, house_name, person_name, crowned_at, elapsed_hours)
       VALUES ($1, 'Leclerc', 'Aubin', now(), 12)`,
      [Number(playerRows[0]?.player_id)],
    );

    // Act
    await withWorld(async (session) => session.clear());

    // Assert: the town is gone whole, the accounts and the book stay.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const houses = await pool.query('SELECT count(*)::int AS count FROM houses');
    const events = await pool.query('SELECT count(*)::int AS count FROM events');
    const actions = await pool.query('SELECT count(*)::int AS count FROM actions');
    const players = await pool.query('SELECT count(*)::int AS count FROM players WHERE town_id = $1', [TEST_TOWN.id]);
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(houses.rows[0]?.count).toBe(0);
    expect(events.rows[0]?.count).toBe(0);
    expect(actions.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(1);
    expect(kings.rows[0]?.count).toBe(1);
    await expect(withWorld(async (session) => session.snapshot)).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('keeps two towns apart', async () => {
    // Arrange
    const a = await store.createTown('A', { ...createWorld(1), seed: 1 }, START);
    const b = await store.createTown('B', { ...createWorld(2), seed: 2 }, START);

    // Act
    const first = await store.withWorld(async (session) => session.snapshot, a.id);
    const second = await store.withWorld(async (session) => session.snapshot, b.id);
    const towns = await store.listTowns();

    // Assert: each town reads its own state and name.
    expect(first.town).toEqual(a);
    expect(second.town).toEqual(b);
    expect(first.world.seed).toBe(1);
    expect(second.world.seed).toBe(2);
    // Same size, so the older town comes first.
    expect(towns.map((entry) => entry.id)).toEqual([a.id, b.id]);
  });

  it('serialises two joins on the advisory lock', async () => {
    // Arrange: the first join is inside the lock before the second starts, and
    // holds it long enough for the second to be waiting if the lock were
    // missing.
    const order: string[] = [];
    let entered = (): void => {};
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = store.withJoinLock(async () => {
      order.push('first:start');
      entered();
      await delay(150);
      order.push('first:end');
    });
    await inside;

    // Act
    const second = store.withJoinLock(async () => {
      order.push('second');
    });
    await Promise.all([first, second]);

    // Assert
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('gives a name that comes back a new id', async () => {
    // Arrange
    const first = await store.createTown('Amiens', createWorld(1), START);

    // Act
    await store.withWorld(async (session) => session.clear(), first.id);
    const second = await store.createTown('Amiens', createWorld(2), START);

    // Assert: the dead town's name may return, its id may not.
    expect(second.name).toBe('Amiens');
    expect(second.id).not.toBe(first.id);
  });

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four houses and a younger one of three.
    const old = await store.createTown('Old', town(9), START);
    const young = await store.createTown('New', createWorld(8), START);

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('drops the journal older than the cut and keeps the newest page', async () => {
    // Arrange: two pages and a bit of entries, one per hour.
    await store.createTown(TEST_TOWN.name, createWorld(4), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 120));
    });

    // Act: the cut alone would leave twelve entries; the page floor keeps the
    // newest fifty whatever their age.
    await store.pruneJournal(TEST_TOWN.id, 109);

    // Assert
    const page = await withWorld(async (session) => session.eventsSince(0, 100, 'leclerc'));
    const rows = await pool.query('SELECT count(*)::int AS count FROM events WHERE town_id = $1', [TEST_TOWN.id]);
    expect(page.events.map((event) => event.at)).toEqual(range(71, 120));
    expect(rows.rows[0]?.count).toBe(50);
  });

  it('keeps the entry exactly on the cut', async () => {
    // Arrange
    await store.createTown(TEST_TOWN.name, createWorld(5), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 120));
    });

    // Act: seventy-one entries are at or after the cut, so the page floor does
    // not decide the boundary.
    await store.pruneJournal(TEST_TOWN.id, 50);

    // Assert
    const rows = await pool.query<{ count: number; oldest: number }>(
      `SELECT count(*)::int AS count, min(at)::int AS oldest FROM events WHERE town_id = $1`,
      [TEST_TOWN.id],
    );
    expect(rows.rows[0]).toEqual({ count: 71, oldest: 50 });
  });

  it('deletes nothing from a journal shorter than a page', async () => {
    // Arrange: ten entries, all older than the cut.
    await store.createTown(TEST_TOWN.name, createWorld(6), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 10));
    });

    // Act: there is no newer page to protect the entries with, so only the
    // floor keeps them.
    await store.pruneJournal(TEST_TOWN.id, 1_000);

    // Assert
    const rows = await pool.query('SELECT count(*)::int AS count FROM events WHERE town_id = $1', [TEST_TOWN.id]);
    expect(rows.rows[0]?.count).toBe(10);
  });

  it('rolls the world and the actions back when the callback throws', async () => {
    // Arrange
    const world = { ...createWorld(6), hour: 3 };
    await store.createTown(TEST_TOWN.name, world, START);
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

function storedAction(id: string, hour: number, action: Action): StoredAction {
  return { id, houseId: 'leclerc', playsAt: hour, action, receivedAt: new Date(START), cancelledAt: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
