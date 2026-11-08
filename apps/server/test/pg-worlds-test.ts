import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createWorld,
  RULES,
  sortWorkshops,
  WorldVersionError,
  type Action,
  type Event,
  type World,
} from '@brigue/core';

import { applySchema } from '../src/db/migrations.ts';
import { PgWorldStore } from '../src/town/pg-worlds.ts';
import {
  DuplicateActionError,
  NameInUseError,
  UnknownWorldError,
  type StoredAction,
  type WorldSession,
} from '../src/town/worlds.ts';
import { TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const databaseUrl = process.env.DATABASE_URL ?? '';

// The only token this file writes: `clear()` orphans its account, so the
// fixture cleans it by token and never by the town it no longer names.
const CLEARED_TOKEN = 'e'.repeat(64);

// Skips as a whole when there is no database to talk to, so `pnpm test` stays
// green without DATABASE_URL.
describe.runIf(databaseUrl !== '')('PgWorldStore', () => {
  let pool: Pool;
  let store: PgWorldStore;
  const withWorld = <T>(run: (session: WorldSession) => Promise<T>) => store.withWorld(run, TEST_TOWN.id);

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applySchema(pool);
    store = new PgWorldStore(pool);
  });

  async function clean(): Promise<void> {
    // The town cascades its tables; the accounts and the book live outside it.
    // Restarting the identity keeps every case on the same town id; the book is
    // deleted before the accounts it names, and both are scoped to this fixture
    // so the parallel account test keeps its own rows.
    await pool.query(
      `DELETE FROM kings
       WHERE player_id IN (
         SELECT p.player_id FROM players p
         JOIN dynasties d ON d.id = p.dynasty_id
         WHERE d.town_id = $1
       )`,
      [TEST_TOWN.id],
    );
    await pool.query(`DELETE FROM players p USING dynasties d WHERE d.id = p.dynasty_id AND d.town_id = $1`, [
      TEST_TOWN.id,
    ]);
    // An account whose town was cleared names no dynasty any more, so the join
    // above cannot reach it, nor the king it named; its token is what scopes it.
    await pool.query('DELETE FROM kings WHERE player_id IN (SELECT player_id FROM players WHERE token_hash = $1)', [
      CLEARED_TOKEN,
    ]);
    await pool.query('DELETE FROM players WHERE token_hash = $1', [CLEARED_TOKEN]);
    // The mail has no town column, so the cascade does not reach it.
    await pool.query('TRUNCATE messages RESTART IDENTITY');
    await pool.query('TRUNCATE towns RESTART IDENTITY CASCADE');
  }

  beforeEach(clean);
  afterEach(clean);

  afterAll(async () => {
    // The store owns no pool of its own; the test built this one and closes it.
    await pool.end();
  });

  it('refuses a second live town with the same name', async () => {
    // Arrange
    const first = { ...createWorld(11), hour: 5 };
    const second = { ...createWorld(22), hour: 9 };

    // Act
    const created = await store.createTown(TEST_TOWN.name, first, START);
    const again = store.createTown(TEST_TOWN.name, second, START);

    // Assert: an id is assigned, and a name names one live town.
    expect(created.id).toBe(TEST_TOWN.id);
    await expect(again).rejects.toBeInstanceOf(NameInUseError);
    expect(await store.listTowns()).toHaveLength(1);
  });

  it('reads workshops back in the order the world hashes them', async () => {
    // Arrange: ids whose byte order is not their creation order, since the row
    // no longer carries a position.
    await store.createTown(TEST_TOWN.name, createWorld(31), START);
    await withWorld(async (session) => {
      const world = session.snapshot.world;
      world.dynasties.caron.workshops = [
        { id: 'workshop-9', good: 'cloth', level: 1 },
        { id: 'workshop-10', good: 'cloth', level: 1 },
      ];
      sortWorkshops(world.dynasties.caron);
      await session.save(world, START, []);
    });

    // Act
    const world = await withWorld(async (session) => session.snapshot.world);

    // Assert: the canonical order, the one the array is hashed in.
    expect(world.dynasties.caron.workshops.map((workshop) => workshop.id)).toEqual(['workshop-10', 'workshop-9']);
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

  it('writes each line to its own page and reads both back', async () => {
    // Arrange: one public chronicle line and one message of the weaver.
    const world: World = {
      ...town(2_147_483_646),
      hour: 7,
      rng: 1_234_567_890,
      market: { cloth: 1301, wool: 377, grain: 259, bread: 521, wood: 301, planks: 979 },
    };
    const chronicle: Event = {
      type: 'council.election_held',
      audience: 'town',
      at: 7,
      seatId: 'maire',
      winnerDynastyId: 'caron',
      votes: { leclerc: 1, caron: 2 },
    };
    const mail: Event = {
      type: 'workshop.built',
      audience: { dynastyId: 'leclerc' },
      at: 7,
      dynastyId: 'leclerc',
      workshopId: 'workshop-2',
      trade: 'baker',
    };
    const hourStartedAt = new Date(START.getTime() + 42_000);
    await store.createTown(TEST_TOWN.name, world, START);

    // Act
    await withWorld(async (session) => {
      await session.save(world, hourStartedAt, [chronicle, mail]);
    });
    const read = await withWorld(async (session) => ({
      snapshot: session.snapshot,
      chronicle: await session.recentChronicle(50),
      mail: await session.recentMessages(50, 'leclerc'),
    }));

    // Assert: the town sees the election, the weaver sees the workshop, and no
    // page carries the other's line.
    expect(read.snapshot.world).toEqual(world);
    expect(read.snapshot.hourStartedAt).toEqual(hourStartedAt);
    expect(read.chronicle).toEqual([chronicle]);
    // A message keeps no town hour: it comes back with `at` at zero.
    expect(read.mail.messages).toEqual([{ id: 1, read: false, event: { ...mail, at: 0 } }]);
    expect(read.mail.unread).toBe(1);
  });

  it('reads the newest page of a mailbox in time order, leaving the older lines behind', async () => {
    // Arrange: four private lines for the weaver, read two at a time.
    const world = town(3);
    await store.createTown(TEST_TOWN.name, world, START);
    const mail: Event[] = [1, 2, 3, 4].map((at) => ({
      type: 'dynasty.debt_repaid',
      audience: { dynastyId: 'leclerc' },
      at,
      dynastyId: 'leclerc',
      amountCents: at * 120,
    }));

    // Act
    await withWorld(async (session) => {
      await session.save(world, START, mail);
    });
    const page = await withWorld(async (session) => session.recentMessages(2, 'leclerc'));

    // Assert: the last two entries, in time order, and the badge counts the page.
    expect(
      page.messages.map((message) => (message.event.type === 'dynasty.debt_repaid' ? message.event.amountCents : -1)),
    ).toEqual([360, 480]);
    expect(page.unread).toBe(2);
  });

  it('clears the town, its queue and its journal, and keeps players and the sealed seasons', async () => {
    // Arrange: a town with an action, a chronicle line and a message, plus what
    // lives outside it.
    const world = { ...town(8), hour: 5 };
    await store.createTown(TEST_TOWN.name, world, START);
    await withWorld(async (session) => {
      await session.append(storedAction(randomUUID(), 5, buy(2)));
      await session.save(world, START, [
        {
          type: 'council.election_held',
          audience: 'town',
          at: 5,
          seatId: 'maire',
          winnerDynastyId: null,
          votes: {},
        },
        {
          type: 'dynasty.debt_repaid',
          audience: { dynastyId: 'leclerc' },
          at: 5,
          dynastyId: 'leclerc',
          amountCents: 120,
        },
      ]);
    });
    const tokenHash = CLEARED_TOKEN;
    const { rows: playerRows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, dynasty_id) VALUES ($1, 'leclerc') RETURNING player_id`,
      [tokenHash],
    );
    await pool.query(
      `INSERT INTO kings (player_id, dynasty_name, person_name, crowned_at, elapsed_hours)
       VALUES ($1, 'Leclerc', 'Aubin', now(), 12)`,
      [Number(playerRows[0]?.player_id)],
    );

    // Act
    await withWorld(async (session) => session.clear());

    // Assert: the town is gone whole, the accounts and the book stay.
    const state = await pool.query('SELECT count(*)::int AS count FROM state');
    const dynasties = await pool.query('SELECT count(*)::int AS count FROM dynasties');
    const events = await pool.query('SELECT count(*)::int AS count FROM events');
    const messages = await pool.query('SELECT count(*)::int AS count FROM messages');
    const actions = await pool.query('SELECT count(*)::int AS count FROM actions');
    // The account survives the cleared town; the town it named does not, so it
    // is found by its token and not by a join.
    const players = await pool.query('SELECT count(*)::int AS count FROM players WHERE token_hash = $1', [tokenHash]);
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');

    expect(state.rows[0]?.count).toBe(0);
    expect(dynasties.rows[0]?.count).toBe(0);
    expect(events.rows[0]?.count).toBe(0);
    expect(messages.rows[0]?.count).toBe(0);
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
    // Arrange: an older town of four dynasties and a younger one of three.
    const old = await store.createTown('Old', town(9), START);
    const young = await store.createTown('New', createWorld(8), START);

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('drops the journal written before the real-time cut', async () => {
    // Arrange: 120 entries, the first 49 written a day before the cut.
    await store.createTown(TEST_TOWN.name, createWorld(4), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 120));
    });
    const cut = new Date('2000-01-08T00:00:00.000Z');
    await pool.query(`UPDATE events SET recorded_at = $2 WHERE town_id = $1 AND at < 50`, [
      TEST_TOWN.id,
      new Date('2000-01-01T00:00:00.000Z'),
    ]);

    // Act
    await store.pruneJournal(TEST_TOWN.id, cut, new Date('2000-01-01T00:00:00.000Z'));

    // Assert: the town hour plays no part; the write instant decides.
    const page = await withWorld(async (session) => session.recentChronicle(120));
    const rows = await pool.query('SELECT count(*)::int AS count FROM events WHERE town_id = $1', [TEST_TOWN.id]);
    expect(page.map((event) => event.at)).toEqual(range(50, 120));
    expect(rows.rows[0]?.count).toBe(71);
  });

  it('keeps the entry written exactly on the cut', async () => {
    // Arrange
    await store.createTown(TEST_TOWN.name, createWorld(5), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 120));
    });
    const cut = new Date('2026-11-07T00:00:00.000Z');
    await pool.query(`UPDATE events SET recorded_at = $2 WHERE town_id = $1`, [TEST_TOWN.id, cut]);

    // Act
    await store.pruneJournal(TEST_TOWN.id, cut, new Date('2000-01-01T00:00:00.000Z'));

    // Assert
    const rows = await pool.query('SELECT count(*)::int AS count FROM events WHERE town_id = $1', [TEST_TOWN.id]);
    expect(rows.rows[0]?.count).toBe(120);
  });

  it('leaves no page behind when the whole journal predates the cut', async () => {
    // Arrange: ten entries, all written before the cut.
    await store.createTown(TEST_TOWN.name, createWorld(6), START);
    await withWorld(async (session) => {
      await session.save(session.snapshot.world, START, hours(1, 10));
    });
    const cut = new Date('2000-01-08T00:00:00.000Z');
    await pool.query(`UPDATE events SET recorded_at = $2 WHERE town_id = $1`, [
      TEST_TOWN.id,
      new Date('2000-01-01T00:00:00.000Z'),
    ]);

    // Act: there is no page floor and no town-hour exception.
    await store.pruneJournal(TEST_TOWN.id, cut, new Date('2000-01-01T00:00:00.000Z'));

    // Assert
    const rows = await pool.query('SELECT count(*)::int AS count FROM events WHERE town_id = $1', [TEST_TOWN.id]);
    expect(rows.rows[0]?.count).toBe(0);
  });

  it('prunes the mail on its own cut, which outlives the chronicle', async () => {
    // Arrange: 120 messages, the first 49 written a day before the mail cut.
    await store.createTown(TEST_TOWN.name, town(4), START);
    await withWorld(async (session) => {
      await session.save(
        session.snapshot.world,
        START,
        Array.from({ length: 120 }, (_, index): Event => ({
          type: 'dynasty.debt_repaid',
          audience: { dynastyId: 'leclerc' },
          at: index + 1,
          dynastyId: 'leclerc',
          amountCents: index + 1,
        })),
      );
    });
    await pool.query(`UPDATE messages SET recorded_at = $1 WHERE id < 50`, [new Date('2000-01-01T00:00:00.000Z')]);

    // Act: the mail cut is a day after the first batch, the chronicle cut later.
    await store.pruneJournal(TEST_TOWN.id, new Date('2010-01-08T00:00:00.000Z'), new Date('2000-01-08T00:00:00.000Z'));

    // Assert: the mail keeps the 71 recent lines, whatever the chronicle cut says.
    const page = await withWorld(async (session) => session.recentMessages(120, 'leclerc'));
    expect(
      page.messages.map((message) => (message.event.type === 'dynasty.debt_repaid' ? message.event.amountCents : -1)),
    ).toEqual(range(50, 120));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(rows.rows[0]?.count).toBe(71);
  });

  it('marks one message read without locking the town, and only its own', async () => {
    // Arrange: three unread messages for the weaver.
    await store.createTown(TEST_TOWN.name, town(5), START);
    await withWorld(async (session) => {
      await session.save(
        session.snapshot.world,
        START,
        Array.from({ length: 3 }, (_, index): Event => ({
          type: 'dynasty.debt_repaid',
          audience: { dynastyId: 'leclerc' },
          at: index + 1,
          dynastyId: 'leclerc',
          amountCents: 120,
        })),
      );
    });
    const before = await withWorld(async (session) => session.recentMessages(50, 'leclerc'));
    const target = before.messages[0];
    expect(target).toBeDefined();
    expect(before.unread).toBe(3);

    // Act: another dynasty names the id, then the owner does.
    const foreign = await store.markMessageRead(target?.id ?? 0, 'caron');
    const own = await store.markMessageRead(target?.id ?? 0, 'leclerc');

    // Assert: the foreign call reads nothing, the owner's line only.
    expect(foreign).toEqual({ read: false, unread: 0 });
    expect(own).toEqual({ read: true, unread: 2 });
    const after = await withWorld(async (session) => session.recentMessages(50, 'leclerc'));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(after.unread).toBe(2);
    expect(after.messages).toHaveLength(3);
    expect(after.messages.filter((message) => message.read)).toHaveLength(1);
    expect(rows.rows[0]?.count).toBe(3);
  });

  it('deletes one message and only its own', async () => {
    // Arrange: two messages for the weaver.
    await store.createTown(TEST_TOWN.name, town(5), START);
    await withWorld(async (session) => {
      await session.save(
        session.snapshot.world,
        START,
        [1, 2].map((at): Event => ({
          type: 'dynasty.debt_repaid',
          audience: { dynastyId: 'leclerc' },
          at,
          dynastyId: 'leclerc',
          amountCents: at * 120,
        })),
      );
    });
    const page = await withWorld(async (session) => session.recentMessages(50, 'leclerc'));
    const target = page.messages[0];
    expect(target).toBeDefined();

    // Act: another dynasty names the id, then the owner does.
    const foreign = await store.deleteMessage(target?.id ?? 0, 'caron');
    const own = await store.deleteMessage(target?.id ?? 0, 'leclerc');

    // Assert: the foreign call is a no-op (and answers the foreigner's own
    // badge, which is empty); the owner's removes the row.
    expect(foreign).toEqual({ deleted: false, unread: 0 });
    expect(own).toEqual({ deleted: true, unread: 1 });
    const after = await withWorld(async (session) => session.recentMessages(50, 'leclerc'));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(after.messages).toHaveLength(1);
    expect(after.unread).toBe(1);
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('writes prose and notices into the box', async () => {
    // Arrange: a notice already lives in the box, and a letter would next to it.
    await store.createTown(TEST_TOWN.name, town(5), START);
    const insert = (columns: string, values: unknown[] = []) =>
      pool.query(
        `INSERT INTO messages (dynasty_id${columns}) VALUES ($1${values.map((_, index) => `, $${index + 2}`).join('')})`,
        ['leclerc', ...values],
      );

    // Act and assert: prose carries a body and may name its author, a notice
    // carries its type and its payload. The table holds both shapes and refuses
    // neither: the writer is what keeps them apart.
    await expect(insert(', body, author_dynasty_id', ['Bonjour', 'dynasty-writer'])).resolves.toBeDefined();
    await expect(insert(', type, payload', ['title_open', '{}'])).resolves.toBeDefined();
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
  return { type: 'market.buy', dynastyId: 'leclerc', good: 'wool', units };
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

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function storedAction(id: string, hour: number, action: Action): StoredAction {
  return { id, dynastyId: 'leclerc', playsAt: hour, action, receivedAt: new Date(START), cancelledAt: null };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
