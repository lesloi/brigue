import type { ClientConfig, Pool, PoolClient } from 'pg';

import {
  goodCode,
  goodOfCode,
  residenceOf,
  titleCode,
  titleOf,
  titleOfCode,
  tradeCode,
  tradeOfCode,
} from '@brigue/core';
import type { Action, Event, GoodId, Person, Seat, SeatId, TitleId, Trade, World } from '@brigue/core';
import {
  HOUR_MS,
  JOURNAL_PAGE,
  NameInUseError,
  UnknownWorldError,
  hourAt,
  hourStartedOf,
  type Clock,
  type StoredAction,
  type MessagePage,
  type TownInfo,
  type TownSession,
  type NewStoredAction,
  type WorldSession,
  type WorldSnapshot,
  type WorldStore,
} from './worlds.ts';

interface SettingsRow {
  key: string;
  value: string;
}

/** The world's settings, parsed out of the key/value table. */
interface Settings {
  formatVersion: number;
  rulesetVersion: number;
  worldStartedAt: Date;
}

const SETTINGS_KEYS = ['format_version', 'ruleset_version', 'world_started_at'] as const;

/**
 * The key of the join lock: one number for every server, so two instances
 * serialize their joins together. The value itself is arbitrary.
 */
const JOIN_LOCK_KEY = 0x62726967; // 'brig'

/**
 * The towns are the database: one row per thing, keyed by town, and the world's
 * `settings` table is what the writer locks. The scheduler and the reader both
 * write, so the lock covers load, advance and save.
 *
 * `pg` is imported lazily so the HTTP tests stay database-free.
 */
export class PgWorldStore implements WorldStore {
  private readonly pool: Pool;
  private readonly lockConfig: ClientConfig;

  /**
   * `lockConfig` builds the one extra connection a join holds. It is not taken
   * from the pool: a join pins a connection while it waits for the lock, and a
   * pool full of waiters would starve the join that holds it.
   */
  constructor(pool: Pool, lockConfig: ClientConfig = pool.options) {
    this.pool = pool;
    this.lockConfig = lockConfig;
  }

  async createTown(
    name: string,
    world: World,
    at: Date,
    bindings: ReadonlyMap<number, number> = new Map(),
  ): Promise<TownInfo> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      // The first town founds the world and writes its settings; a later town
      // reads them and joins the clock it finds.
      await ensureSettings(client, world, at);
      const settings = await readSettings(client);
      // The town's rows start at the hour it joins, so it owes none of the hours
      // before it existed, whatever its neighbours still owe.
      const lastPlayedAt = hourStartedOf(settings.worldStartedAt, hourAt(settings.worldStartedAt, at));
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO towns (name, last_played_at) VALUES ($1, $2) RETURNING id`,
        [name, lastPlayedAt],
      );
      const id = Number(rows[0]?.id);
      applySettings(world, settings, lastPlayedAt);
      // The world is reattributed in place: the join needs the ids the database
      // assigned, and the first person is written already bound to its account.
      await syncWorld(client, id, world, bindings);

      await client.query('COMMIT');

      return { id, name };
    } catch (error) {
      await rollback(client);
      throw isTownNameViolation(error) ? new NameInUseError() : error;
    } finally {
      client.release();
    }
  }

  async readClock(): Promise<Clock | null> {
    const { rows } = await this.pool.query<SettingsRow>(
      `SELECT key, value FROM settings WHERE key = 'world_started_at'`,
    );

    if (rows.length === 0) {
      return null;
    }

    const worldStartedAt = new Date(rows[0]?.value ?? '');
    if (Number.isNaN(worldStartedAt.getTime())) {
      throw new Error('the world settings carry no readable clock');
    }

    return { worldStartedAt };
  }

  async moveWorldClockBack(hours: number): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const settings = await readSettings(client);
      const back = hours * HOUR_MS;
      // Take every town's row before the clock moves: a town being written either
      // lands before this shift or reads the new origin after it, never in between.
      await client.query('SELECT id FROM towns ORDER BY id FOR UPDATE');
      await client.query(`UPDATE settings SET value = $1 WHERE key = 'world_started_at'`, [
        new Date(settings.worldStartedAt.getTime() - back).toISOString(),
      ]);
      // The rows move with the origin: an hour they hold stays the hour they
      // hold. Left in place, every instant would decode `hours` later than the
      // store that keeps hours, and an ordered action would play late.
      await client.query(`UPDATE actions SET plays_at = plays_at - make_interval(secs => $1)`, [back / 1000]);
      await client.query(`UPDATE events SET at = at - make_interval(secs => $1)`, [back / 1000]);
      await client.query(`UPDATE towns SET last_played_at = last_played_at - make_interval(secs => $1)`, [back / 1000]);
      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listTowns(): Promise<TownInfo[]> {
    // Least filled first: the join takes the town that needs people most, and
    // the oldest breaks a tie. A living person is a place, as a dynasty was.
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT t.id, t.name
       FROM towns t
       LEFT JOIN people h ON h.town_id = t.id AND h.alive
       GROUP BY t.id, t.name, t.created_at
       ORDER BY count(h.id), t.created_at, t.id`,
    );

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  async pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    await this.pool.query(`DELETE FROM events WHERE town_id = $1 AND recorded_at < $2`, [townId, chronicleBefore]);
    // The mail has no town column: the thirty-day cut is the same for every
    // box, and a pass over any town may as well take what every box has aged out.
    await this.pool.query(`DELETE FROM messages WHERE recorded_at < $1`, [messagesBefore]);
  }

  async markMessageRead(id: number, playerId: number): Promise<{ read: boolean; unread: number }> {
    // Scoped to the account: an id from another box changes nothing.
    const { rowCount } = await this.pool.query(`UPDATE messages SET read = true WHERE id = $1 AND player_id = $2`, [
      id,
      playerId,
    ]);
    const counts = await this.pool.query<{ unread: number }>(
      `SELECT count(*) FILTER (WHERE read = false)::int AS unread FROM messages WHERE player_id = $1`,
      [playerId],
    );

    return {
      read: (rowCount ?? 0) > 0,
      unread: Math.min(counts.rows[0]?.unread ?? 0, JOURNAL_PAGE),
    };
  }

  async deleteMessage(id: number, playerId: number): Promise<{ deleted: boolean; unread: number }> {
    // Scoped to the account: an id from another box deletes nothing and says
    // nothing, so a bad guess is not an oracle.
    const { rowCount } = await this.pool.query(`DELETE FROM messages WHERE id = $1 AND player_id = $2`, [id, playerId]);
    const counts = await this.pool.query<{ unread: number }>(
      `SELECT count(*) FILTER (WHERE read = false)::int AS unread FROM messages WHERE player_id = $1`,
      [playerId],
    );

    return {
      deleted: (rowCount ?? 0) > 0,
      unread: Math.min(counts.rows[0]?.unread ?? 0, JOURNAL_PAGE),
    };
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T> {
    return this.lockedTown(townId, async (client, locked) => {
      const snapshot = await readWorld(client, locked);

      return run(new PgWorldSession(client, townId, locked, snapshot));
    });
  }

  async withTown<T>(run: (session: TownSession) => Promise<T>, townId: number): Promise<T> {
    return this.lockedTown(townId, (client, locked) => run(new PgTownSession(client, townId, locked)));
  }

  /**
   * One transaction per callback, with the town's row held throughout: both
   * seams take it, so an order read narrowly and a pass over the same town queue
   * up exactly as two passes would.
   */
  private async lockedTown<T>(townId: number, run: (client: PoolClient, locked: LockedTown) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const locked = await lockTown(client, townId);
      const result = await run(client, locked);
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async withJoinLock<T>(run: () => Promise<T>): Promise<T> {
    // A session-level lock on a connection of its own: the join reads the
    // towns and then takes a place in one, each in its own transaction, so no
    // single transaction can carry the lock. The connection is closed after
    // the pass, which releases the lock whatever happened inside.
    const { Client } = await import('pg');
    const client = new Client(this.lockConfig);

    try {
      await client.connect();
      await client.query('SELECT pg_advisory_lock($1)', [JOIN_LOCK_KEY]);

      return await run();
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async close(): Promise<void> {}
}

/**
 * The town under its lock: its clock, its queue and one person at a time. It
 * reads no town table but the actions, so a route that takes an order pays for
 * the order, not for the town.
 */
class PgTownSession implements TownSession {
  readonly town: TownInfo;
  readonly worldStartedAt: Date;
  readonly hour: number;
  readonly formatVersion: number;
  readonly rulesetVersion: number;
  protected readonly client: PoolClient;
  protected readonly townId: number;

  constructor(client: PoolClient, townId: number, locked: LockedTown) {
    this.client = client;
    this.townId = townId;
    this.town = locked.town;
    this.worldStartedAt = locked.settings.worldStartedAt;
    this.hour = hourAt(locked.settings.worldStartedAt, locked.lastPlayedAt);
    this.formatVersion = locked.settings.formatVersion;
    this.rulesetVersion = locked.settings.rulesetVersion;
  }

  async actionsBetween(from: number, to: number): Promise<StoredAction[]> {
    // The row holds the instant its hour begins, so the range is one comparison:
    // the hours `[from, to]` are the instants that begin them.
    const { rows } = await this.client.query<ActionRow>(
      `SELECT id, person_id, plays_at, type, payload, received_at
       FROM actions
       WHERE town_id = $3 AND plays_at >= $1 AND plays_at < $2
       ORDER BY plays_at, id`,
      [hourStartedOf(this.worldStartedAt, from), hourStartedOf(this.worldStartedAt, to + 1), this.townId],
    );

    return rows.map((row) => rowToStoredAction(row, this.worldStartedAt));
  }

  async findAction(id: number): Promise<StoredAction | null> {
    // Scoped to the town: another town may carry the same id, and its action
    // must be as unknown here as an id that was never issued.
    const { rows } = await this.client.query<ActionRow>(
      `SELECT id, person_id, plays_at, type, payload, received_at
       FROM actions
       WHERE id = $1 AND town_id = $2`,
      [id, this.townId],
    );
    const row = rows[0];

    return row ? rowToStoredAction(row, this.worldStartedAt) : null;
  }

  async append(action: NewStoredAction): Promise<StoredAction> {
    // The type is a column of its own: a row names what was asked without the
    // payload being parsed first.
    const { type, ...payload } = action.action;
    const { rows } = await this.client.query<ActionRow>(
      `INSERT INTO actions (town_id, person_id, plays_at, type, payload, received_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, person_id, plays_at, type, payload, received_at`,
      [
        this.townId,
        action.personId,
        hourStartedOf(this.worldStartedAt, action.playsAt),
        type,
        json(payload),
        action.receivedAt,
      ],
    );

    return {
      ...rowToStoredAction(rows[0]!, this.worldStartedAt),
      ...(action.title === undefined ? {} : { title: action.title }),
    };
  }

  async cancel(id: number): Promise<void> {
    await this.client.query('DELETE FROM actions WHERE id = $1 AND town_id = $2', [id, this.townId]);
  }

  async person(id: number): Promise<Person | null> {
    // One statement: the person, its workshops and its stock. A person read
    // without its stock would be a lie waiting for the first caller that sells.
    const { rows } = await this.client.query<PersonWithRows>(
      `SELECT p.id, p.player_id, p.person_name, p.title, p.residence_level, p.treasury_cents,
              p.debt_cents, p.favour, p.prestige, p.alive,
              (SELECT coalesce(json_agg(json_build_object('id', w.id, 'trade', w.trade, 'level', w.level)
                                        ORDER BY w.id), '[]')
               FROM workshops w WHERE w.person_id = p.id) AS workshops,
              (SELECT coalesce(json_agg(json_build_object('good', s.good, 'units', s.units)), '[]')
               FROM stock s WHERE s.person_id = p.id) AS stock
       FROM people p
       WHERE p.id = $1 AND p.town_id = $2`,
      [id, this.townId],
    );
    const row = rows[0];

    return row ? personWithRows(row) : null;
  }
}

/** The loaded town: the session above, plus the rows a simulation reads. */
class PgWorldSession extends PgTownSession implements WorldSession {
  readonly snapshot: WorldSnapshot;

  constructor(client: PoolClient, townId: number, locked: LockedTown, snapshot: WorldSnapshot) {
    super(client, townId, locked);
    this.snapshot = snapshot;
  }

  async recentMessages(limit: number, playerId: number): Promise<MessagePage> {
    const { rows } = await this.client.query<MessageRow>(
      `SELECT id, player_id, type, payload, read
       FROM messages
       WHERE player_id = $2
       ORDER BY id DESC
       LIMIT $1`,
      [limit, playerId],
    );
    const counts = await this.client.query<{ unread: number }>(
      `SELECT count(*) FILTER (WHERE read = false)::int AS unread
       FROM messages
       WHERE player_id = $1`,
      [playerId],
    );

    return {
      // The query walks back from the newest; the page reads forward in time.
      messages: rows
        .slice()
        .reverse()
        .map((row) => ({ id: Number(row.id), read: row.read, event: rowToMessage(row) })),
      // The badge names what the page can open, never a backlog below it.
      unread: Math.min(counts.rows[0]?.unread ?? 0, limit),
    };
  }

  async recentChronicle(limit: number): Promise<Event[]> {
    const { rows } = await this.client.query<ChronicleRow>(
      `SELECT id, at, type, payload
       FROM events
       WHERE town_id = $2
       ORDER BY id DESC
       LIMIT $1`,
      [limit, this.townId],
    );

    return rows
      .slice()
      .reverse()
      .map((row) => rowToChronicleEvent(row, this.snapshot.worldStartedAt));
  }

  async cancelPerson(personId: number): Promise<void> {
    await this.client.query('DELETE FROM actions WHERE town_id = $1 AND person_id = $2', [this.townId, personId]);
  }

  async clear(): Promise<void> {
    // Deleting the town cascades every town table. The accounts and the sealed
    // seasons live outside it, and the mail belongs to an account, so all of
    // them stay.
    await this.client.query(`DELETE FROM towns WHERE id = $1`, [this.townId]);
  }

  async write(world: World, events: Event[], accounts: ReadonlyMap<number, number> = new Map()): Promise<void> {
    // The same map that addresses the mail names who holds each person: a person
    // written here is written with its account, never in the hope of one.
    const ids = await syncWorld(this.client, this.townId, world, accounts);
    // Only this town's watermark moves, and only forward: another town's pass
    // says nothing about this one, and a town that fell behind keeps its own.
    const firstUnplayed = hourStartedOf(this.snapshot.worldStartedAt, world.hour);
    await this.client.query(`UPDATE towns SET last_played_at = $1 WHERE id = $2 AND last_played_at < $1`, [
      firstUnplayed,
      this.townId,
    ]);

    // A queued action keeps the person id it was taken with; when the database
    // has just named a person, the queue follows the new id.
    for (const [before, after] of ids.people) {
      if (before !== after) {
        await this.client.query(`UPDATE actions SET person_id = $3 WHERE town_id = $1 AND person_id = $2`, [
          this.townId,
          before,
          after,
        ]);
      }
    }

    await appendChronicle(
      this.client,
      this.townId,
      this.snapshot.worldStartedAt,
      events.filter((event) => event.audience === 'town'),
    );
    await appendMessages(
      this.client,
      events.filter((event) => typeof event.audience === 'object'),
      await readPlayerByPerson(this.client, this.townId),
    );
  }
}

export async function createPgWorldStore(connectionString: string): Promise<PgWorldStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgWorldStore(new PgPool({ connectionString }));
}

/**
 * The town whose row this transaction holds. The lock is the town's own row:
 * two writers of one town serialise there, and two towns never wait on each
 * other. The settings ride along in the same statement — three rows that never
 * move until a reset.
 */
interface LockedTown {
  town: TownInfo;
  /** The start of the first hour the town's rows do not hold yet. */
  lastPlayedAt: Date;
  settings: Settings;
}

interface LockedTownRow {
  id: string;
  name: string;
  last_played_at: Date | string;
  format_version: string | null;
  ruleset_version: string | null;
  world_started_at: string | null;
}

async function lockTown(client: PoolClient, townId: number): Promise<LockedTown> {
  const { rows } = await client.query<LockedTownRow>(
    `SELECT t.id, t.name, t.last_played_at,
            (SELECT value FROM settings WHERE key = 'format_version') AS format_version,
            (SELECT value FROM settings WHERE key = 'ruleset_version') AS ruleset_version,
            (SELECT value FROM settings WHERE key = 'world_started_at') AS world_started_at
     FROM towns t
     WHERE t.id = $1
     FOR UPDATE`,
    [townId],
  );
  const row = rows[0];

  if (row === undefined) {
    throw new UnknownWorldError();
  }

  return {
    town: { id: Number(row.id), name: row.name },
    lastPlayedAt: asDate(row.last_played_at),
    settings: parseSettings([
      { key: 'format_version', value: row.format_version },
      { key: 'ruleset_version', value: row.ruleset_version },
      { key: 'world_started_at', value: row.world_started_at },
    ]),
  };
}

/**
 * The settings of the world: written once, by the founding town, and read by
 * every town after. A world without settings has not been founded, and a town
 * cannot belong to it.
 */
async function readSettings(client: PoolClient): Promise<Settings> {
  const { rows } = await client.query<SettingsRow>(`SELECT key, value FROM settings`);

  return parseSettings(rows);
}

function parseSettings(rows: ReadonlyArray<{ key: string; value: string | null }>): Settings {
  const values = new Map(rows.flatMap((row) => (row.value === null ? [] : [[row.key, row.value] as const])));
  const missing = SETTINGS_KEYS.filter((key) => !values.has(key));

  if (missing.length > 0) {
    throw new UnknownWorldError();
  }

  const formatVersion = Number(values.get('format_version'));
  const rulesetVersion = Number(values.get('ruleset_version'));
  const worldStartedAt = new Date(values.get('world_started_at') ?? '');

  if (!Number.isInteger(formatVersion) || !Number.isInteger(rulesetVersion) || Number.isNaN(worldStartedAt.getTime())) {
    throw new Error('the world settings are not readable');
  }

  return { formatVersion, rulesetVersion, worldStartedAt };
}

/**
 * The first town founds the world: it writes the settings the world did not
 * have. A later town finds them and leaves them alone, so a second town cannot
 * reset the clock.
 */
async function ensureSettings(client: PoolClient, world: World, at: Date): Promise<void> {
  await client.query(
    `INSERT INTO settings (key, value)
     VALUES ('format_version', $1), ('ruleset_version', $2), ('world_started_at', $3)
     ON CONFLICT (key) DO NOTHING`,
    [String(world.formatVersion), String(world.rulesetVersion), at.toISOString()],
  );
}

/** A town joins the world it is founded in: one clock, one format. */
function applySettings(world: World, settings: Settings, lastPlayedAt: Date): void {
  world.formatVersion = settings.formatVersion;
  world.rulesetVersion = settings.rulesetVersion;
  world.hour = hourAt(settings.worldStartedAt, lastPlayedAt);
}

async function readWorld(client: PoolClient, locked: LockedTown): Promise<WorldSnapshot> {
  // The town's row is already locked by the caller: this reads the rows the lock
  // covers, so a save and a read of one town never interleave.
  const townId = locked.town.id;
  const settings = locked.settings;

  const [people, workshops, stock, seats, laws, campaigns, market] = await Promise.all([
    client.query(
      `SELECT id, player_id, person_name, title, residence_level, treasury_cents, debt_cents, favour, prestige, alive
       FROM people WHERE town_id = $1 ORDER BY id`,
      [townId],
    ),
    client.query(`SELECT id, person_id, trade, level FROM workshops WHERE ${townScope('workshops')} ORDER BY id`, [
      townId,
    ]),
    client.query(`SELECT person_id, good, units FROM stock WHERE ${townScope('stock')} ORDER BY person_id, good`, [
      townId,
    ]),
    client.query(`SELECT seat_id, person_id FROM seats WHERE town_id = $1 ORDER BY seat_id`, [townId]),
    client.query(`SELECT code, value FROM laws WHERE town_id = $1 ORDER BY code`, [townId]),
    client.query(`SELECT seat_id, person_id FROM campaigns WHERE town_id = $1 ORDER BY seat_id, person_id`, [townId]),
    client.query(`SELECT good, price_cents, flow_units FROM market WHERE town_id = $1 ORDER BY good`, [townId]),
  ]);

  const world: World = {
    formatVersion: settings.formatVersion,
    rulesetVersion: settings.rulesetVersion,
    hour: hourAt(settings.worldStartedAt, locked.lastPlayedAt),
    people: {},
    seats: {} as Record<SeatId, Seat>,
    laws: [],
    market: {} as Record<GoodId, number>,
    marketFlow: {},
    campaigns: {},
  };

  for (const person of people.rows) {
    world.people[Number(person.id)] = personOf(person);
  }

  for (const workshop of workshops.rows) {
    const person = world.people[Number(workshop.person_id)];
    const id = Number(workshop.id);
    if (person !== undefined) {
      person.workshops.push({ id, trade: requiredTrade(workshop.trade), level: workshop.level });
    }
  }
  for (const person of Object.values(world.people)) {
    sortPersonWorkshops(person);
  }

  for (const unit of stock.rows) {
    const person = world.people[Number(unit.person_id)];
    if (person !== undefined) {
      person.stock[requiredGood(unit.good, 'stock')] = unit.units;
    }
  }

  for (const seat of seats.rows) {
    world.seats[seat.seat_id as SeatId] = {
      personId: seat.person_id === null ? null : Number(seat.person_id),
    };
  }

  for (const law of laws.rows) {
    world.laws.push({ code: law.code, value: law.value });
  }

  for (const campaign of campaigns.rows) {
    const seat = (world.campaigns[campaign.seat_id as SeatId] ??= []);
    seat.push(Number(campaign.person_id));
  }
  for (const seat of Object.values(world.campaigns)) {
    seat?.sort((left, right) => left - right);
  }

  for (const good of market.rows) {
    const goodId = requiredGood(good.good, 'market');
    world.market[goodId] = good.price_cents;
    // The flow map is sparse — a good with no trade is absent from it, not
    // zeroed — so a town read back is the town that was written.
    if (good.flow_units !== 0) {
      world.marketFlow[goodId] = good.flow_units;
    }
  }

  return {
    town: locked.town,
    world,
    worldStartedAt: settings.worldStartedAt,
  };
}

/**
 * The scalar part of a person, as a row carries it. A caller that also has the
 * workshops and the stock fills them in; a person read whole starts here too,
 * so the two read paths cannot drift on a field.
 */
function personOf(row: PersonRow): Person {
  return {
    id: Number(row.id),
    // A person with no account is an AI: that null is the whole of the fact.
    ia: row.player_id === null,
    name: row.person_name,
    title: requiredTitle(row.title),
    residenceLevel: row.residence_level,
    treasuryCents: row.treasury_cents,
    debtCents: row.debt_cents,
    favour: row.favour,
    prestige: row.prestige,
    alive: row.alive,
    workshops: [],
    stock: {},
  };
}

/** One person with what hangs from it, aggregated by the same statement. */
function personWithRows(row: PersonWithRows): Person {
  const person = personOf(row);

  for (const workshop of row.workshops) {
    person.workshops.push({
      id: Number(workshop.id),
      trade: requiredTrade(workshop.trade),
      level: workshop.level,
    });
  }
  sortPersonWorkshops(person);

  for (const unit of row.stock) {
    person.stock[requiredGood(unit.good, 'stock')] = unit.units;
  }

  return person;
}

/**
 * A save brings each table to what the world says: the rows are inserted or
 * updated by their key, and the ones the world no longer holds are deleted. A
 * row keeps its identity from one hour to the next, and a piece that disappeared
 * cannot leave a row behind.
 *
 * The serial tables are inserted without an id and read back: the database names
 * people and workshops, and the world is reattributed before the rows that
 * refer to them are written.
 */
interface TownTable {
  readonly table: string;
  /** Every column the row carries, the primary key included. */
  readonly columns: readonly string[];
  /** The primary key, which is also what the update matches on. */
  readonly key: readonly string[];
  rows(world: World, townId: number): ReadonlyArray<Record<string, unknown>>;
}

const byId = <T extends { id: number }>(left: T, right: T): number => left.id - right.id;

export const TOWN_TABLES: readonly TownTable[] = [
  {
    table: 'people',
    key: ['id'],
    columns: [
      'id',
      'town_id',
      'player_id',
      'person_name',
      'title',
      'residence_level',
      'treasury_cents',
      'debt_cents',
      'favour',
      'prestige',
      'alive',
    ],
    rows: (world, townId) =>
      Object.values(world.people)
        .sort(byId)
        .map((person) => ({
          id: person.id,
          town_id: townId,
          player_id: null,
          person_name: person.name,
          title: titleCode(titleOf(person)),
          residence_level: residenceOf(person),
          treasury_cents: person.treasuryCents,
          debt_cents: person.debtCents,
          favour: person.favour,
          prestige: person.prestige,
          alive: person.alive,
        })),
  },
  {
    table: 'workshops',
    key: ['id'],
    columns: ['id', 'person_id', 'trade', 'level'],
    rows: (world) =>
      Object.values(world.people)
        .sort(byId)
        .flatMap((person) =>
          person.workshops.map((workshop) => ({
            id: workshop.id,
            person_id: person.id,
            trade: tradeCode(workshop.trade),
            level: workshop.level,
          })),
        ),
  },
  {
    table: 'stock',
    key: ['person_id', 'good'],
    columns: ['person_id', 'good', 'units'],
    rows: (world) =>
      Object.values(world.people)
        .sort(byId)
        .flatMap((person) =>
          Object.entries(person.stock).map(([good, units]) => ({
            person_id: person.id,
            good: goodCode(good as GoodId),
            units: units ?? 0,
          })),
        ),
  },
  {
    table: 'seats',
    key: ['town_id', 'seat_id'],
    columns: ['town_id', 'seat_id', 'person_id'],
    rows: (world, townId) =>
      Object.entries(world.seats).map(([seatId, seat]) => ({
        town_id: townId,
        seat_id: seatId,
        person_id: seat.personId,
      })),
  },
  {
    table: 'laws',
    key: ['town_id', 'code'],
    columns: ['town_id', 'code', 'value'],
    rows: (world, townId) => world.laws.map((law) => ({ town_id: townId, code: law.code, value: law.value })),
  },
  {
    table: 'campaigns',
    key: ['town_id', 'seat_id', 'person_id'],
    columns: ['town_id', 'seat_id', 'person_id'],
    rows: (world, townId) =>
      Object.entries(world.campaigns).flatMap(([seatId, personIds]) =>
        (personIds ?? []).map((personId) => ({ town_id: townId, seat_id: seatId, person_id: personId })),
      ),
  },
  {
    table: 'market',
    key: ['town_id', 'good'],
    columns: ['town_id', 'good', 'price_cents', 'flow_units'],
    rows: (world, townId) =>
      Object.entries(world.market).map(([good, price]) => ({
        town_id: townId,
        good: goodCode(good as GoodId),
        price_cents: price,
        flow_units: world.marketFlow[good as GoodId] ?? 0,
      })),
  },
];

interface IdMap {
  people: Map<number, number>;
  workshops: Map<number, number>;
}

/**
 * Brings the town's rows to what the world says: every row is inserted or
 * updated by its key, and the rows the world no longer holds are deleted.
 * Serial rows are inserted without an id and reattributed in the world before
 * the tables that refer to them are written.
 */
async function syncWorld(
  client: PoolClient,
  townId: number,
  world: World,
  bindings: ReadonlyMap<number, number> = new Map(),
): Promise<IdMap> {
  const [existing, playerByPerson] = await Promise.all([
    readExistingIds(client, townId),
    readPlayerByPerson(client, townId),
  ]);
  const ids: IdMap = {
    people: new Map(),
    workshops: new Map(),
  };

  // People first: every dependent row names a person, and the database names
  // the person.
  const peopleRows = Object.values(world.people)
    .sort(byId)
    .map((person) => ({
      id: person.id,
      town_id: townId,
      // A binding says who holds the person: a fresh one from the join, else the
      // row's own, else nobody, which is an AI.
      player_id: bindings.get(person.id) ?? playerByPerson.get(person.id) ?? null,
      person_name: person.name,
      title: titleCode(titleOf(person)),
      residence_level: residenceOf(person),
      treasury_cents: person.treasuryCents,
      debt_cents: person.debtCents,
      favour: person.favour,
      prestige: person.prestige,
      alive: person.alive,
    }));
  ids.people = await syncSerialRows(client, 'people', townId, peopleRows, existing.people);
  remapPeople(world, ids.people);

  const workshopRows = Object.values(world.people)
    .sort(byId)
    .flatMap((person) =>
      person.workshops.map((workshop) => ({
        id: workshop.id,
        person_id: person.id,
        trade: tradeCode(workshop.trade),
        level: workshop.level,
      })),
    );
  ids.workshops = await syncSerialRows(client, 'workshops', townId, workshopRows, existing.workshops);
  remapWorkshops(world, ids.workshops);

  for (const entry of TOWN_TABLES) {
    if (SERIAL_TABLES.has(entry.table)) {
      continue;
    }
    const rows = entry.rows(world, townId);
    await upsertRows(client, entry.table, entry.columns, entry.key, rows);
    await deleteMissing(client, entry.table, entry.key, townId, rows);
  }

  return ids;
}

const SERIAL_TABLES = new Set(['people', 'workshops']);

async function readExistingIds(
  client: PoolClient,
  townId: number,
): Promise<{ people: Set<number>; workshops: Set<number> }> {
  const [people, workshops] = await Promise.all([
    client.query<{ id: string }>(`SELECT id FROM people WHERE town_id = $1`, [townId]),
    client.query<{ id: string }>(`SELECT id FROM workshops WHERE ${townScope('workshops')}`, [townId]),
  ]);

  return {
    people: new Set(people.rows.map((row) => Number(row.id))),
    workshops: new Set(workshops.rows.map((row) => Number(row.id))),
  };
}

/** Who holds each person of the town, read from the rows a write is about to rewrite. */
async function readPlayerByPerson(client: PoolClient, townId: number): Promise<Map<number, number>> {
  const { rows } = await client.query<{ id: string; player_id: string }>(
    `SELECT id, player_id FROM people WHERE town_id = $1 AND player_id IS NOT NULL`,
    [townId],
  );

  return new Map(rows.map((row) => [Number(row.id), Number(row.player_id)]));
}

/** Rewrites the world's keys and every reference to a person the database named. */
function remapPeople(world: World, mapping: ReadonlyMap<number, number>): void {
  if (mapping.size === 0) {
    return;
  }

  const people: Record<number, Person> = {};
  for (const person of Object.values(world.people)) {
    person.id = mapping.get(person.id) ?? person.id;
    people[person.id] = person;
  }
  world.people = people;

  for (const seat of Object.values(world.seats)) {
    if (seat.personId !== null) {
      seat.personId = mapping.get(seat.personId) ?? seat.personId;
    }
  }
  for (const [seatId, personIds] of Object.entries(world.campaigns)) {
    world.campaigns[seatId as SeatId] = (personIds ?? []).map((personId) => mapping.get(personId) ?? personId);
  }
}

/** Rewrites the workshops and the sites that improve them. */
function remapWorkshops(world: World, mapping: ReadonlyMap<number, number>): void {
  if (mapping.size === 0) {
    return;
  }

  for (const person of Object.values(world.people)) {
    for (const workshop of person.workshops) {
      workshop.id = mapping.get(workshop.id) ?? workshop.id;
    }
    sortPersonWorkshops(person);
  }
}

function sortPersonWorkshops(person: Person): void {
  person.workshops.sort((left, right) => left.id - right.id);
}

async function syncSerialRows(
  client: PoolClient,
  table: string,
  townId: number,
  rows: ReadonlyArray<{ id: number } & Record<string, unknown>>,
  existing: ReadonlySet<number>,
): Promise<Map<number, number>> {
  const mapping = new Map<number, number>();
  const kept: number[] = [];
  const updates = rows.filter((row) => existing.has(row.id));
  const inserts = rows.filter((row) => !existing.has(row.id));

  // The rows the town already holds go back in one statement: a save that
  // rewrites twenty people is one round trip, not twenty.
  if (updates.length > 0) {
    await updateRows(client, table, updates);
    kept.push(...updates.map((row) => row.id));
  }

  // A row the database has not named yet is inserted without its id: the
  // sequence must assign it, or a later insert collides with a row written
  // past it. Those are the opening and a new workshop, so the loop is short.
  for (const row of inserts) {
    const { id, ...values } = row;
    const columns = Object.keys(values);
    const marks = columns.map((_, index) => `$${index + 1}`);
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks.join(', ')}) RETURNING id`,
      columns.map((column) => values[column]),
    );
    const assigned = Number(inserted[0]?.id);
    mapping.set(id, assigned);
    kept.push(assigned);
  }

  await deleteSerialMissing(client, table, townId, kept);

  return mapping;
}

/**
 * Rewrites the rows that already exist, by their id, in one statement. The
 * table's own row type gives the JSON its types: every column keeps the type it
 * is stored with, and a null is the null of that column.
 */
async function updateRows(
  client: PoolClient,
  table: string,
  rows: ReadonlyArray<{ id: number } & Record<string, unknown>>,
): Promise<void> {
  const columns = Object.keys(rows[0]!).filter((column) => column !== 'id');
  const assignments = columns.map((column) => `${column} = v.${column}`).join(', ');
  const json = JSON.stringify(rows);

  await client.query(
    `UPDATE ${table} AS t
     SET ${assignments}
     FROM json_populate_recordset(NULL::${table}, $1::json) AS v
     WHERE t.id = v.id`,
    [json],
  );
}

async function deleteSerialMissing(
  client: PoolClient,
  table: string,
  townId: number,
  kept: readonly number[],
): Promise<void> {
  if (kept.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE ${townScope(table)}`, [townId]);
    return;
  }

  const marks = kept.map((_, index) => `$${index + 2}`);
  await client.query(`DELETE FROM ${table} WHERE ${townScope(table)} AND id NOT IN (${marks.join(', ')})`, [
    townId,
    ...kept,
  ]);
}

async function appendChronicle(
  client: PoolClient,
  townId: number,
  worldStartedAt: Date,
  events: Event[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await insertRows(
    client,
    'events',
    ['town_id', 'at', 'type', 'payload'],
    // The chronicle is the town's: the audience decided the route, not the row.
    events.map((event) => ({
      town_id: townId,
      at: hourStartedOf(worldStartedAt, event.at),
      type: event.type,
      payload: json(eventBody(event)),
    })),
  );
}

async function appendMessages(
  client: PoolClient,
  events: Event[],
  playerByPerson: ReadonlyMap<number, number>,
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const rows = events.flatMap((event) => {
    if (typeof event.audience !== 'object') {
      return [];
    }
    const playerId = playerByPerson.get(event.audience.personId);
    // An AI person, or one no account holds, has no mailbox.
    if (playerId === undefined) {
      return [];
    }

    return [{ player_id: playerId, type: event.type, payload: json(eventBody(event)) }];
  });

  await insertRows(client, 'messages', ['player_id', 'type', 'payload'], rows);
}

/** The payload of a stored line: the event minus what the row already carries. */
function eventBody(event: Event): Record<string, unknown> {
  const body = { ...event } as Record<string, unknown>;
  delete body.audience;
  delete body.at;
  delete body.type;

  return body;
}

async function insertRows(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    // A row names its columns; a missing or extra one is a bug in the writer,
    // not in the data, and must not reach the table.
    if (Object.keys(row).length !== columns.length || !columns.every((column) => Object.hasOwn(row, column))) {
      throw new Error(`${table}: a row does not match its columns`);
    }

    const marks = columns.map((column) => {
      values.push(row[column]);

      return `$${values.length}`;
    });

    return `(${marks.join(', ')})`;
  });

  await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values);
}

/** The same, but a row whose key is already there is updated in place. */
async function upsertRows(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  key: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    if (Object.keys(row).length !== columns.length || !columns.every((column) => Object.hasOwn(row, column))) {
      throw new Error(`${table}: a row does not match its columns`);
    }

    const marks = columns.map((column) => {
      values.push(row[column]);

      return `$${values.length}`;
    });

    return `(${marks.join(', ')})`;
  });

  const updates = columns.filter((column) => !key.includes(column)).map((column) => `${column} = EXCLUDED.${column}`);
  const clause = updates.length === 0 ? 'DO NOTHING' : `DO UPDATE SET ${updates.join(', ')}`;

  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}
     ON CONFLICT (${key.join(', ')}) ${clause}`,
    values,
  );
}

/**
 * The rows of one town in a table: by its own `town_id`, or through the people
 * the rows hang from. `$1` is the town id in every statement that uses it.
 */
const HANGS_FROM_PERSON = new Set(['workshops', 'stock']);

function townScope(table: string): string {
  return HANGS_FROM_PERSON.has(table) ? 'person_id IN (SELECT id FROM people WHERE town_id = $1)' : 'town_id = $1';
}

/** Deletes the town's rows the world no longer carries, by their key. */
async function deleteMissing(
  client: PoolClient,
  table: string,
  key: readonly string[],
  townId: number,
  rows: ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) {
    await client.query(`DELETE FROM ${table} WHERE ${townScope(table)}`, [townId]);
    return;
  }

  const marks = rows.map(
    (_, index) => `(${key.map((__, offset) => `$${index * key.length + offset + 2}`).join(', ')})`,
  );
  const values = [townId, ...rows.flatMap((row) => key.map((column) => row[column]))];

  // Scoped to the town: the rows of another town are not this save's business.
  await client.query(
    `DELETE FROM ${table} WHERE ${townScope(table)} AND (${key.join(', ')}) NOT IN (${marks.join(', ')})`,
    values,
  );
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // A dead connection cannot roll back; the original failure is the one worth
    // reporting, and the pool drops the client.
  }
}

interface ChronicleRow {
  id: string | number;
  at: Date | string;
  type: string;
  payload: Record<string, unknown>;
}

interface PersonRow {
  id: string;
  player_id: string | null;
  person_name: string;
  title: number;
  residence_level: number;
  treasury_cents: number;
  debt_cents: number;
  favour: number;
  prestige: number;
  alive: boolean;
}

interface PersonWithRows extends PersonRow {
  /** The codes as the rows carry them: the words are the lists' to give. */
  workshops: Array<{ id: string | number; trade: number; level: number }>;
  stock: Array<{ good: number; units: number }>;
}

interface MessageRow {
  id: string | number;
  player_id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
}

function rowToChronicleEvent(row: ChronicleRow, worldStartedAt: Date): Event {
  return {
    ...row.payload,
    type: row.type,
    audience: 'town',
    at: hourAt(worldStartedAt, asDate(row.at)),
  } as Event;
}

function rowToMessage(row: MessageRow): Event {
  // A message has no town hour: the page orders by id, the prune by the write
  // instant, and no line reads `at`.
  return { ...row.payload, type: row.type, audience: { personId: 0 }, at: 0 } as Event;
}

interface ActionRow {
  id: string;
  person_id: string;
  plays_at: Date | string;
  type: string;
  payload: Record<string, unknown>;
  received_at: Date | string;
}

function rowToStoredAction(row: ActionRow, worldStartedAt: Date): StoredAction {
  return {
    id: Number(row.id),
    personId: Number(row.person_id),
    playsAt: hourAt(worldStartedAt, asDate(row.plays_at)),
    // The row already carries the type apart: the world reads one object.
    action: { ...row.payload, type: row.type } as Action,
    receivedAt: asDate(row.received_at),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The unique index over town names, and nothing else. */
function isTownNameViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== '23505') {
    return false;
  }

  const constraint = (error as { constraint?: unknown }).constraint;

  return constraint === 'towns_name_key';
}

/** A stored code back into the world's word: a code the list does not know is a bug, not a guess. */
function requiredTitle(code: number): TitleId {
  const title = titleOfCode(code);
  if (title === undefined) {
    throw new Error(`people: no degree carries the code ${code}`);
  }

  return title;
}

function requiredTrade(code: number): Trade {
  const trade = tradeOfCode(code);
  if (trade === undefined) {
    throw new Error(`workshops: no trade carries the code ${code}`);
  }

  return trade;
}

function requiredGood(code: number, where: string): GoodId {
  const good = goodOfCode(code);
  if (good === undefined) {
    throw new Error(`${where}: no good carries the code ${code}`);
  }

  return good;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
