import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations } from '../src/db/migrations.ts';
import { PgPlayerStore } from '../src/identity/pg-players.ts';
import type { Player } from '../src/identity/players.ts';

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
    await pool.query('DELETE FROM players WHERE town_id = $1', [900_001]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('schedules, cancels and erases a house', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const after = new Date('2026-12-01T00:00:00.000Z');
    const stored = await store.insert(player(tokenHash));

    // Act and assert: the assigned account id reads back as a number, and the
    // deadline is stored, cleared, then the rows go.
    expect(typeof stored.playerId).toBe('number');
    expect((await store.findByTokenHash(tokenHash))?.playerId).toBe(stored.playerId);
    expect((await store.findByTokenHash(tokenHash))?.townId).toBe(900_001);
    await store.markDeletion(tokenHash, after);
    expect((await store.findByTokenHash(tokenHash))?.deleteAfter).toEqual(after);
    await store.cancelDeletion(tokenHash);
    expect((await store.findByTokenHash(tokenHash))?.deleteAfter).toBeNull();
    await store.deleteHouse(900_001, 'leclerc');
    expect(await store.findByTokenHash(tokenHash)).toBeNull();
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

function player(tokenHash: string): Omit<Player, 'playerId'> {
  const at = new Date('2026-11-05T00:00:00.000Z');

  return {
    tokenHash,
    townId: 900_001,
    houseId: 'leclerc',
    createdAt: at,
    lastSeenAt: at,
    revokedAt: null,
    deleteAfter: null,
    cursorEventId: 0,
  };
}
