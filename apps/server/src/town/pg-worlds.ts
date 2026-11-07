import type { ClientConfig, Pool, PoolClient } from 'pg';

import { nameKey, residenceOf, titleOf } from '@brigue/core';
import type { Action, Engagement, Event, GoodId, Seat, SeatId, TitleId, Trade, World } from '@brigue/core';
import {
  DuplicateActionError,
  JOURNAL_PAGE,
  NameInUseError,
  UnknownWorldError,
  type StoredAction,
  type MessagePage,
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
       LEFT JOIN dynasties h ON h.town_id = t.id
       GROUP BY t.id, t.name, t.created_at
       ORDER BY count(h.id), t.created_at, t.id`,
    );

    return rows.map((row) => ({ id: Number(row.id), name: row.name }));
  }

  async listHumanNames(): Promise<string[]> {
    // Only human dynasties: the three AI dynasties carry the same names in every
    // town, and the partial index on the table is the same filter.
    const { rows } = await this.pool.query<{ name: string }>(
      `SELECT name FROM dynasties WHERE controller = 'human' ORDER BY name`,
    );

    return rows.map((row) => row.name);
  }

  async pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    await this.pool.query(`DELETE FROM events WHERE town_id = $1 AND recorded_at < $2`, [townId, chronicleBefore]);
    // The mail has no town column: the thirty-day cut is the same for every
    // box, and a pass over any town may as well take what every box has aged out.
    await this.pool.query(`DELETE FROM messages WHERE recorded_at < $1`, [messagesBefore]);
  }

  async markMessagesRead(dynastyId: string): Promise<void> {
    await this.pool.query(`UPDATE messages SET read = true WHERE dynasty_id = $1 AND read = false`, [dynastyId]);
  }

  async deleteMessage(id: number, dynastyId: string): Promise<{ deleted: boolean; unread: number }> {
    // Scoped to the dynasty: an id from another box deletes nothing and says
    // nothing, so a bad guess is not an oracle.
    const { rowCount } = await this.pool.query(`DELETE FROM messages WHERE id = $1 AND dynasty_id = $2`, [
      id,
      dynastyId,
    ]);
    const counts = await this.pool.query<{ unread: number }>(
      `SELECT count(*) FILTER (WHERE read = false)::int AS unread FROM messages WHERE dynasty_id = $1`,
      [dynastyId],
    );

    return {
      deleted: (rowCount ?? 0) > 0,
      unread: Math.min(counts.rows[0]?.unread ?? 0, JOURNAL_PAGE),
    };
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
   * no human dynasty already holds the key. The reservation is not a name, so
   * the second statement only fires for a town the old index never saw twice.
   */
  private async fillUnkeyedKeys(): Promise<void> {
    if (this.unkeyed === 0) {
      return;
    }

    await this.client.query(
      `UPDATE dynasties SET name_key = $2 || town_id || '-' || id WHERE town_id = $1 AND name_key = ''`,
      [this.townId, LEGACY_KEY_PREFIX],
    );
  }

  async actionsBetween(from: number, to: number): Promise<StoredAction[]> {
    const { rows } = await this.client.query(
      `SELECT id, dynasty_id, plays_at, action, received_at, cancelled_at
       FROM actions
       WHERE town_id = $3 AND plays_at BETWEEN $1 AND $2 AND cancelled_at IS NULL
       ORDER BY plays_at, seq`,
      [from, to, this.townId],
    );

    return rows.map(rowToStoredAction);
  }

  async recentMessages(limit: number, dynastyId: string): Promise<MessagePage> {
    const { rows } = await this.client.query<MessageRow>(
      `SELECT id, dynasty_id, type, payload
       FROM messages
       WHERE dynasty_id = $2
       ORDER BY id DESC
       LIMIT $1`,
      [limit, dynastyId],
    );
    const counts = await this.client.query<{ unread: number }>(
      `SELECT count(*) FILTER (WHERE read = false)::int AS unread
       FROM messages
       WHERE dynasty_id = $1`,
      [dynastyId],
    );

    return {
      // The query walks back from the newest; the page reads forward in time.
      messages: rows
        .slice()
        .reverse()
        .map((row) => ({ id: Number(row.id), event: rowToMessage(row) })),
      // The badge names what the page can open, never a backlog below it.
      unread: Math.min(counts.rows[0]?.unread ?? 0, limit),
    };
  }

  async recentChronicle(limit: number): Promise<Event[]> {
    const { rows } = await this.client.query<ChronicleRow>(
      `SELECT id, at, audience, type, payload
       FROM events
       WHERE town_id = $2
       ORDER BY id DESC
       LIMIT $1`,
      [limit, this.townId],
    );

    return rows.slice().reverse().map(rowToChronicleEvent);
  }

  async findAction(id: string): Promise<StoredAction | null> {
    // Scoped to the town: another town's dynasty may carry the same id, and its
    // action must be as unknown here as an id that was never issued.
    const { rows } = await this.client.query(
      `SELECT id, dynasty_id, plays_at, action, received_at, cancelled_at
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
        `INSERT INTO actions (id, town_id, dynasty_id, plays_at, action, received_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action.id, this.townId, action.dynastyId, action.playsAt, json(action.action), action.receivedAt],
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

  async cancelDynasty(dynastyId: string, at: Date): Promise<void> {
    await this.client.query(
      `UPDATE actions
       SET cancelled_at = $3
       WHERE town_id = $1 AND dynasty_id = $2 AND cancelled_at IS NULL`,
      [this.townId, dynastyId, at],
    );
  }

  async clear(): Promise<void> {
    // The town goes whole — its state, dynasties, actions and journal — and the
    // player rows and the sealed seasons, which live outside it, stay. Deleting
    // the town row cascades every town table; the mail has no town column, so
    // its rows are named by the dynasties before they go.
    await this.client.query(`DELETE FROM messages WHERE dynasty_id IN (SELECT id FROM dynasties WHERE town_id = $1)`, [
      this.townId,
    ]);
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
    await appendChronicle(
      this.client,
      this.townId,
      events.filter((event) => event.audience === 'town'),
    );
    await appendMessages(
      this.client,
      this.townId,
      // A private line is written for a human dynasty only: an AI one has no
      // mailbox to read it in.
      events.filter((event) => {
        if (typeof event.audience !== 'object') {
          return false;
        }

        return world.dynasties[event.audience.dynastyId]?.controller === 'human';
      }),
    );
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

  const [dynasties, people, workshops, stock, seats, laws, engagements, campaigns, market, history] = await Promise.all(
    [
      client.query(
        `SELECT id, name, name_key, controller, treasury_cents, debt_cents, favour, prestige, title, residence_level, career, dormant FROM dynasties WHERE town_id = $1 ORDER BY id`,
        [townId],
      ),
      client.query(
        `SELECT id, dynasty_id, name, age, artisanat, parole, intrigue, alive FROM people WHERE town_id = $1 ORDER BY id`,
        [townId],
      ),
      client.query(`SELECT dynasty_id, id, good, level FROM workshops WHERE town_id = $1 ORDER BY dynasty_id, id`, [
        townId,
      ]),
      client.query(`SELECT dynasty_id, good, units FROM stock WHERE town_id = $1 ORDER BY dynasty_id, good`, [townId]),
      client.query(`SELECT seat_id, person_id FROM seats WHERE town_id = $1 ORDER BY seat_id`, [townId]),
      client.query(
        `SELECT id, position, title, sponsor_dynasty_id, enacted_at FROM laws WHERE town_id = $1 ORDER BY position`,
        [townId],
      ),
      client.query(
        `SELECT id, kind, dynasty_id, due_at, work, trade, workshop_id, position FROM engagements WHERE town_id = $1 ORDER BY position`,
        [townId],
      ),
      client.query(
        `SELECT seat_id, dynasty_id, closed, votes FROM campaigns WHERE town_id = $1 ORDER BY seat_id, dynasty_id`,
        [townId],
      ),
      client.query(`SELECT good, price_cents, flow_units FROM market WHERE town_id = $1 ORDER BY good`, [townId]),
      client.query(
        `SELECT good, position, price_cents FROM market_history WHERE town_id = $1 ORDER BY good, position`,
        [townId],
      ),
    ],
  );

  const world: World = {
    formatVersion: row.format_version,
    rulesetVersion: row.ruleset_version,
    seed: row.seed,
    rng: row.rng,
    hour: row.hour,
    year: row.year,
    dynasties: {},
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

  for (const dynasty of dynasties.rows) {
    world.dynasties[dynasty.id] = {
      id: dynasty.id,
      name: dynasty.name,
      controller: dynasty.controller,
      treasuryCents: dynasty.treasury_cents,
      debtCents: dynasty.debt_cents,
      favour: dynasty.favour,
      prestige: dynasty.prestige,
      title: dynasty.title as TitleId,
      residenceLevel: dynasty.residence_level,
      career: dynasty.career,
      dormant: dynasty.dormant,
      workshops: [],
      stock: {},
    };
    // A town read from a schema before the key: the migration reserved a key
    // no name can carry, and writing the town replaces it with the real one.
    if (dynasty.name_key === '' || dynasty.name_key.startsWith(LEGACY_KEY_PREFIX)) {
      unkeyed += 1;
    }
  }

  for (const workshop of workshops.rows) {
    world.dynasties[workshop.dynasty_id]?.workshops.push({
      id: workshop.id,
      good: workshop.good,
      level: workshop.level,
    });
  }

  for (const unit of stock.rows) {
    const dynasty = world.dynasties[unit.dynasty_id];
    if (dynasty !== undefined) {
      dynasty.stock[unit.good as GoodId] = unit.units;
    }
  }

  for (const person of people.rows) {
    world.people[person.id] = {
      id: person.id,
      dynastyId: person.dynasty_id,
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
      sponsorDynastyId: law.sponsor_dynasty_id,
      enactedAt: law.enacted_at,
    });
  }

  for (const engagement of engagements.rows) {
    const base = { id: engagement.id, dynastyId: engagement.dynasty_id, dueAt: engagement.due_at };

    if (engagement.kind === 'hearing') {
      world.engagements.push({ ...base, kind: 'hearing' });
      continue;
    }
    // A site of the ladder says what it is for; a site stored before the ladder
    // (ruleset 3 refuses the world anyway) has no work and is read as a dynasty
    // site, which is the one the old engine could hold.
    world.engagements.push(siteOf(base, engagement.work, engagement.trade, engagement.workshop_id));
  }

  for (const campaign of campaigns.rows) {
    const map = campaign.closed ? world.closedCampaigns : world.campaigns;
    const byDynasty = (map[campaign.seat_id as SeatId] ??= {});
    byDynasty[campaign.dynasty_id] = campaign.votes;
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
  base: { id: string; dynastyId: string; dueAt: number },
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
 * them again: a dynasty that disappeared, or a stock that fell to zero, cannot
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
  await client.query('DELETE FROM dynasties WHERE town_id = $1', [townId]);
}

async function writeWorld(client: PoolClient, townId: number, world: World): Promise<void> {
  const dynasties = Object.values(world.dynasties).sort((left, right) => left.id.localeCompare(right.id));

  await insertRows(
    client,
    'dynasties',
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
    dynasties.map((dynasty) => [
      townId,
      dynasty.id,
      dynasty.name,
      dynasty.controller,
      dynasty.treasuryCents,
      dynasty.debtCents,
      dynasty.favour,
      dynasty.prestige,
      titleOf(dynasty),
      residenceOf(dynasty),
      dynasty.career,
      dynasty.dormant,
      nameKey(dynasty.name),
    ]),
  );

  const people = Object.values(world.people).sort((left, right) => left.id.localeCompare(right.id));
  await insertRows(
    client,
    'people',
    ['town_id', 'id', 'dynasty_id', 'name', 'age', 'artisanat', 'parole', 'intrigue', 'alive'],
    people.map((person) => [
      townId,
      person.id,
      person.dynastyId,
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
    ['town_id', 'dynasty_id', 'position', 'id', 'good', 'level'],
    dynasties.flatMap((dynasty) =>
      dynasty.workshops.map((workshop, position) => [
        townId,
        dynasty.id,
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
    ['town_id', 'dynasty_id', 'good', 'units'],
    dynasties.flatMap((dynasty) =>
      Object.entries(dynasty.stock).map(([good, units]) => [townId, dynasty.id, good, units ?? 0]),
    ),
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
    ['town_id', 'id', 'position', 'title', 'sponsor_dynasty_id', 'enacted_at'],
    world.laws.map((law, position) => [townId, law.id, position, law.title, law.sponsorDynastyId, law.enactedAt]),
  );

  await insertRows(
    client,
    'engagements',
    ['town_id', 'id', 'kind', 'dynasty_id', 'due_at', 'work', 'trade', 'workshop_id', 'position'],
    world.engagements.map((engagement, position) => [
      townId,
      engagement.id,
      engagement.kind,
      engagement.dynastyId,
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
    ['town_id', 'seat_id', 'dynasty_id', 'closed', 'votes'],
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
  return Object.entries(campaigns).flatMap(([seatId, byDynasty]) =>
    Object.entries(byDynasty ?? {}).map(([dynastyId, votes]): [string, string, boolean, number] => [
      seatId,
      dynastyId,
      closed,
      votes,
    ]),
  );
}

async function appendChronicle(client: PoolClient, townId: number, events: Event[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await insertRows(
    client,
    'events',
    ['town_id', 'at', 'audience', 'type', 'payload'],
    events.map((event) => {
      const { audience, at, type, ...body } = event;

      return [townId, at, audience, type, json(body)];
    }),
  );
}

async function appendMessages(client: PoolClient, townId: number, events: Event[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await insertRows(
    client,
    'messages',
    ['dynasty_id', 'type', 'payload'],
    events.map((event) => {
      // The caller kept only the dynasty-addressed events.
      const dynastyId = typeof event.audience === 'object' ? event.audience.dynastyId : '';

      return [dynastyId, event.type, json(messageBody(event))];
    }),
  );
}

/** The payload of a message: the event minus what the row already carries. */
function messageBody(event: Event): Record<string, unknown> {
  const body = { ...event } as Record<string, unknown>;
  delete body.audience;
  delete body.at;
  delete body.type;

  return body;
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

interface ChronicleRow {
  id: string | number;
  at: number;
  audience: string;
  type: string;
  payload: Record<string, unknown>;
}

interface MessageRow {
  id: string | number;
  dynasty_id: string;
  type: string;
  payload: Record<string, unknown>;
}

function rowToChronicleEvent(row: ChronicleRow): Event {
  return { ...row.payload, type: row.type, audience: 'town', at: row.at } as Event;
}

function rowToMessage(row: MessageRow): Event {
  // A message has no town hour: the page orders by id, the prune by the write
  // instant, and no line reads `at`.
  return { ...row.payload, type: row.type, audience: { dynastyId: row.dynasty_id }, at: 0 } as Event;
}

function rowToStoredAction(row: {
  id: string;
  dynasty_id: string;
  plays_at: number;
  action: Action;
  received_at: Date | string;
  cancelled_at: Date | string | null;
}): StoredAction {
  return {
    id: row.id,
    dynastyId: row.dynasty_id,
    playsAt: row.plays_at,
    action: row.action,
    receivedAt: asDate(row.received_at),
    cancelledAt: row.cancelled_at === null ? null : asDate(row.cancelled_at),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The partial index over the names of human dynasties, and nothing else. */
function isNameViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505' &&
    (error as { constraint?: unknown }).constraint === 'dynasties_human_name'
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
