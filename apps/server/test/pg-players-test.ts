import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applySchema } from '../src/db/migrations.ts';
import { PgPlayerStore } from '../src/identity/pg-players.ts';
import { NameInUseError } from '../src/town/worlds.ts';
import type { Player } from '../src/identity/players.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';
const TOWN = 'PgPlayers';

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
    await pool.query('DELETE FROM towns WHERE name = $1', [TOWN]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedPerson(personId: number, playerId: number | null = null): Promise<number> {
    const { rows: towns } = await pool.query<{ id: string }>(
      `INSERT INTO towns (name, last_played_at) VALUES ($1, now())
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [TOWN],
    );
    const townId = Number(towns[0]?.id);
    await pool.query(
      `INSERT INTO people (id, town_id, player_id, person_name, treasury_cents, debt_cents, favour, prestige, alive)
       VALUES ($1, $2, $3, 'Colin Leclerc', 45000, 0, 50, 0, true)`,
      [personId, townId, playerId],
    );

    return townId;
  }

  it('schedules, cancels and erases an account whose person is gone', async () => {
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

    await seedPerson(9001, stored.playerId);
    expect((await store.findByTokenHash(tokenHash))?.personId).toBe(9001);
    await store.deletePerson(9001);
    expect(await store.findByTokenHash(tokenHash)).toBeNull();
  });

  it('binds an account a reset left without a person, and only once', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const at = new Date('2026-12-02T00:00:00.000Z');
    const stored = await store.insert(player(tokenHash));
    const townId = await seedPerson(9001);
    await seedPerson(9002);

    // Act
    const rebound = await store.rebind(tokenHash, townId, 9001, at);

    // Assert: the person is back and the visit is now, so the new person is not
    // measured from the old silence.
    expect(rebound).toMatchObject({ personId: 9001 });
    expect(rebound?.lastSeenAt).toEqual(at);
    expect(await store.rebind(tokenHash, townId, 9002, at)).toBeNull();
    expect((await store.findByTokenHash(tokenHash))?.personId).toBe(9001);
    expect(stored.playerId).toBe(rebound?.playerId);
  });

  it('never binds an account whose deadline has erased it', async () => {
    // Arrange
    const tokenHash = 'a'.repeat(64);
    const at = new Date('2026-12-02T00:00:00.000Z');
    await store.insert(player(tokenHash));
    const townId = await seedPerson(9001);
    await store.markDeletion(tokenHash, at);
    await store.deleteUnboundDue(at);

    // Act / Assert
    expect(await store.rebind(tokenHash, townId, 9001, at)).toBeNull();
  });

  it('erases the person-less accounts whose deadline passed, and only those', async () => {
    // Arrange: one due, one later, one bound and due (a town's sweep owns it).
    const at = new Date('2026-12-10T00:00:00.000Z');
    const due = 'a'.repeat(64);
    const later = 'b'.repeat(64);
    const bound = 'c'.repeat(64);
    await store.insert({ ...player(due), name: 'Due' });
    await store.markDeletion(due, new Date('2026-12-09T00:00:00.000Z'));
    await store.insert({ ...player(later), name: 'Later' });
    await store.markDeletion(later, new Date('2026-12-11T00:00:00.000Z'));
    const boundPlayer = await store.insert({ ...player(bound), name: 'Bound' });
    await seedPerson(9001, boundPlayer.playerId);
    await store.markDeletion(bound, new Date('2026-12-09T00:00:00.000Z'));

    // Act
    const erased = await store.deleteUnboundDue(at);

    // Assert
    expect(erased).toBe(1);
    expect(await store.findByTokenHash(due)).toBeNull();
    expect(await store.findByTokenHash(later)).not.toBeNull();
    expect(await store.findByTokenHash(bound)).not.toBeNull();
  });

  it('refuses a family name another account already carries', async () => {
    // Arrange
    await store.insert({ ...player('a'.repeat(64)), name: 'Leclerc' });

    // Act / Assert
    await expect(store.insert({ ...player('b'.repeat(64)), name: 'leclerc' })).rejects.toBeInstanceOf(NameInUseError);
  });
});

function player(tokenHash: string): Omit<Player, 'playerId'> {
  const at = new Date('2026-11-05T00:00:00.000Z');

  return {
    tokenHash,
    name: 'Leclerc',
    townId: null,
    personId: null,
    createdAt: at,
    lastSeenAt: at,
    deleteAfter: null,
  };
}
