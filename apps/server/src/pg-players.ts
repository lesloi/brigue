import type { Pool } from 'pg';

import { HouseAlreadyBoundError, type Player, type PlayerStore } from './players.ts';

interface PlayerRow {
  token_hash: string;
  world_id: string;
  house_id: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  cursor_event_id: number;
}

/**
 * The binding lives in Postgres, outside the world. `pg` is imported lazily so
 * the auth tests run without a database or the driver's side effects.
 */
export class PgPlayerStore implements PlayerStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(player: Player): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO players (token_hash, world_id, house_id, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [player.tokenHash, player.worldId, player.houseId, player.createdAt, player.lastSeenAt],
      );
    } catch (error) {
      if (isLiveHouseViolation(error)) {
        throw new HouseAlreadyBoundError(player.worldId, player.houseId);
      }
      throw error;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const { rows } = await this.pool.query<PlayerRow>(
      `SELECT token_hash, world_id, house_id, created_at, last_seen_at, revoked_at, cursor_event_id
       FROM players
       WHERE token_hash = $1`,
      [tokenHash],
    );

    const row = rows[0];

    return row ? rowToPlayer(row) : null;
  }

  async advanceCursor(tokenHash: string, cursor: number): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET cursor_event_id = GREATEST(cursor_event_id, $2)
       WHERE token_hash = `,
      [tokenHash, cursor],
    );
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET revoked_at = $2, last_seen_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, at],
    );
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET last_seen_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, at],
    );
  }

  async listByWorld(worldId: string): Promise<Player[]> {
    const { rows } = await this.pool.query<PlayerRow>(
      `SELECT token_hash, world_id, house_id, created_at, last_seen_at, revoked_at, cursor_event_id
       FROM players
       WHERE world_id = $1
       ORDER BY created_at, token_hash`,
      [worldId],
    );

    return rows.map(rowToPlayer);
  }

  async revokeHouse(worldId: string, houseId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET revoked_at = $3
       WHERE world_id = $1 AND house_id = $2 AND revoked_at IS NULL`,
      [worldId, houseId, at],
    );
  }

  /** Readiness only: one round trip proves the pool can still reach its server. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function createPgPlayerStore(connectionString: string): Promise<PgPlayerStore> {
  const { Pool: PgPool } = await import('pg');

  return new PgPlayerStore(new PgPool({ connectionString }));
}

function rowToPlayer(row: PlayerRow): Player {
  return {
    tokenHash: row.token_hash,
    worldId: row.world_id,
    houseId: row.house_id,
    createdAt: asDate(row.created_at),
    lastSeenAt: asDate(row.last_seen_at),
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at),
    cursorEventId: row.cursor_event_id,
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isLiveHouseViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { code, constraint } = error as { code?: unknown; constraint?: unknown };

  // A duplicate token_hash is a hash collision, not a second token on the
  // house; let it surface as the bug it is.
  return code === '23505' && constraint === 'players_live_house';
}
