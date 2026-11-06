import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/migrations.ts';
import { PgPlayerStore } from '../src/pg-players.ts';
import type { Player } from '../src/players.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';

// Skips as a whole when there is no database to talk to, so `pnpm test` stays
// green without DATABASE_URL.
describe.runIf(databaseUrl !== '')('PgPlayerStore', () => {
  let pool: Pool;
  let store: PgPlayerStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
    store = new PgPlayerStore(pool);
  });

  afterEach(async () => {
    // Scoped to this file's world: the other Postgres tests share the database
    // and run in parallel.
    await pool.query('DELETE FROM players WHERE world_id = $1', ['pg-players']);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('moves the journal cursor forward and never back', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    await store.insert(player(tokenHash));

    // Act: a retried read may report an older cursor, and it must not rewind.
    await store.advanceCursor(tokenHash, 12);
    await store.advanceCursor(tokenHash, 7);

    // Assert
    const found = await store.findByTokenHash(tokenHash);
    expect(found?.cursorEventId).toBe(12);
  });
});

function player(tokenHash: string): Player {
  const at = new Date('2026-11-05T00:00:00.000Z');

  return {
    tokenHash,
    worldId: 'pg-players',
    houseId: 'leclerc',
    createdAt: at,
    lastSeenAt: at,
    revokedAt: null,
    cursorEventId: 0,
  };
}
