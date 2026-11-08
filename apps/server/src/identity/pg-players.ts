import type { Pool } from 'pg';

import { DynastyAlreadyBoundError, type Player, type PlayerStore } from './players.ts';

interface PlayerRow {
  token_hash: string;
  player_id: string;
  town_id: string | null;
  dynasty_id: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  delete_after: Date | string | null;
}

/**
 * The account with the town of the dynasty it names. The account stores no town
 * of its own, and one left between towns names no dynasty, hence the left join.
 */
const SELECT_PLAYER = `SELECT p.token_hash, p.player_id, d.town_id, p.dynasty_id,
                              p.created_at, p.last_seen_at, p.delete_after
                       FROM players p
                       LEFT JOIN dynasties d ON d.id = p.dynasty_id`;

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
        `INSERT INTO players (token_hash, dynasty_id, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4)
         RETURNING player_id`,
        [player.tokenHash, player.dynastyId, player.createdAt, player.lastSeenAt],
      );

      return { ...player, playerId: Number(rows[0]?.player_id) };
    } catch (error) {
      if (isLiveDynastyViolation(error)) {
        throw new DynastyAlreadyBoundError(player.townId, player.dynastyId);
      }
      throw error;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const { rows } = await this.pool.query<PlayerRow>(
      `${SELECT_PLAYER}
       WHERE p.token_hash = $1`,
      [tokenHash],
    );

    const row = rows[0];

    return row ? rowToPlayer(row) : null;
  }

  async rebind(tokenHash: string, townId: number, dynastyId: string, at: Date): Promise<Player | null> {
    try {
      // The town is read back through the dynasty it names: the account no
      // longer stores a copy that could disagree with it.
      const { rows } = await this.pool.query<PlayerRow>(
        `UPDATE players p
         SET dynasty_id = $2, last_seen_at = GREATEST(p.last_seen_at, $3)
         WHERE p.token_hash = $1 AND p.dynasty_id IS NULL
         RETURNING p.token_hash, p.player_id,
                   (SELECT d.town_id FROM dynasties d WHERE d.id = p.dynasty_id) AS town_id,
                   p.dynasty_id, p.created_at, p.last_seen_at, p.delete_after`,
        [tokenHash, dynastyId, at],
      );

      const row = rows[0];

      return row ? rowToPlayer(row) : null;
    } catch (error) {
      if (isLiveDynastyViolation(error)) {
        throw new DynastyAlreadyBoundError(townId, dynastyId);
      }
      throw error;
    }
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE players SET last_seen_at = GREATEST(last_seen_at, $2) WHERE token_hash = $1`, [
      tokenHash,
      at,
    ]);
  }

  async listByTown(townId: number): Promise<Player[]> {
    const { rows } = await this.pool.query<PlayerRow>(
      `${SELECT_PLAYER}
       WHERE d.town_id = $1
       ORDER BY p.created_at, p.token_hash`,
      [townId],
    );

    return rows.map(rowToPlayer);
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

  async deleteDynasty(dynastyId: string): Promise<void> {
    await this.pool.query('DELETE FROM players WHERE dynasty_id = $1', [dynastyId]);
  }

  async deleteUnboundDue(at: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM players
       WHERE dynasty_id IS NULL AND delete_after IS NOT NULL AND delete_after <= $1`,
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
    // Empty between a reset and the choice that gives the account a dynasty.
    townId: row.town_id === null ? null : Number(row.town_id),
    dynastyId: row.dynasty_id,
    createdAt: asDate(row.created_at),
    lastSeenAt: asDate(row.last_seen_at),
    deleteAfter: row.delete_after === null ? null : asDate(row.delete_after),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isLiveDynastyViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { code, constraint } = error as { code?: unknown; constraint?: unknown };

  // A duplicate token_hash is a hash collision, not a second token on the
  // dynasty; let it surface as the bug it is.
  return code === '23505' && constraint === 'players_live_dynasty';
}
