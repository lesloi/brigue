import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applySchema } from '../src/db/migrations.ts';
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
    await applySchema(pool);
    store = new PgPlayerStore(pool);
  });

  afterEach(async () => {
    // Scoped to this file's tokens: the other Postgres tests share the database
    // and run in parallel, and the account no longer names a town to scope by.
    await pool.query('DELETE FROM players WHERE token_hash = ANY($1)', [
      ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('schedules, cancels and erases a dynasty', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const after = new Date('2026-12-01T00:00:00.000Z');
    const stored = await store.insert(player(tokenHash));

    // Act and assert: the assigned account id reads back as a number, and the
    // deadline is stored, cleared, then the rows go.
    expect(typeof stored.playerId).toBe('number');
    expect((await store.findByTokenHash(tokenHash))?.playerId).toBe(stored.playerId);
    await store.markDeletion(tokenHash, after);
    expect((await store.findByTokenHash(tokenHash))?.deleteAfter).toEqual(after);
    await store.cancelDeletion(tokenHash);
    expect((await store.findByTokenHash(tokenHash))?.deleteAfter).toBeNull();
    await store.deleteDynasty('leclerc');
    expect(await store.findByTokenHash(tokenHash)).toBeNull();
  });

  it('binds an account a reset left without a dynasty, and only once', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const at = new Date('2026-12-02T00:00:00.000Z');
    await store.insert({ ...player(tokenHash), townId: null, dynastyId: null });

    // Act
    const rebound = await store.rebind(tokenHash, 900_001, 'leclerc', at);

    // Assert: the dynasty is back and the visit is now, so the new dynasty is not
    // measured from the old silence.
    expect(rebound).toMatchObject({ dynastyId: 'leclerc' });
    expect(rebound?.lastSeenAt).toEqual(at);
    expect(await store.rebind(tokenHash, 900_001, 'herse', at)).toBeNull();
    expect((await store.findByTokenHash(tokenHash))?.dynastyId).toBe('leclerc');
  });

  it('never binds an account whose deadline has erased it', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const at = new Date('2026-12-02T00:00:00.000Z');
    await store.insert({ ...player(tokenHash), townId: null, dynastyId: null });
    await store.markDeletion(tokenHash, at);
    await store.deleteUnboundDue(at);

    // Act / Assert
    expect(await store.rebind(tokenHash, 900_001, 'leclerc', at)).toBeNull();
  });

  it('erases the dynasty-less accounts whose deadline passed, and only those', async () => {
    // Arrange: one due, one later, one bound and due (a town's sweep owns it).
    const at = new Date('2026-12-10T00:00:00.000Z');
    const due = 'a'.repeat(64);
    const later = 'b'.repeat(64);
    const bound = 'c'.repeat(64);
    await store.insert({ ...player(due), townId: null, dynastyId: null });
    await store.markDeletion(due, new Date('2026-12-09T00:00:00.000Z'));
    await store.insert({ ...player(later), townId: null, dynastyId: null });
    await store.markDeletion(later, new Date('2026-12-11T00:00:00.000Z'));
    await store.insert(player(bound));
    await store.markDeletion(bound, new Date('2026-12-09T00:00:00.000Z'));

    // Act
    const erased = await store.deleteUnboundDue(at);

    // Assert
    expect(erased).toBe(1);
    expect(await store.findByTokenHash(due)).toBeNull();
    expect(await store.findByTokenHash(later)).not.toBeNull();
    expect(await store.findByTokenHash(bound)).not.toBeNull();
  });
});

function player(tokenHash: string): Omit<Player, 'playerId'> {
  const at = new Date('2026-11-05T00:00:00.000Z');

  return {
    tokenHash,
    townId: 900_001,
    dynastyId: 'leclerc',
    createdAt: at,
    lastSeenAt: at,
    deleteAfter: null,
  };
}
