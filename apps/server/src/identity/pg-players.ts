import type { Pool } from 'pg';

import { HouseAlreadyBoundError, type Player, type PlayerStore } from './players.ts';

interface PlayerRow {
  token_hash: string;
  player_id: string;
  town_id: string | null;
  house_id: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
  delete_after: Date | string | null;
  // bigint: the driver hands it back as a string.
  cursor_event_id: string;
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

  async insert(player: Omit<Player, 'playerId'>): Promise<Player> {
    try {
      const { rows } = await this.pool.query<{ player_id: string }>(
        `INSERT INTO players (token_hash, town_id, house_id, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING player_id`,
        [player.tokenHash, player.townId, player.houseId, player.createdAt, player.lastSeenAt],
      );

      return { ...player, playerId: Number(rows[0]?.player_id) };
    } catch (error) {
      if (isLiveHouseViolation(error)) {
        throw new HouseAlreadyBoundError(player.townId, player.houseId);
      }
      throw error;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const { rows } = await this.pool.query<PlayerRow>(
      `SELECT token_hash, player_id, town_id, house_id, created_at, last_seen_at, revoked_at, delete_after, cursor_event_id
       FROM players
       WHERE token_hash = $1`,
      [tokenHash],
    );

    const row = rows[0];

    return row ? rowToPlayer(row) : null;
  }

  async rebind(tokenHash: string, townId: number, houseId: string, at: Date): Promise<Player | null> {
    try {
      const { rows } = await this.pool.query<PlayerRow>(
        `UPDATE players
         SET town_id = $2, house_id = $3, last_seen_at = GREATEST(last_seen_at, $4)
         WHERE token_hash = $1 AND town_id IS NULL AND house_id IS NULL AND revoked_at IS NULL
         RETURNING token_hash, player_id, town_id, house_id, created_at, last_seen_at, revoked_at, delete_after, cursor_event_id`,
        [tokenHash, townId, houseId, at],
      );

      const row = rows[0];

      return row ? rowToPlayer(row) : null;
    } catch (error) {
      if (isLiveHouseViolation(error)) {
        throw new HouseAlreadyBoundError(townId, houseId);
      }
      throw error;
    }
  }

  async advanceCursor(tokenHash: string, cursor: number): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET cursor_event_id = GREATEST(cursor_event_id, $2)
       WHERE token_hash = $1`,
      [tokenHash, cursor],
    );
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET revoked_at = $2, last_seen_at = GREATEST(last_seen_at, $2)
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, at],
    );
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET last_seen_at = GREATEST(last_seen_at, $2)
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash, at],
    );
  }

  async listByTown(townId: number): Promise<Player[]> {
    const { rows } = await this.pool.query<PlayerRow>(
      `SELECT token_hash, player_id, town_id, house_id, created_at, last_seen_at, revoked_at, delete_after, cursor_event_id
       FROM players
       WHERE town_id = $1
       ORDER BY created_at, token_hash`,
      [townId],
    );

    return rows.map(rowToPlayer);
  }

  async revokeHouse(townId: number, houseId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET revoked_at = $3
       WHERE town_id = $1 AND house_id = $2 AND revoked_at IS NULL`,
      [townId, houseId, at],
    );
  }

  async markDeletion(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE players
       SET delete_after = COALESCE(delete_after, $2)
       WHERE token_hash = $1`,
      [tokenHash, at],
    );
  }

  async cancelDeletion(tokenHash: string): Promise<void> {
    await this.pool.query('UPDATE players SET delete_after = NULL WHERE token_hash = $1', [tokenHash]);
  }

  async deleteHouse(townId: number, houseId: string): Promise<void> {
    await this.pool.query('DELETE FROM players WHERE town_id = $1 AND house_id = $2', [townId, houseId]);
  }

  async deleteUnboundDue(at: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM players
       WHERE house_id IS NULL AND delete_after IS NOT NULL AND delete_after <= $1`,
      [at],
    );

    return rowCount ?? 0;
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
    // bigint comes back as a string.
    playerId: Number(row.player_id),
    // Empty between a reset and the choice that gives the account a house.
    townId: row.town_id === null ? null : Number(row.town_id),
    houseId: row.house_id,
    createdAt: asDate(row.created_at),
    lastSeenAt: asDate(row.last_seen_at),
    revokedAt: row.revoked_at === null ? null : asDate(row.revoked_at),
    deleteAfter: row.delete_after === null ? null : asDate(row.delete_after),
    // bigint comes back as a string.
    cursorEventId: Number(row.cursor_event_id),
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
