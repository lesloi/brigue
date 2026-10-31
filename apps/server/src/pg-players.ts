import type { Pool } from 'pg';

import { HouseAlreadyBoundError, type Player, type PlayerStore } from './players.ts';

interface PlayerRow {
  token_hash: string;
  world_id: string;
  house_id: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
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
        `INSERT INTO players (token_hash, world_id, house_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [player.tokenHash, player.worldId, player.houseId, player.createdAt],
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
      `SELECT token_hash, world_id, house_id, created_at, revoked_at
       FROM players
       WHERE token_hash = $1`,
      [tokenHash],
    );

    const row = rows[0];

    return row ? rowToPlayer(row) : null;
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET revoked_at = $2
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, at],
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
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at),
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
