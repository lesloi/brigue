import type { Pool, PoolClient } from 'pg';

import type { Action, Event, GoodId, Seat, SeatId, World } from '@brigue/core';
import {
  DuplicateActionError,
  UnknownWorldError,
  type StoredAction,
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
 * The town is the database: one row per thing, no world id, and the `state` row
 * is what the writer locks. The scheduler and the reader both write, so the
 * lock covers load, advance and save.
 *
 * `pg` is imported lazily so the HTTP tests stay database-free.
 */
export class PgWorldStore implements WorldStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async createIfAbsent(world: World, hourStartedAt: Date, at: Date): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `INSERT INTO state (id, format_version, ruleset_version, seed, rng, hour, year, engagement_seq, hour_started_at)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
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
        await writeWorld(client, world);
      }

      await client.query('COMMIT');
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }

    void at;
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const snapshot = await readWorld(client);
      const result = await run(new PgWorldSession(client, snapshot));
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {}
}

class PgWorldSession implements WorldSession {
  readonly snapshot: WorldSnapshot;
  private readonly client: PoolClient;

  constructor(client: PoolClient, snapshot: WorldSnapshot) {
    this.client = client;
    this.snapshot = snapshot;
  }

  async actionsBetween(from: number, to: number): Promise<StoredAction[]> {
    const { rows } = await this.client.query(
      `SELECT id, house_id, plays_at, action, received_at, cancelled_at
       FROM actions
       WHERE plays_at BETWEEN $1 AND $2 AND cancelled_at IS NULL
       ORDER BY plays_at, seq`,
      [from, to],
    );

    return rows.map(rowToStoredAction);
  }

  async findAction(id: string): Promise<StoredAction | null> {
    const { rows } = await this.client.query(
      `SELECT id, house_id, plays_at, action, received_at, cancelled_at FROM actions WHERE id = $1`,
      [id],
    );
    const row = rows[0];

    return row ? rowToStoredAction(row) : null;
  }

  async append(action: StoredAction): Promise<void> {
    try {
      await this.client.query(
        `INSERT INTO actions (id, house_id, plays_at, action, received_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [action.id, action.houseId, action.playsAt, json(action.action), action.receivedAt],
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
       WHERE id = $1 AND cancelled_at IS NULL`,
      [id, at],
    );
  }

  async save(world: World, hourStartedAt: Date, events: Event[]): Promise<void> {
    await clearWorld(this.client);
    await writeWorld(this.client, world);
    await this.client.query(
      `UPDATE state SET hour = $1, year = $2, rng = $3, engagement_seq = $4, hour_started_at = $5
       WHERE id = 1`,
      [world.hour, world.year, world.rng, world.engagementSeq, hourStartedAt],
    );
    await appendEvents(this.client, events);
  }
}

export async function createPgWorldStore(connectionString: string): Promise<PgWorldStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgWorldStore(new PgPool({ connectionString }));
}

async function readWorld(client: PoolClient): Promise<WorldSnapshot> {
  const state = await client.query<StateRow>(
    `SELECT format_version, ruleset_version, seed, rng, hour, year, engagement_seq, hour_started_at
     FROM state
     WHERE id = 1
     FOR UPDATE`,
  );
  const row = state.rows[0];
  if (!row) {
    throw new UnknownWorldError();
  }

  const [houses, people, workshops, stock, seats, laws, engagements, campaigns, market, history] = await Promise.all([
    client.query(
      `SELECT id, name, controller, treasury_cents, debt_cents, favour, prestige, career, dormant FROM houses ORDER BY id`,
    ),
    client.query(`SELECT id, house_id, name, age, artisanat, parole, intrigue, alive FROM people ORDER BY id`),
    client.query(`SELECT house_id, position, good, level, workers FROM workshops ORDER BY house_id, position`),
    client.query(`SELECT house_id, good, units FROM stock ORDER BY house_id, good`),
    client.query(`SELECT seat_id, person_id FROM seats ORDER BY seat_id`),
    client.query(`SELECT id, position, title, sponsor_house_id, enacted_at FROM laws ORDER BY position`),
    client.query(`SELECT id, kind, house_id, due_at, position FROM engagements ORDER BY position`),
    client.query(`SELECT seat_id, house_id, closed, votes FROM campaigns ORDER BY seat_id, house_id`),
    client.query(`SELECT good, price_cents, flow_units FROM market ORDER BY good`),
    client.query(`SELECT good, position, price_cents FROM market_history ORDER BY good, position`),
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

  return { world, hourStartedAt: asDate(row.hour_started_at) };
}

/**
 * The town is small and written whole, so a save clears the tables and writes
 * them again: a house that disappeared, or a stock that fell to zero, cannot
 * leave a row behind the way an upsert would.
 */
async function clearWorld(client: PoolClient): Promise<void> {
  await client.query(
    `DELETE FROM seats;
     DELETE FROM laws;
     DELETE FROM engagements;
     DELETE FROM campaigns;
     DELETE FROM stock;
     DELETE FROM workshops;
     DELETE FROM people;
     DELETE FROM market_history;
     DELETE FROM market;
     DELETE FROM houses;`,
  );
}

async function writeWorld(client: PoolClient, world: World): Promise<void> {
  const houses = Object.values(world.houses).sort((left, right) => left.id.localeCompare(right.id));

  await insertRows(
    client,
    'houses',
    ['id', 'name', 'controller', 'treasury_cents', 'debt_cents', 'favour', 'prestige', 'career', 'dormant'],
    houses.map((house) => [
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
    ['id', 'house_id', 'name', 'age', 'artisanat', 'parole', 'intrigue', 'alive'],
    people.map((person) => [
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
    ['house_id', 'position', 'good', 'level', 'workers'],
    houses.flatMap((house) =>
      house.workshops.map((workshop, position) => [
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
    ['house_id', 'good', 'units'],
    houses.flatMap((house) => Object.entries(house.stock).map(([good, units]) => [house.id, good, units ?? 0])),
  );

  await insertRows(
    client,
    'seats',
    ['seat_id', 'person_id'],
    Object.entries(world.seats).map(([seatId, seat]) => [seatId, seat.personId]),
  );

  await insertRows(
    client,
    'laws',
    ['id', 'position', 'title', 'sponsor_house_id', 'enacted_at'],
    world.laws.map((law, position) => [law.id, position, law.title, law.sponsorHouseId, law.enactedAt]),
  );

  await insertRows(
    client,
    'engagements',
    ['id', 'kind', 'house_id', 'due_at', 'position'],
    world.engagements.map((engagement, position) => [
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
    ['seat_id', 'house_id', 'closed', 'votes'],
    [...campaignRows(world.campaigns, false), ...campaignRows(world.closedCampaigns, true)],
  );

  await insertRows(
    client,
    'market',
    ['good', 'price_cents', 'flow_units'],
    Object.entries(world.market).map(([good, price]) => [good, price, world.marketFlow[good as GoodId] ?? 0]),
  );

  await insertRows(
    client,
    'market_history',
    ['good', 'position', 'price_cents'],
    Object.entries(world.marketHistory ?? {}).flatMap(([good, prices]) =>
      (prices ?? []).map((price, position) => [good, position, price]),
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

async function appendEvents(client: PoolClient, events: Event[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await insertRows(
    client,
    'events',
    ['at', 'audience', 'house_id', 'type', 'payload'],
    events.map((event) => {
      const { audience, at, type, ...body } = event;

      return [
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
