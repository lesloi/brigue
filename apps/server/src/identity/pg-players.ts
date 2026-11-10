import type { Pool } from 'pg';

import { PersonAlreadyBoundError, type Player, type PlayerStore } from './players.ts';
import { NameInUseError } from '../town/worlds.ts';

interface PlayerRow {
  token_hash: string;
  player_id: string;
  name: string;
  town_id: string | null;
  person_id: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  delete_after: Date | string | null;
}

/**
 * The account with the town and person it plays. The account stores no town of
 * its own; the person points back at it through `people.player_id`, hence the
 * left join.
 */
const SELECT_PLAYER = `SELECT p.token_hash, p.player_id, p.name, pe.town_id, pe.id AS person_id,
                              p.created_at, p.last_seen_at, p.delete_after
                       FROM players p
                       LEFT JOIN people pe ON pe.player_id = p.player_id`;

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
        `INSERT INTO players (token_hash, name, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4)
         RETURNING player_id`,
        [player.tokenHash, player.name, player.createdAt, player.lastSeenAt],
      );

      return { ...player, playerId: Number(rows[0]?.player_id) };
    } catch (error) {
      if (isNameViolation(error)) {
        throw new NameInUseError();
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

  async rebind(tokenHash: string, townId: number, personId: number, at: Date): Promise<Player | null> {
    try {
      // The person is the only row that carries the binding: an account binds
      // once, to a person no account holds. A person already written for this
      // account — the join does that at creation — matches too, so the call is
      // a confirmation there, and a person another account holds matches
      // nothing, which is what a refusal looks like.
      const bound = await this.pool.query(
        `UPDATE people pe
         SET player_id = p.player_id
         FROM players p
         WHERE p.token_hash = $1 AND pe.id = $2 AND pe.town_id = $3
           AND (pe.player_id IS NULL OR pe.player_id = p.player_id)
           AND NOT EXISTS (
             SELECT 1 FROM people own WHERE own.player_id = p.player_id AND own.id <> pe.id
           )
         RETURNING pe.id`,
        [tokenHash, personId, townId],
      );

      if ((bound.rowCount ?? 0) === 0) {
        return null;
      }

      await this.pool.query(`UPDATE players SET last_seen_at = GREATEST(last_seen_at, $2) WHERE token_hash = $1`, [
        tokenHash,
        at,
      ]);

      return this.findByTokenHash(tokenHash);
    } catch (error) {
      if (isPersonViolation(error)) {
        throw new PersonAlreadyBoundError(personId);
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
       WHERE pe.town_id = $1
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

  async deleteAccount(playerId: number): Promise<void> {
    // The keys do it all: the person follows the account, and its workshops,
    // stock, candidacies, actions, seats and mailbox follow the person or the
    // account itself.
    await this.pool.query('DELETE FROM players WHERE player_id = $1', [playerId]);
  }

  async eraseAccount(tokenHash: string): Promise<void> {
    // A join that failed may have written the person before it knew the place
    // would not land: the account's key takes the person and the mail with it.
    await this.pool.query('DELETE FROM players WHERE token_hash = $1', [tokenHash]);
  }

  async deleteUnboundDue(at: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM players p
       WHERE NOT EXISTS (SELECT 1 FROM people pe WHERE pe.player_id = p.player_id)
         AND p.delete_after IS NOT NULL
         AND p.delete_after <= $1`,
      [at],
    );

    return rowCount ?? 0;
  }

  async listNames(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM players ORDER BY name`);

    return rows.map((row) => row.name);
  }

  async renameName(tokenHash: string, name: string): Promise<void> {
    try {
      await this.pool.query('UPDATE players SET name = $2 WHERE token_hash = $1', [tokenHash, name]);
    } catch (error) {
      if (isNameViolation(error)) {
        throw new NameInUseError();
      }
      throw error;
    }
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
    name: row.name,
    // Empty between a reset and the choice that gives the account a person.
    townId: row.town_id === null ? null : Number(row.town_id),
    personId: row.person_id === null ? null : Number(row.person_id),
    createdAt: asDate(row.created_at),
    lastSeenAt: asDate(row.last_seen_at),
    deleteAfter: row.delete_after === null ? null : asDate(row.delete_after),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isNameViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { code, constraint } = error as { code?: unknown; constraint?: unknown };

  return code === '23505' && constraint === 'players_family_name';
}

function isPersonViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const { code, constraint } = error as { code?: unknown; constraint?: unknown };

  return code === '23505' && constraint === 'people_player_id_key';
}
