import type { Pool, PoolClient } from 'pg';

import type { Action, Event, World } from '@brigue/core';
import {
  DuplicateActionError,
  UnknownWorldError,
  type StoredAction,
  type WorldSession,
  type WorldSnapshot,
  type WorldStore,
} from './worlds.ts';

interface WorldRow {
  state: World;
  week_started_at: Date | string;
  last_events: Event[];
}

interface ActionRow {
  id: string;
  house_id: string;
  week: number;
  action: Action;
  received_at: Date | string;
}

/**
 * The world is one `jsonb` document behind a row lock. Catch-up turns a read
 * into a write, so the lock covers the whole callback: load, tick, save. `pg`
 * is imported lazily so the HTTP tests stay database-free.
 */
export class PgWorldStore implements WorldStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async createIfAbsent(id: string, world: World, weekStartedAt: Date, at: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO worlds (id, state, week_started_at, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, json(world), weekStartedAt, at],
    );
  }

  async withWorld<T>(id: string, run: (session: WorldSession) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<WorldRow>(
        `SELECT state, week_started_at, last_events
         FROM worlds
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const row = rows[0];
      if (!row) {
        throw new UnknownWorldError(id);
      }

      const result = await run(new PgWorldSession(client, id, row));
      await client.query('COMMIT');

      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A dead connection cannot roll back; the original failure is the one
        // worth reporting, and the pool drops the client.
      }
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
  private readonly worldId: string;

  constructor(client: PoolClient, worldId: string, row: WorldRow) {
    this.client = client;
    this.worldId = worldId;
    this.snapshot = {
      world: row.state,
      weekStartedAt: asDate(row.week_started_at),
      lastEvents: row.last_events,
    };
  }

  async actionsFor(week: number): Promise<StoredAction[]> {
    const { rows } = await this.client.query<ActionRow>(
      `SELECT id, house_id, week, action, received_at
       FROM actions
       WHERE world_id = $1 AND week = $2
       ORDER BY seq`,
      [this.worldId, week],
    );

    return rows.map(rowToStoredAction);
  }

  async findAction(id: string): Promise<StoredAction | null> {
    const { rows } = await this.client.query<ActionRow>(
      `SELECT id, house_id, week, action, received_at FROM actions WHERE id = $1`,
      [id],
    );
    const row = rows[0];

    return row ? rowToStoredAction(row) : null;
  }

  async append(action: StoredAction): Promise<void> {
    try {
      await this.client.query(
        `INSERT INTO actions (id, world_id, house_id, week, action, received_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [action.id, this.worldId, action.houseId, action.week, json(action.action), action.receivedAt],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateActionError(action.id);
      }
      throw error;
    }
  }

  async save(world: World, weekStartedAt: Date, lastEvents: Event[], at: Date): Promise<void> {
    await this.client.query(
      `UPDATE worlds
       SET state = $2, week_started_at = $3, last_events = $4, updated_at = $5
       WHERE id = $1`,
      [this.worldId, json(world), weekStartedAt, json(lastEvents), at],
    );
  }
}

export async function createPgWorldStore(connectionString: string): Promise<PgWorldStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgWorldStore(new PgPool({ connectionString }));
}

function rowToStoredAction(row: ActionRow): StoredAction {
  return {
    id: row.id,
    houseId: row.house_id,
    week: row.week,
    action: row.action,
    receivedAt: asDate(row.received_at),
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

/**
 * Explicit JSON text for every `jsonb` parameter. `pg` would serialise an object
 * on its own, but it turns a JS array into a Postgres array literal, which is
 * not valid jsonb (`last_events` is an array).
 */
function json(value: unknown): string {
  return JSON.stringify(value);
}
