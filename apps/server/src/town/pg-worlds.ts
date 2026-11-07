import type { ClientConfig, Pool, PoolClient } from 'pg';

import { nameKey, residenceOf, titleOf } from '@brigue/core';
import type { Action, Engagement, Event, GoodId, Seat, SeatId, TitleId, Trade, World } from '@brigue/core';
import { emptyTally, foldGrouped, type GroupedCount } from './journal.ts';
import {
  DuplicateActionError,
  JOURNAL_PAGE,
  NameInUseError,
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
  workshop_seq: number;
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

  async createTown(name: string, world: World, hourStartedAt: Date): Promise<TownInfo> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(`INSERT INTO towns (name) VALUES ($1) RETURNING id`, [name]);
      const id = Number(rows[0]?.id);
      await client.query(
        `INSERT INTO state (town_id, format_version, ruleset_version, seed, rng, hour, year, engagement_seq, workshop_seq, hour_started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          world.formatVersion,
          world.rulesetVersion,
          world.seed,
          world.rng,
          world.hour,
          world.year,
          world.engagementSeq,
          world.workshopSeq ?? 0,
          hourStartedAt,
        ],
      );
      await writeWorld(client, id, world);

      await client.query('COMMIT');

      return { id, name };
    } catch (error) {
      await rollback(client);
      throw isNameViolation(error) ? new NameInUseError() : error;
    } finally {
      client.release();
    }
  }

  async listTowns(): Promise<TownInfo[]> {
    // Least filled first: the join takes the town that needs people most, and
    // the oldest breaks a tie.
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT t.id, t.name
       FROM towns t
       LEFT JOIN houses h ON h.town_id = t.id
       GROUP BY t.id, t.name, t.created_at
       ORDER BY count(h.id), t.created_at, t.id`,
    );

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  async listHumanNames(): Promise<string[]> {
    // Only human houses: the three AI houses carry the same names in every
    // town, and the partial index on the table is the same filter.
    const { rows } = await this.pool.query<{ name: string }>(
      `SELECT name FROM houses WHERE controller = 'human' ORDER BY name`,
    );

    return rows.map((row) => row.name);
  }

  async pruneJournal(townId: number, oldestKeptHour: number): Promise<void> {
    // The boundary is the id of the newest page's oldest entry; a journal with
    // fewer than a page has none, and `id < NULL` deletes nothing. The index on
    // (town_id, id) serves both the boundary and the walk back from the newest.
    await this.pool.query(
      `DELETE FROM events
       WHERE town_id = $1
         AND at < $2
         AND id < (
           SELECT id FROM events
           WHERE town_id = $1
           ORDER BY id DESC
           OFFSET $3
           LIMIT 1
         )`,
      [townId, oldestKeptHour, JOURNAL_PAGE - 1],
    );
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const snapshot = await readWorld(client, townId);
      const result = await run(new PgWorldSession(client, townId, snapshot.snapshot, snapshot.unkeyed));
      await client.query('COMMIT');

      return result;
    } catch (error) {
      await rollback(client);
      // The index over human names is the net behind the routes' check: a
      // second server that slipped a name in between is a refusal the screen
      // already knows, never a 500.
      throw isNameViolation(error) ? new NameInUseError() : error;
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
  private readonly townId: number;
  /** The names the read found without a key: its keys are then written here. */
  private readonly unkeyed: number;

  constructor(client: PoolClient, townId: number, snapshot: WorldSnapshot, unkeyed: number) {
    this.client = client;
    this.townId = townId;
    this.snapshot = snapshot;
    this.unkeyed = unkeyed;
  }

  /**
   * The keys of a town read from a schema before the column. The read carries
   * the names, and `writeWorld` writes every key; what a town read by an older
   * server left as `'legacy:…'` is replaced here, one statement, and only where
   * no human house already holds the key. The reservation is not a name, so
   * the second statement only fires for a town the old index never saw twice.
   */
  private async fillUnkeyedKeys(): Promise<void> {
    if (this.unkeyed === 0) {
      return;
    }

    await this.client.query(
      `UPDATE houses SET name_key = $2 || town_id || '-' || id WHERE town_id = $1 AND name_key = ''`,
      [this.townId, LEGACY_KEY_PREFIX],
    );
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

  async cancelHouse(houseId: string, at: Date): Promise<void> {
    await this.client.query(
      `UPDATE actions
       SET cancelled_at = $3
       WHERE town_id = $1 AND house_id = $2 AND cancelled_at IS NULL`,
      [this.townId, houseId, at],
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
    await this.fillUnkeyedKeys();
    await this.client.query(
      `UPDATE state SET hour = $2, year = $3, rng = $4, engagement_seq = $5, workshop_seq = $6, hour_started_at = $7
       WHERE town_id = $1`,
      [this.townId, world.hour, world.year, world.rng, world.engagementSeq, world.workshopSeq ?? 0, hourStartedAt],
    );
    await appendEvents(this.client, this.townId, events);
  }
}

export async function createPgWorldStore(connectionString: string): Promise<PgWorldStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgWorldStore(new PgPool({ connectionString }));
}

async function readWorld(client: PoolClient, townId: number): Promise<{ snapshot: WorldSnapshot; unkeyed: number }> {
  const town = await client.query<{ id: string; name: string }>(`SELECT id, name FROM towns WHERE id = $1`, [townId]);
  const townRow = town.rows[0];
  if (!townRow) {
    throw new UnknownWorldError();
  }

  const state = await client.query<StateRow>(
    `SELECT format_version, ruleset_version, seed, rng, hour, year, engagement_seq, workshop_seq, hour_started_at
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
      `SELECT id, name, name_key, controller, treasury_cents, debt_cents, favour, prestige, title, residence_level, career, dormant FROM houses WHERE town_id = $1 ORDER BY id`,
      [townId],
    ),
    client.query(
      `SELECT id, house_id, name, age, artisanat, parole, intrigue, alive FROM people WHERE town_id = $1 ORDER BY id`,
      [townId],
    ),
    client.query(`SELECT house_id, id, good, level FROM workshops WHERE town_id = $1 ORDER BY house_id, id`, [townId]),
    client.query(`SELECT house_id, good, units FROM stock WHERE town_id = $1 ORDER BY house_id, good`, [townId]),
    client.query(`SELECT seat_id, person_id FROM seats WHERE town_id = $1 ORDER BY seat_id`, [townId]),
    client.query(
      `SELECT id, position, title, sponsor_house_id, enacted_at FROM laws WHERE town_id = $1 ORDER BY position`,
      [townId],
    ),
    client.query(
      `SELECT id, kind, house_id, due_at, work, trade, workshop_id, position FROM engagements WHERE town_id = $1 ORDER BY position`,
      [townId],
    ),
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
    workshopSeq: row.workshop_seq,
  };

  let unkeyed = 0;

  for (const house of houses.rows) {
    world.houses[house.id] = {
      id: house.id,
      name: house.name,
      controller: house.controller,
      treasuryCents: house.treasury_cents,
      debtCents: house.debt_cents,
      favour: house.favour,
      prestige: house.prestige,
      title: house.title as TitleId,
      residenceLevel: house.residence_level,
      career: house.career,
      dormant: house.dormant,
      workshops: [],
      stock: {},
    };
    // A town read from a schema before the key: the migration reserved a key
    // no name can carry, and writing the town replaces it with the real one.
    if (house.name_key === '' || house.name_key.startsWith(LEGACY_KEY_PREFIX)) {
      unkeyed += 1;
    }
  }

  for (const workshop of workshops.rows) {
    world.houses[workshop.house_id]?.workshops.push({
      id: workshop.id,
      good: workshop.good,
      level: workshop.level,
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
    const base = { id: engagement.id, houseId: engagement.house_id, dueAt: engagement.due_at };

    if (engagement.kind === 'hearing') {
      world.engagements.push({ ...base, kind: 'hearing' });
      continue;
    }
    // A site of the ladder says what it is for; a site stored before the ladder
    // (ruleset 3 refuses the world anyway) has no work and is read as a house
    // site, which is the one the old engine could hold.
    world.engagements.push(siteOf(base, engagement.work, engagement.trade, engagement.workshop_id));
  }

  for (const campaign of campaigns.rows) {
    const map = campaign.closed ? world.closedCampaigns : world.campaigns;
    const byHouse = (map[campaign.seat_id as SeatId] ??= {});
    byHouse[campaign.house_id] = campaign.votes;
  }

  for (const good of market.rows) {
    world.market[good.good as GoodId] = good.price_cents;
    // The flow map is sparse — a good with no trade is absent from it, not
    // zeroed — so a town read back is the town that was written.
    if (good.flow_units !== 0) {
      world.marketFlow[good.good as GoodId] = good.flow_units;
    }
  }

  for (const point of history.rows) {
    world.marketHistory ??= {};
    const prices = (world.marketHistory[point.good as GoodId] ??= []);
    prices.push(point.price_cents);
  }

  return {
    snapshot: {
      town: { id: Number(townRow.id), name: townRow.name },
      world,
      hourStartedAt: asDate(row.hour_started_at),
    },
    unkeyed,
  };
}

/** What a town read before the column was written with: no name can equal it. */
const LEGACY_KEY_PREFIX = 'legacy:';

/**
 * A site row back into the world's union. The columns are nullable in the
 * table, so the reader is the one that decides what a missing `work` means.
 */
function siteOf(
  base: { id: string; houseId: string; dueAt: number },
  work: string | null,
  trade: string | null,
  workshopId: string | null,
): Engagement {
  switch (work) {
    case 'build':
      return { ...base, kind: 'site', work: 'build', trade: (trade ?? 'weaver') as Trade };
    case 'upgrade':
      return { ...base, kind: 'site', work: 'upgrade', workshopId: workshopId ?? '' };
    case 'title':
      return { ...base, kind: 'site', work: 'title' };
    default:
      return { ...base, kind: 'site', work: 'residence' };
  }
}

/**
 * The town is small and written whole, so a save clears the tables and writes
 * them again: a house that disappeared, or a stock that fell to zero, cannot
 * leave a row behind the way an upsert would.
 */
async function clearWorld(client: PoolClient, townId: number): Promise<void> {
  // One statement per table: a parameterised query is sent with the extended
  // protocol, which refuses several commands at once.
  await client.query('DELETE FROM seats WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM laws WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM engagements WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM campaigns WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM stock WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM workshops WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM people WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM market_history WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM market WHERE town_id = $1', [townId]);
  await client.query('DELETE FROM houses WHERE town_id = $1', [townId]);
}

async function writeWorld(client: PoolClient, townId: number, world: World): Promise<void> {
  const houses = Object.values(world.houses).sort((left, right) => left.id.localeCompare(right.id));

  await insertRows(
    client,
    'houses',
    [
      'town_id',
      'id',
      'name',
      'controller',
      'treasury_cents',
      'debt_cents',
      'favour',
      'prestige',
      'title',
      'residence_level',
      'career',
      'dormant',
      'name_key',
    ],
    houses.map((house) => [
      townId,
      house.id,
      house.name,
      house.controller,
      house.treasuryCents,
      house.debtCents,
      house.favour,
      house.prestige,
      titleOf(house),
      residenceOf(house),
      house.career,
      house.dormant,
      nameKey(house.name),
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
    ['town_id', 'house_id', 'position', 'id', 'good', 'level'],
    houses.flatMap((house) =>
      house.workshops.map((workshop, position) => [
        townId,
        house.id,
        position,
        workshop.id,
        workshop.good,
        workshop.level,
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
    ['town_id', 'id', 'kind', 'house_id', 'due_at', 'work', 'trade', 'workshop_id', 'position'],
    world.engagements.map((engagement, position) => [
      townId,
      engagement.id,
      engagement.kind,
      engagement.houseId,
      engagement.dueAt,
      engagement.kind === 'site' ? engagement.work : null,
      engagement.kind === 'site' && engagement.work === 'build' ? engagement.trade : null,
      engagement.kind === 'site' && engagement.work === 'upgrade' ? engagement.workshopId : null,
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

async function appendEvents(client: PoolClient, townId: number, events: Event[]): Promise<void> {
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

/** The partial index over the names of human houses, and nothing else. */
function isNameViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505' &&
    (error as { constraint?: unknown }).constraint === 'houses_human_name'
  );
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
