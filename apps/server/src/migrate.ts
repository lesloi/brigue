import type { Pool } from 'pg';

/**
 * One step from a format to the next. The world is read and written as data,
 * not as this image's `World`: a migration carries a shape the current code
 * cannot type, which is exactly why it exists.
 */
export type WorldMigration = (world: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations by source format, applied one format at a time. A format with no
 * entry is not migrated and must not be deleted in silence: the caller stops
 * and asks for an explicit reset. The first real migration lands here with its
 * own test; format 1 has none, it is the reset this release ships.
 */
export const MIGRATIONS: Partial<Record<number, WorldMigration>> = {};

export interface MigrationReport {
  /** Worlds moved to the target format. */
  migrated: string[];
  /** Worlds with no migration to the target: a reset has to be confirmed. */
  resetRequired: string[];
  /** Worlds written by a newer format than the target; left alone. */
  newer: string[];
}

export interface MigrationOptions {
  /**
   * Delete the worlds that have no migration. Only an operator who has read the
   * warning passes this; the default refuses and leaves everything in place.
   */
  reset?: boolean;
}

/**
 * Moves every world to `targetFormat`, or reports the ones that cannot be
 * moved. The worlds are locked for the whole run. Without `reset`, a world
 * with no migration aborts the run untouched; with it, those worlds and their
 * tokens are deleted. A newer world is never downgraded.
 */
export async function migrateOldFormats(
  pool: Pool,
  targetFormat: number,
  options: MigrationOptions = {},
): Promise<MigrationReport> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{
      id: string;
      state: Record<string, unknown>;
      format_version: string | null;
    }>(
      `SELECT id, state, state->>'formatVersion' AS format_version
       FROM worlds
       FOR UPDATE`,
    );

    const report: MigrationReport = { migrated: [], resetRequired: [], newer: [] };
    const moved: Array<{ id: string; state: Record<string, unknown> }> = [];

    for (const row of rows) {
      const from = Number(row.format_version);

      if (!Number.isInteger(from) || from < 1) {
        report.resetRequired.push(row.id);
        continue;
      }
      if (from > targetFormat) {
        report.newer.push(row.id);
        continue;
      }
      if (from === targetFormat) {
        continue;
      }

      let state = row.state;
      let format = from;
      let converted = true;

      while (format < targetFormat) {
        const step = MIGRATIONS[format];
        if (step === undefined) {
          converted = false;
          break;
        }
        const next = step(state);
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
          converted = false;
          break;
        }
        // The step migrates the shape; the format number is the engine's to
        // stamp, so a step that forgets it cannot leave the world looping.
        state = { ...next, formatVersion: format + 1 };
        format += 1;
      }

      if (converted) {
        report.migrated.push(row.id);
        moved.push({ id: row.id, state });
      } else {
        report.resetRequired.push(row.id);
      }
    }

    if (report.resetRequired.length > 0 && options.reset !== true) {
      // Nothing is committed: the operator must read the report and ask again.
      await client.query('ROLLBACK');
      return report;
    }

    for (const item of moved) {
      await client.query(
        `UPDATE worlds
         SET state = $2, updated_at = now()
         WHERE id = $1`,
        [item.id, JSON.stringify(item.state)],
      );
    }

    if (report.resetRequired.length > 0) {
      // The players foreign key does not cascade, and a token must not outlive
      // its house. Actions do cascade from the world.
      await client.query('DELETE FROM players WHERE world_id = ANY($1::text[])', [report.resetRequired]);
      await client.query('DELETE FROM worlds WHERE id = ANY($1::text[])', [report.resetRequired]);
    }

    await client.query('COMMIT');

    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
