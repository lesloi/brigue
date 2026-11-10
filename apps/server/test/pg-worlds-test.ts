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
import { PgWorldStore, TOWN_TABLES } from '../src/town/pg-worlds.ts';
import {
  HOUR_MS,
  NameInUseError,
  UnknownWorldError,
  hourStartedOf,
  type NewStoredAction,
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
  const hourOf = (townId: number) => store.withWorld(async (session) => session.snapshot.world.hour, townId);

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
    await pool.query('DELETE FROM kings');
    await pool.query('DELETE FROM players WHERE token_hash = ANY($1)', [[CLEARED_TOKEN, 'a'.repeat(64)]]);
    // The mail has no town column, so the cascade does not reach it.
    await pool.query('TRUNCATE messages RESTART IDENTITY');
    // The settings belong to the world, not the town: truncating the towns does
    // not take them, and a stale seed would leak into the next case.
    await pool.query('TRUNCATE settings');
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
    const first = { ...createWorld(), hour: 5 };
    const second = { ...createWorld(), hour: 9 };

    // Act
    const created = await store.createTown(TEST_TOWN.name, first, START);
    const again = store.createTown(TEST_TOWN.name, second, START);

    // Assert: an id is assigned, and a name names one live town.
    expect(created.id).toBe(TEST_TOWN.id);
    await expect(again).rejects.toBeInstanceOf(NameInUseError);
    expect(await store.listTowns()).toHaveLength(1);
  });

  it('reads workshops back in the order the world hashes them', async () => {
    // Arrange: the world mints provisional ids, and the database names them.
    const world = createWorld();
    await store.createTown(TEST_TOWN.name, world, START);
    await withWorld(async (session) => {
      const loaded = session.snapshot.world;
      const ai = Object.values(loaded.people).find((person) => person.ia)!;
      ai.workshops = [
        { id: 9, trade: 'weaver', level: 1 },
        { id: 10, trade: 'weaver', level: 1 },
      ];
      sortWorkshops(ai);
      await session.write(loaded, []);
    });

    // Act
    const read = await withWorld(async (session) => session.snapshot.world);

    // Assert: the canonical order, the one the array is hashed in.
    const ai = Object.values(read.people).find((person) => person.ia)!;
    const ids = ai.workshops.map((workshop) => workshop.id);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(new Set(ids).size).toBe(2);
  });

  it('writes and clears every town table', async () => {
    // Arrange: every table a town owns, directly or through its people.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT DISTINCT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('town_id', 'person_id')`,
    );
    // The town row, the append-only queue and journal are outside the snapshot
    // the writer replaces; the world's settings carry neither column.
    const outside = new Set(['towns', 'events', 'actions']);

    // Act
    const written = TOWN_TABLES.map((entry) => entry.table).sort();

    // Assert: a table added to the schema cannot be forgotten by the writer.
    expect(
      rows
        .map((row) => row.table_name)
        .filter((name) => !outside.has(name))
        .sort(),
    ).toEqual(written);
  });

  it('refuses a world it does not hold', async () => {
    // Arrange

    // Act
    const attempt = store.withWorld(async () => null, 999_999);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('serialises two writers of one town on its row', async () => {
    // Arrange: a town, and a first writer that holds its row while a second
    // waits for it — the pass-versus-visit race the design names.
    await store.createTown(TEST_TOWN.name, createWorld(), START);
    const order: string[] = [];
    let markFirstRunning = (): void => {};
    const firstEntered = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });

    const first = withWorld(async (session) => {
      order.push('first:start');
      markFirstRunning();
      // Load-bearing: without the delay, a broken lock would go unnoticed.
      await delay(150);
      await session.write({ ...session.snapshot.world, hour: 5 }, []);
      order.push('first:end');
    });
    await firstEntered;

    // Act: the second writer starts while the first still holds the row.
    const second = withWorld(async (session) => {
      order.push('second:start');
      order.push(`second:saw:${session.snapshot.world.hour}`);
      order.push('second:end');
    });
    await Promise.all([first, second]);

    // Assert: the second waited, and read the watermark the first committed.
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:saw:5', 'second:end']);
  });

  it('keeps each town its own watermark', async () => {
    // Arrange: two towns founded together.
    const first = await store.createTown('First', createWorld(), START);
    const second = await store.createTown('Second', createWorld(), START);

    // Act: only the first one is played, five hours ahead.
    await store.withWorld(async (session) => {
      await session.write({ ...session.snapshot.world, hour: 6 }, []);
    }, first.id);

    // Assert: the second still owes the hours the first played.
    expect(await hourOf(first.id)).toBe(6);
    expect(await hourOf(second.id)).toBe(1);
  });

  it('moves a town watermark forward only', async () => {
    // Arrange
    await store.createTown(TEST_TOWN.name, createWorld(), START);
    await withWorld(async (session) => {
      await session.write({ ...session.snapshot.world, hour: 5 }, []);
    });

    // Act: a write of an older world must not put the town back.
    await withWorld(async (session) => {
      await session.write({ ...session.snapshot.world, hour: 2 }, []);
    });

    // Assert
    expect(await hourOf(TEST_TOWN.id)).toBe(5);
  });

  it('gives each action its own id, in the order it arrived', async () => {
    // Arrange
    const world = town(4);
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;

    // Act
    const first = await withWorld(async (session) => session.append(storedAction(personId, 1, buy(personId, 2))));
    const second = await withWorld(async (session) => session.append(storedAction(personId, 1, buy(personId, 3))));

    // Assert
    expect(second.id).toBe(first.id + 1);
    expect(await withWorld(async (session) => session.findAction(first.id))).toEqual(first);
  });

  it('returns a hour actions in the order they were received', async () => {
    // Arrange: the row id is the arrival order, so two of the same hour keep it.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;
    const first = await withWorld(async (session) => session.append(storedAction(personId, 1, buy(personId, 1))));
    const second = await withWorld(async (session) => session.append(storedAction(personId, 1, buy(personId, 2))));
    await withWorld(async (session) => session.append(storedAction(personId, 2, buy(personId, 3))));

    // Act
    const queued = await withWorld(async (session) => session.actionsBetween(1, 1));

    // Assert
    expect(queued.map((action) => action.id)).toEqual([first.id, second.id]);
    expect(queued.map((action) => action.action)).toEqual([first.action, second.action]);
  });

  it('stores an action at the instant its hour begins', async () => {
    // Arrange: an order for the third hour of the world.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;

    // Act
    const action = await withWorld(async (session) => session.append(storedAction(personId, 3, buy(personId, 1))));
    const row = await pool.query<{ plays_at: Date }>('SELECT plays_at FROM actions WHERE id = $1', [action.id]);

    // Assert: the row holds the instant, so a pass reads what is due in one
    // comparison, and the store gives the hour back.
    expect(row.rows[0]?.plays_at).toEqual(hourStartedOf(START, 3));
    expect(action.playsAt).toBe(3);
  });

  it('moves the stored instants with the clock, so an hour keeps its hour', async () => {
    // Arrange: an order and a chronicle line, both written for the third hour.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;
    const action = await withWorld(async (session) => session.append(storedAction(personId, 3, buy(personId, 1))));
    await withWorld(async (session) => session.write(world, [priceAt(3)]));
    const before = await hourOf(TEST_TOWN.id);

    // Act: the clock jumps two hours, as the development route does.
    await store.moveWorldClockBack(2);

    // Assert: the town's own hour stays — it now owes two more hours — and
    // neither row moved an hour. Left in place, each instant would decode two
    // hours later and the order would play late.
    expect(await hourOf(TEST_TOWN.id)).toBe(before);
    expect((await store.readClock())?.worldStartedAt).toEqual(new Date(START.getTime() - 2 * HOUR_MS));
    expect((await withWorld(async (session) => session.findAction(action.id)))?.playsAt).toBe(3);
    expect((await withWorld(async (session) => session.recentChronicle(1)))[0]?.at).toBe(3);
  });

  it('erases a cancelled action', async () => {
    // Arrange
    const world = town(6);
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;
    const action = await withWorld(async (session) => session.append(storedAction(personId, 1, buy(personId, 2))));
    await withWorld(async (session) => session.cancel(action.id));

    // Act
    const queued = await withWorld(async (session) => session.actionsBetween(1, 1));
    const found = await withWorld(async (session) => session.findAction(action.id));

    // Assert
    expect(queued).toEqual([]);
    expect(found).toBeNull();
  });

  it('writes each line to its own page and reads both back', async () => {
    // Arrange: one public chronicle line and one message of the weaver.
    const world: World = {
      ...town(2_147_483_646),
      hour: 7,
      market: { cloth: 1301, wool: 377, grain: 259, bread: 521, wood: 301, planks: 979 },
    };
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const ai = Object.values(world.people).find((person) => person.ia)!;
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    const chronicle: Event = {
      type: 'council.election_held',
      audience: 'town',
      at: 7,
      seatId: 'maire',
      winnerPersonId: ai.id,
      votes: { [human.id]: 1, [ai.id]: 2 },
    };
    const mail: Event = {
      type: 'workshop.built',
      audience: { personId: human.id },
      at: 7,
      personId: human.id,
      workshopId: 4,
      trade: 'baker',
    };
    // Act
    await withWorld(async (session) => {
      await session.write(world, [chronicle, mail]);
    });
    const read = await withWorld(async (session) => ({
      snapshot: session.snapshot,
      chronicle: await session.recentChronicle(50),
      mail: await session.recentMessages(50, playerId),
    }));

    // Assert: the town sees the election, the weaver sees the workshop, and no
    // page carries the other's line.
    expect(read.snapshot.world).toEqual(world);
    // The hour is the world's, counted from its founding instant.
    expect(read.snapshot.worldStartedAt).toEqual(START);
    expect(read.chronicle).toEqual([chronicle]);
    // A message keeps no town hour: it comes back with `at` at zero.
    expect(read.mail.messages).toEqual([{ id: 1, read: false, event: { ...mail, at: 0, audience: { personId: 0 } } }]);
    expect(read.mail.unread).toBe(1);
  });

  it('reads the newest page of a mailbox in time order, leaving the older lines behind', async () => {
    // Arrange: four private lines for the weaver, read two at a time.
    const world = town(3);
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    const mail: Event[] = [1, 2, 3, 4].map((at) => ({
      type: 'person.debt_repaid',
      audience: { personId: human.id },
      at,
      personId: human.id,
      amountCents: at * 120,
    }));

    // Act
    await withWorld(async (session) => {
      await session.write(world, mail);
    });
    const page = await withWorld(async (session) => session.recentMessages(2, playerId));

    // Assert: the last two entries, in time order, and the badge counts the page.
    expect(
      page.messages.map((message) => (message.event.type === 'person.debt_repaid' ? message.event.amountCents : -1)),
    ).toEqual([360, 480]);
    expect(page.unread).toBe(2);
  });

  it('clears the town, its queue and its journal, and keeps players and the sealed seasons', async () => {
    // Arrange: a town with an action, a chronicle line and a message, plus what
    // lives outside it.
    const world = { ...town(8), hour: 5 };
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    await bindAccount(TEST_TOWN.id, human.id, CLEARED_TOKEN);
    await withWorld(async (session) => {
      await session.append(storedAction(human.id, 5, buy(human.id, 2)));
      await session.write(world, [
        {
          type: 'council.election_held',
          audience: 'town',
          at: 5,
          seatId: 'maire',
          winnerPersonId: null,
          votes: {},
        },
        {
          type: 'person.debt_repaid',
          audience: { personId: human.id },
          at: 5,
          personId: human.id,
          amountCents: 120,
        },
      ]);
    });
    await pool.query(`INSERT INTO kings (dynasty_name, crowned_at, elapsed_hours) VALUES ('Leclerc', now(), 12)`);

    // Act
    await withWorld(async (session) => session.clear());

    // Assert: the town is gone whole, the accounts, the book and the world's
    // settings stay.
    const settings = await pool.query('SELECT count(*)::int AS count FROM settings');
    const people = await pool.query('SELECT count(*)::int AS count FROM people');
    const events = await pool.query('SELECT count(*)::int AS count FROM events');
    const messages = await pool.query('SELECT count(*)::int AS count FROM messages');
    const actions = await pool.query('SELECT count(*)::int AS count FROM actions');
    // The account survives the cleared town.
    const players = await pool.query('SELECT count(*)::int AS count FROM players WHERE token_hash = $1', [
      CLEARED_TOKEN,
    ]);
    const kings = await pool.query('SELECT count(*)::int AS count FROM kings');

    expect(settings.rows[0]?.count).toBe(3);
    expect(people.rows[0]?.count).toBe(0);
    expect(events.rows[0]?.count).toBe(0);
    // The mail belongs to the account, so it outlives the town it was written in.
    expect(messages.rows[0]?.count).toBe(1);
    expect(actions.rows[0]?.count).toBe(0);
    expect(players.rows[0]?.count).toBe(1);
    expect(kings.rows[0]?.count).toBe(1);
    await expect(withWorld(async (session) => session.snapshot)).rejects.toBeInstanceOf(UnknownWorldError);
  });

  it('keeps two towns apart', async () => {
    // Arrange
    const a = await store.createTown('A', createWorld(), START);
    const b = await store.createTown('B', createWorld(), START);

    // Act
    const first = await store.withWorld(async (session) => session.snapshot, a.id);
    const second = await store.withWorld(async (session) => session.snapshot, b.id);
    const towns = await store.listTowns();

    // Assert: each town reads its own name and people, and the one world's
    // clock and seed.
    expect(first.town).toEqual(a);
    expect(second.town).toEqual(b);
    expect(second.world.hour).toBe(first.world.hour);
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
    const first = await store.createTown('Amiens', createWorld(), START);

    // Act
    await store.withWorld(async (session) => session.clear(), first.id);
    const second = await store.createTown('Amiens', createWorld(), START);

    // Assert: the dead town's name may return, its id may not.
    expect(second.name).toBe('Amiens');
    expect(second.id).not.toBe(first.id);
  });

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four people and a younger one of three.
    const old = await store.createTown('Old', town(9), START);
    const young = await store.createTown('New', createWorld(), START);

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('drops the journal written before the real-time cut', async () => {
    // Arrange: 120 entries, the first 49 written a day before the cut.
    await store.createTown(TEST_TOWN.name, createWorld(), START);
    await withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(1, 120));
    });
    const cut = new Date('2000-01-08T00:00:00.000Z');
    await pool.query(`UPDATE events SET recorded_at = $2 WHERE town_id = $1 AND at < $3`, [
      TEST_TOWN.id,
      new Date('2000-01-01T00:00:00.000Z'),
      hourStartedOf(START, 50),
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
    await store.createTown(TEST_TOWN.name, createWorld(), START);
    await withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(1, 120));
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
    await store.createTown(TEST_TOWN.name, createWorld(), START);
    await withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(1, 10));
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
    const world = town(4);
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    await withWorld(async (session) => {
      await session.write(
        world,
        Array.from({ length: 120 }, (_, index): Event => ({
          type: 'person.debt_repaid',
          audience: { personId: human.id },
          at: index + 1,
          personId: human.id,
          amountCents: index + 1,
        })),
      );
    });
    await pool.query(`UPDATE messages SET recorded_at = $1 WHERE id < 50`, [new Date('2000-01-01T00:00:00.000Z')]);

    // Act: the mail cut is a day after the first batch, the chronicle cut later.
    await store.pruneJournal(TEST_TOWN.id, new Date('2010-01-08T00:00:00.000Z'), new Date('2000-01-08T00:00:00.000Z'));

    // Assert: the mail keeps the 71 recent lines, whatever the chronicle cut says.
    const page = await withWorld(async (session) => session.recentMessages(120, playerId));
    expect(
      page.messages.map((message) => (message.event.type === 'person.debt_repaid' ? message.event.amountCents : -1)),
    ).toEqual(range(50, 120));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(rows.rows[0]?.count).toBe(71);
  });

  it('marks one message read without locking the town, and only its own', async () => {
    // Arrange: three unread messages for the weaver.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    await withWorld(async (session) => {
      await session.write(
        world,
        Array.from({ length: 3 }, (_, index): Event => ({
          type: 'person.debt_repaid',
          audience: { personId: human.id },
          at: index + 1,
          personId: human.id,
          amountCents: 120,
        })),
      );
    });
    const before = await withWorld(async (session) => session.recentMessages(50, playerId));
    const target = before.messages[0];
    expect(target).toBeDefined();
    expect(before.unread).toBe(3);

    // Act: another account names the id, then the owner does.
    const foreign = await store.markMessageRead(target?.id ?? 0, playerId + 1);
    const own = await store.markMessageRead(target?.id ?? 0, playerId);

    // Assert: the foreign call reads nothing, the owner's line only.
    expect(foreign).toEqual({ read: false, unread: 0 });
    expect(own).toEqual({ read: true, unread: 2 });
    const after = await withWorld(async (session) => session.recentMessages(50, playerId));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(after.unread).toBe(2);
    expect(after.messages).toHaveLength(3);
    expect(after.messages.filter((message) => message.read)).toHaveLength(1);
    expect(rows.rows[0]?.count).toBe(3);
  });

  it('deletes one message and only its own', async () => {
    // Arrange: two messages for the weaver.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    await withWorld(async (session) => {
      await session.write(
        world,
        [1, 2].map((at): Event => ({
          type: 'person.debt_repaid',
          audience: { personId: human.id },
          at,
          personId: human.id,
          amountCents: at * 120,
        })),
      );
    });
    const page = await withWorld(async (session) => session.recentMessages(50, playerId));
    const target = page.messages[0];
    expect(target).toBeDefined();

    // Act: another account names the id, then the owner does.
    const foreign = await store.deleteMessage(target?.id ?? 0, playerId + 1);
    const own = await store.deleteMessage(target?.id ?? 0, playerId);

    // Assert: the foreign call is a no-op (and answers the foreigner's own
    // badge, which is empty); the owner's removes the row.
    expect(foreign).toEqual({ deleted: false, unread: 0 });
    expect(own).toEqual({ deleted: true, unread: 1 });
    const after = await withWorld(async (session) => session.recentMessages(50, playerId));
    const rows = await pool.query('SELECT count(*)::int AS count FROM messages');
    expect(after.messages).toHaveLength(1);
    expect(after.unread).toBe(1);
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('writes prose and notices into the box', async () => {
    // Arrange: a notice already lives in the box, and a letter would next to it.
    const world = town(5);
    await store.createTown(TEST_TOWN.name, world, START);
    const human = humanPerson(world);
    const playerId = await bindAccount(TEST_TOWN.id, human.id, 'a'.repeat(64));
    const insert = (columns: string, values: unknown[] = []) =>
      pool.query(
        `INSERT INTO messages (player_id${columns}) VALUES ($1${values.map((_, index) => `, $${index + 2}`).join('')})`,
        [playerId, ...values],
      );

    // Act and assert: prose carries a body and may name its author, a notice
    // carries its type and its payload. The table holds both shapes and refuses
    // neither: the writer is what keeps them apart.
    await expect(insert(', body, author_player_id', ['Bonjour', playerId])).resolves.toBeDefined();
    await expect(insert(', type, payload', ['title_open', '{}'])).resolves.toBeDefined();
  });

  it('rolls the world and the actions back when the callback throws', async () => {
    // Arrange
    const world = { ...town(6), hour: 3 };
    await store.createTown(TEST_TOWN.name, world, START);
    const personId = humanPerson(world).id;
    // A human person exists only with its account: bind it before reading back.
    await bindAccount(TEST_TOWN.id, personId, 'a'.repeat(64));
    const action = storedAction(personId, 3, buy(personId, 1));
    let actionId = 0;

    // Act: a catch-up that refuses the world version, after writing both tables.
    const attempt = withWorld(async (session) => {
      actionId = (await session.append(action)).id;
      await session.write(oneHourLater(session.snapshot.world), []);
      throw new WorldVersionError({ ...world, rulesetVersion: RULES.version + 1 });
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(WorldVersionError);
    const after = await withWorld(async (session) => ({
      snapshot: session.snapshot,
      action: await session.findAction(actionId),
    }));
    expect(after.snapshot.world).toEqual(world);
    expect(after.action).toBeNull();
  });

  /** The first human person of a world the store has reattributed. */
  function humanPerson(world: World) {
    return Object.values(world.people).find((person) => !person.ia)!;
  }

  /** Inserts an account and points the person at it, as a join does. */
  async function bindAccount(townId: number, personId: number, tokenHash: string): Promise<number> {
    const { rows } = await pool.query<{ player_id: string }>(
      `INSERT INTO players (token_hash, name) VALUES ($1, $2) RETURNING player_id`,
      [tokenHash, `H${tokenHash.slice(0, 8)}`],
    );
    const playerId = Number(rows[0]?.player_id);
    await pool.query('UPDATE people SET player_id = $2 WHERE id = $1 AND town_id = $3', [personId, playerId, townId]);

    return playerId;
  }
});

function oneHourLater(world: World): World {
  return { ...world, hour: world.hour + 1 };
}

function buy(personId: number, units: number): Action {
  return { type: 'market.buy', personId, good: 'wool', units };
}

/** One chronicle line per hour, so a cut has a visible order to work on. */
function priceAt(hour: number): Event {
  return {
    type: 'council.election_held',
    audience: 'town',
    at: hour,
    seatId: 'maire',
    winnerPersonId: null,
    votes: {},
  };
}

function hours(from: number, to: number): Event[] {
  return Array.from({ length: to - from + 1 }, (_, index) => priceAt(from + index));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function storedAction(personId: number, hour: number, action: Action): NewStoredAction {
  return { personId, playsAt: hour, action, receivedAt: new Date(START) };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
