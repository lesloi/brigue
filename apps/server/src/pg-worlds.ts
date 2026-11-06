import type { ClientConfig, Pool, PoolClient } from 'pg';

import type { Action, Event, GoodId, Seat, SeatId, World } from '@brigue/core';
import { emptyTally, foldGrouped, type GroupedCount } from './journal.ts';
import {
  DuplicateActionError,
  UnknownWorldError,
  type JournalPage,
  type StoredAction,
  type TownInfo,
  type WorldSession,
  type WorldSnapshot,
  type WorldStore,
} from './worlds.ts';

interface StateRow {
  format_version: number;
  ruleset_version: number;
  seed: number;
  rng: number;
  hour: number;
  year: number;
  engagement_seq: number;
  hour_started_at: Date | string;
}

/**
 * The key of the join lock: one number for every server, so two instances
 * serialize their joins together. The value itself is arbitrary.
 */
const JOIN_LOCK_KEY = 0x62726967; // 'brig'

/**
 * The towns are the database: one row per thing, keyed by town, and each
 * town's `state` row is what the writer locks. The scheduler and the reader
 * both write, so the lock covers load, advance and save.
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

  async createTown(town: TownInfo, world: World, hourStartedAt: Date): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO towns (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
        town.id,
        town.name,
      ]);
      const { rowCount } = await client.query(
        `INSERT INTO state (town_id, format_version, ruleset_version, seed, rng, hour, year, engagement_seq, hour_started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (town_id) DO NOTHING`,
        [
          town.id,
          world.formatVersion,
          world.rulesetVersion,
          world.seed,
          world.rng,
          world.hour,
          world.year,
          world.engagementSeq,
          hourStartedAt,
        ],
      );

      if (rowCount === 1) {
        await writeWorld(client, town.id, world);
        await client.query(`INSERT INTO town_names (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [town.name]);
      }

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
    // the oldest breaks a tie.
    const { rows } = await this.pool.query<TownInfo>(
      `SELECT t.id, t.name
       FROM towns t
       LEFT JOIN houses h ON h.town_id = t.id
       GROUP BY t.id, t.name, t.created_at
       ORDER BY count(h.id), t.created_at, t.id`,
    );

    return rows;
  }

  async usedTownNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM town_names ORDER BY created_at, name`);

    return rows.map((row) => row.name);
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: string): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const snapshot = await readWorld(client, townId);
      const result = await run(new PgWorldSession(client, townId, snapshot));
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

class PgWorldSession implements WorldSession {
  readonly snapshot: WorldSnapshot;
  private readonly client: PoolClient;
  private readonly townId: string;

  constructor(client: PoolClient, townId: string, snapshot: WorldSnapshot) {
    this.client = client;
    this.townId = townId;
    this.snapshot = snapshot;
  }

  async actionsBetween(from: number, to: number): Promise<StoredAction[]> {
    const { rows } = await this.client.query(
      `SELECT id, house_id, plays_at, action, received_at, cancelled_at
       FROM actions
       WHERE town_id = $3 AND plays_at BETWEEN $1 AND $2 AND cancelled_at IS NULL
       ORDER BY plays_at, seq`,
      [from, to, this.townId],
    );

    return rows.map(rowToStoredAction);
  }

  async eventsSince(afterId: number, limit: number, houseId: string): Promise<JournalPage> {
    // House-visible in one place, so the page and its counts cannot disagree.
    const visible = `(audience = 'town' OR (audience = 'house' AND house_id = $2))`;
    const { rows } = await this.client.query(
      `SELECT id, at, audience, house_id, type, payload
       FROM events
       WHERE town_id = $4 AND id > $1 AND ${visible}
       ORDER BY id DESC
       LIMIT $3`,
      [afterId, houseId, limit, this.townId],
    );
    // The query walks back from the newest; the page reads forward in time.
    const newest = rows.slice().reverse();
    const events = newest.map(rowToEvent);
    const lastId = events.length === 0 ? afterId : Number(rows[0].id);
    const tally = emptyTally();

    if (newest.length > 0) {
      const oldest = Number(newest[0].id);
      const { rows: grouped } = await this.client.query(
        `SELECT type, payload->>'reason' AS reason, count(*)::int AS count
         FROM events
         WHERE town_id = $4 AND id > $1 AND id < $3 AND ${visible}
         GROUP BY type, payload->>'reason'`,
        [afterId, houseId, oldest, this.townId],
      );
      foldGrouped(tally, grouped.map(toGroupedCount));
    }

    return { events, lastId, ...tally };
  }

  async findAction(id: string): Promise<StoredAction | null> {
    // Scoped to the town: another town's house may carry the same id, and its
    // action must be as unknown here as an id that was never issued.
    const { rows } = await this.client.query(
      `SELECT id, house_id, plays_at, action, received_at, cancelled_at
       FROM actions
       WHERE id = $1 AND town_id = $2`,
      [id, this.townId],
    );
    const row = rows[0];

    return row ? rowToStoredAction(row) : null;
  }

  async append(action: StoredAction): Promise<void> {
    try {
      await this.client.query(
        `INSERT INTO actions (id, town_id, house_id, plays_at, action, received_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action.id, this.townId, action.houseId, action.playsAt, json(action.action), action.receivedAt],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateActionError(action.id);
      }
      throw error;
    }
  }

  async cancel(id: string, at: Date): Promise<void> {
    await this.client.query(
      `UPDATE actions
       SET cancelled_at = $2
       WHERE id = $1 AND town_id = $3 AND cancelled_at IS NULL`,
      [id, at, this.townId],
    );
  }

  async clear(): Promise<void> {
    // The town goes whole — its state, houses, actions and journal — and the
    // player rows and the sealed seasons, which live outside it, stay. Deleting
    // the town row cascades every town table.
    await this.client.query(`DELETE FROM towns WHERE id = $1`, [this.townId]);
  }

  async save(world: World, hourStartedAt: Date, events: Event[]): Promise<void> {
    await clearWorld(this.client, this.townId);
    await writeWorld(this.client, this.townId, world);
    await this.client.query(
      `UPDATE state SET hour = $2, year = $3, rng = $4, engagement_seq = $5, hour_started_at = $6
       WHERE town_id = $1`,
      [this.townId, world.hour, world.year, world.rng, world.engagementSeq, hourStartedAt],
    );
    await appendEvents(this.client, this.townId, events);
  }
}

export async function createPgWorldStore(connectionString: string): Promise<PgWorldStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgWorldStore(new PgPool({ connectionString }));
}

async function readWorld(client: PoolClient, townId: string): Promise<WorldSnapshot> {
  const town = await client.query<{ id: string; name: string }>(`SELECT id, name FROM towns WHERE id = $1`, [townId]);
  const townRow = town.rows[0];
  if (!townRow) {
    throw new UnknownWorldError();
  }

  const state = await client.query<StateRow>(
    `SELECT format_version, ruleset_version, seed, rng, hour, year, engagement_seq, hour_started_at
     FROM state
     WHERE town_id = $1
     FOR UPDATE`,
    [townId],
  );
  const row = state.rows[0];
  if (!row) {
    throw new UnknownWorldError();
  }

  const [houses, people, workshops, stock, seats, laws, engagements, campaigns, market, history] = await Promise.all([
    client.query(
      `SELECT id, name, controller, treasury_cents, debt_cents, favour, prestige, career, dormant FROM houses WHERE town_id = $1 ORDER BY id`,
      [townId],
    ),
    client.query(
      `SELECT id, house_id, name, age, artisanat, parole, intrigue, alive FROM people WHERE town_id = $1 ORDER BY id`,
      [townId],
    ),
    client.query(
      `SELECT house_id, position, good, level, workers FROM workshops WHERE town_id = $1 ORDER BY house_id, position`,
      [townId],
    ),
    client.query(`SELECT house_id, good, units FROM stock WHERE town_id = $1 ORDER BY house_id, good`, [townId]),
    client.query(`SELECT seat_id, person_id FROM seats WHERE town_id = $1 ORDER BY seat_id`, [townId]),
    client.query(
      `SELECT id, position, title, sponsor_house_id, enacted_at FROM laws WHERE town_id = $1 ORDER BY position`,
      [townId],
    ),
    client.query(`SELECT id, kind, house_id, due_at, position FROM engagements WHERE town_id = $1 ORDER BY position`, [
      townId,
    ]),
    client.query(
      `SELECT seat_id, house_id, closed, votes FROM campaigns WHERE town_id = $1 ORDER BY seat_id, house_id`,
      [townId],
    ),
    client.query(`SELECT good, price_cents, flow_units FROM market WHERE town_id = $1 ORDER BY good`, [townId]),
    client.query(`SELECT good, position, price_cents FROM market_history WHERE town_id = $1 ORDER BY good, position`, [
      townId,
    ]),
  ]);

  const world: World = {
    formatVersion: row.format_version,
    rulesetVersion: row.ruleset_version,
    seed: row.seed,
    rng: row.rng,
    hour: row.hour,
    year: row.year,
    houses: {},
    people: {},
    seats: {} as Record<SeatId, Seat>,
    laws: [],
    market: {} as Record<GoodId, number>,
    marketFlow: {},
    marketHistory: {},
    campaigns: {},
    closedCampaigns: {},
    engagements: [],
    engagementSeq: row.engagement_seq,
  };

  for (const house of houses.rows) {
    world.houses[house.id] = {
      id: house.id,
      name: house.name,
      controller: house.controller,
      treasuryCents: house.treasury_cents,
      debtCents: house.debt_cents,
      favour: house.favour,
      prestige: house.prestige,
      career: house.career,
      dormant: house.dormant,
      workshops: [],
      stock: {},
    };
  }

  for (const workshop of workshops.rows) {
    world.houses[workshop.house_id]?.workshops.push({
      good: workshop.good,
      level: workshop.level,
      workers: workshop.workers,
    });
  }

  for (const unit of stock.rows) {
    const house = world.houses[unit.house_id];
    if (house !== undefined) {
      house.stock[unit.good as GoodId] = unit.units;
    }
  }

  for (const person of people.rows) {
    world.people[person.id] = {
      id: person.id,
      houseId: person.house_id,
      name: person.name,
      age: person.age,
      attributes: {
        artisanat: person.artisanat,
        parole: person.parole,
        intrigue: person.intrigue,
      },
      alive: person.alive,
    };
  }

  for (const seat of seats.rows) {
    world.seats[seat.seat_id as SeatId] = { personId: seat.person_id };
  }

  for (const law of laws.rows) {
    world.laws.push({
      id: law.id,
      title: law.title,
      sponsorHouseId: law.sponsor_house_id,
      enactedAt: law.enacted_at,
    });
  }

  for (const engagement of engagements.rows) {
    world.engagements.push({
      id: engagement.id,
      kind: engagement.kind,
      houseId: engagement.house_id,
      dueAt: engagement.due_at,
    });
  }

  for (const campaign of campaigns.rows) {
    const map = campaign.closed ? world.closedCampaigns : world.campaigns;
    const byHouse = (map[campaign.seat_id as SeatId] ??= {});
    byHouse[campaign.house_id] = campaign.votes;
  }

  for (const good of market.rows) {
    world.market[good.good as GoodId] = good.price_cents;
    world.marketFlow[good.good as GoodId] = good.flow_units;
  }

  for (const point of history.rows) {
    world.marketHistory ??= {};
    const prices = (world.marketHistory[point.good as GoodId] ??= []);
    prices.push(point.price_cents);
  }

  return {
    town: { id: townRow.id, name: townRow.name },
    world,
    hourStartedAt: asDate(row.hour_started_at),
  };
}

/**
 * The town is small and written whole, so a save clears the tables and writes
 * them again: a house that disappeared, or a stock that fell to zero, cannot
 * leave a row behind the way an upsert would.
 */
async function clearWorld(client: PoolClient, townId: string): Promise<void> {
  await client.query(
    `DELETE FROM seats WHERE town_id = $1;
     DELETE FROM laws WHERE town_id = $1;
     DELETE FROM engagements WHERE town_id = $1;
     DELETE FROM campaigns WHERE town_id = $1;
     DELETE FROM stock WHERE town_id = $1;
     DELETE FROM workshops WHERE town_id = $1;
     DELETE FROM people WHERE town_id = $1;
     DELETE FROM market_history WHERE town_id = $1;
     DELETE FROM market WHERE town_id = $1;
     DELETE FROM houses WHERE town_id = $1;`,
    [townId],
  );
}

async function writeWorld(client: PoolClient, townId: string, world: World): Promise<void> {
  const houses = Object.values(world.houses).sort((left, right) => left.id.localeCompare(right.id));

  await insertRows(
    client,
    'houses',
    ['town_id', 'id', 'name', 'controller', 'treasury_cents', 'debt_cents', 'favour', 'prestige', 'career', 'dormant'],
    houses.map((house) => [
      townId,
      house.id,
      house.name,
      house.controller,
      house.treasuryCents,
      house.debtCents,
      house.favour,
      house.prestige,
      house.career,
      house.dormant,
    ]),
  );

  const people = Object.values(world.people).sort((left, right) => left.id.localeCompare(right.id));
  await insertRows(
    client,
    'people',
    ['town_id', 'id', 'house_id', 'name', 'age', 'artisanat', 'parole', 'intrigue', 'alive'],
    people.map((person) => [
      townId,
      person.id,
      person.houseId,
      person.name,
      person.age,
      person.attributes.artisanat,
      person.attributes.parole,
      person.attributes.intrigue,
      person.alive,
    ]),
  );

  await insertRows(
    client,
    'workshops',
    ['town_id', 'house_id', 'position', 'good', 'level', 'workers'],
    houses.flatMap((house) =>
      house.workshops.map((workshop, position) => [
        townId,
        house.id,
        position,
        workshop.good,
        workshop.level,
        workshop.workers,
      ]),
    ),
  );

  await insertRows(
    client,
    'stock',
    ['town_id', 'house_id', 'good', 'units'],
    houses.flatMap((house) => Object.entries(house.stock).map(([good, units]) => [townId, house.id, good, units ?? 0])),
  );

  await insertRows(
    client,
    'seats',
    ['town_id', 'seat_id', 'person_id'],
    Object.entries(world.seats).map(([seatId, seat]) => [townId, seatId, seat.personId]),
  );

  await insertRows(
    client,
    'laws',
    ['town_id', 'id', 'position', 'title', 'sponsor_house_id', 'enacted_at'],
    world.laws.map((law, position) => [townId, law.id, position, law.title, law.sponsorHouseId, law.enactedAt]),
  );

  await insertRows(
    client,
    'engagements',
    ['town_id', 'id', 'kind', 'house_id', 'due_at', 'position'],
    world.engagements.map((engagement, position) => [
      townId,
      engagement.id,
      engagement.kind,
      engagement.houseId,
      engagement.dueAt,
      position,
    ]),
  );

  await insertRows(
    client,
    'campaigns',
    ['town_id', 'seat_id', 'house_id', 'closed', 'votes'],
    [...campaignRows(world.campaigns, false), ...campaignRows(world.closedCampaigns, true)].map((row) => [
      townId,
      ...row,
    ]),
  );

  await insertRows(
    client,
    'market',
    ['town_id', 'good', 'price_cents', 'flow_units'],
    Object.entries(world.market).map(([good, price]) => [townId, good, price, world.marketFlow[good as GoodId] ?? 0]),
  );

  await insertRows(
    client,
    'market_history',
    ['town_id', 'good', 'position', 'price_cents'],
    Object.entries(world.marketHistory ?? {}).flatMap(([good, prices]) =>
      (prices ?? []).map((price, position) => [townId, good, position, price]),
    ),
  );
}

function campaignRows(campaigns: World['campaigns'], closed: boolean): [string, string, boolean, number][] {
  return Object.entries(campaigns).flatMap(([seatId, byHouse]) =>
    Object.entries(byHouse ?? {}).map(([houseId, votes]): [string, string, boolean, number] => [
      seatId,
      houseId,
      closed,
      votes,
    ]),
  );
}

async function appendEvents(client: PoolClient, townId: string, events: Event[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await insertRows(
    client,
    'events',
    ['town_id', 'at', 'audience', 'house_id', 'type', 'payload'],
    events.map((event) => {
      const { audience, at, type, ...body } = event;

      return [
        townId,
        at,
        typeof audience === 'string' ? audience : 'house',
        typeof audience === 'string' ? null : audience.houseId,
        type,
        json(body),
      ];
    }),
  );
}

async function insertRows(client: PoolClient, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const marks = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });

    return `(${marks.join(', ')})`;
  });

  await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, values);
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // A dead connection cannot roll back; the original failure is the one worth
    // reporting, and the pool drops the client.
  }
}

function rowToEvent(row: {
  id: string | number;
  at: number;
  audience: string;
  house_id: string | null;
  type: string;
  payload: Record<string, unknown>;
}): Event {
  const audience = row.audience === 'house' ? { houseId: row.house_id ?? '' } : row.audience;

  return { ...row.payload, type: row.type, audience, at: row.at } as Event;
}

function toGroupedCount(row: { type: string; reason: string | null; count: number | string }): GroupedCount {
  return { type: row.type, reason: row.reason, count: Number(row.count) };
}

function rowToStoredAction(row: {
  id: string;
  house_id: string;
  plays_at: number;
  action: Action;
  received_at: Date | string;
  cancelled_at: Date | string | null;
}): StoredAction {
  return {
    id: row.id,
    houseId: row.house_id,
    playsAt: row.plays_at,
    action: row.action,
    receivedAt: asDate(row.received_at),
    cancelledAt: row.cancelled_at === null ? null : asDate(row.cancelled_at),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as { code?: unknown }).code === '23505';
}

function json(value: unknown): string {
  return JSON.stringify(value);
}
