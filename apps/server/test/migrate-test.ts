import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createWorld, FORMAT_VERSION, type World } from '@brigue/core';

import { MIGRATIONS, migrateOldFormats } from '../src/migrate.ts';
import { applyMigrations } from '../src/migrations.ts';
import { PgWorldStore } from '../src/pg-worlds.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';

// Skips as a whole when there is no database to talk to, like the store test.
describe.runIf(databaseUrl !== '')('migrating an old format', () => {
  let pool: Pool;
  const worldIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
  });

  afterEach(async () => {
    for (const id of worldIds.splice(0)) {
      await pool.query('DELETE FROM players WHERE world_id = $1', [id]);
      await pool.query('DELETE FROM worlds WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  function newWorldId(): string {
    const id = randomUUID();
    worldIds.push(id);

    return id;
  }

  async function insertWorld(id: string, world: World): Promise<void> {
    await pool.query(
      `INSERT INTO worlds (id, state, week_started_at)
       VALUES ($1, $2, now())`,
      [id, JSON.stringify(world)],
    );
  }

  async function insertPlayer(worldId: string, tokenHash: string): Promise<void> {
    await pool.query(
      `INSERT INTO players (token_hash, world_id, house_id)
       VALUES ($1, $2, 'brigue')`,
      [tokenHash, worldId],
    );
  }

  async function insertAction(worldId: string): Promise<void> {
    await pool.query(
      `INSERT INTO actions (id, world_id, house_id, week, action)
       VALUES ($1, $2, 'brigue', 1, $3)`,
      [randomUUID(), worldId, JSON.stringify({ type: 'market.buy', houseId: 'brigue', good: 'wool', units: 1 })],
    );
  }

  async function rowsOf(table: 'worlds' | 'players' | 'actions', worldId: string): Promise<number> {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} WHERE ${table === 'worlds' ? 'id' : 'world_id'} = $1`,
      [worldId],
    );

    return Number(rows[0]?.count ?? 0);
  }

  async function threeFormats(): Promise<{ retiredId: string; currentId: string; laterId: string }> {
    const retiredId = newWorldId();
    const currentId = newWorldId();
    const laterId = newWorldId();

    await insertWorld(retiredId, { ...createWorld(1), formatVersion: FORMAT_VERSION - 1 });
    await insertWorld(currentId, createWorld(2));
    await insertWorld(laterId, { ...createWorld(3), formatVersion: FORMAT_VERSION + 1 });
    await insertPlayer(retiredId, 'a'.repeat(64));
    await insertPlayer(currentId, 'b'.repeat(64));
    await insertPlayer(laterId, 'c'.repeat(64));
    await insertAction(retiredId);
    await insertAction(laterId);

    return { retiredId, currentId, laterId };
  }

  it('stops at a world with no migration and deletes nothing', async () => {
    // Arrange
    const { retiredId, currentId, laterId } = await threeFormats();

    // Act
    const report = await migrateOldFormats(pool, FORMAT_VERSION);

    // Assert: the report names the reset and the newer world, and no row moved.
    expect(report).toEqual({ migrated: [], resetRequired: [retiredId], newer: [laterId] });
    expect(await rowsOf('worlds', retiredId)).toBe(1);
    expect(await rowsOf('players', retiredId)).toBe(1);
    expect(await rowsOf('actions', retiredId)).toBe(1);
    expect(await rowsOf('worlds', currentId)).toBe(1);
    expect(await rowsOf('worlds', laterId)).toBe(1);
  });

  it('resets only when asked, and leaves the other formats alone', async () => {
    // Arrange
    const { retiredId, currentId, laterId } = await threeFormats();

    // Act
    const report = await migrateOldFormats(pool, FORMAT_VERSION, { reset: true });

    // Assert
    expect(report.resetRequired).toEqual([retiredId]);
    expect(await rowsOf('worlds', retiredId)).toBe(0);
    expect(await rowsOf('players', retiredId)).toBe(0);
    expect(await rowsOf('actions', retiredId)).toBe(0);
    expect(await rowsOf('worlds', currentId)).toBe(1);
    expect(await rowsOf('players', currentId)).toBe(1);
    expect(await rowsOf('worlds', laterId)).toBe(1);
    expect(await rowsOf('players', laterId)).toBe(1);
    expect(await rowsOf('actions', laterId)).toBe(1);
  });

  it('migrates a world through a registered step and keeps its tokens', async () => {
    // Arrange: a synthetic step, because format 1 has no real migration.
    const id = newWorldId();
    await insertWorld(id, { ...createWorld(1), formatVersion: FORMAT_VERSION - 1 });
    await insertPlayer(id, 'a'.repeat(64));
    await insertAction(id);
    MIGRATIONS[FORMAT_VERSION - 1] = (world) => ({ ...world, formatVersion: FORMAT_VERSION, migrated: true });

    try {
      // Act
      const report = await migrateOldFormats(pool, FORMAT_VERSION);

      // Assert
      expect(report.migrated).toEqual([id]);
      expect(report.resetRequired).toEqual([]);
      const { rows } = await pool.query<{ state: { formatVersion: number; migrated: boolean } }>(
        'SELECT state FROM worlds WHERE id = $1',
        [id],
      );
      expect(rows[0]?.state.formatVersion).toBe(FORMAT_VERSION);
      expect(rows[0]?.state.migrated).toBe(true);
      expect(await rowsOf('players', id)).toBe(1);
      expect(await rowsOf('actions', id)).toBe(1);
    } finally {
      delete MIGRATIONS[FORMAT_VERSION - 1];
    }
  });

  it('refuses a migration step that returns nothing and keeps the world', async () => {
    // Arrange
    const id = newWorldId();
    await insertWorld(id, { ...createWorld(1), formatVersion: FORMAT_VERSION - 1 });
    MIGRATIONS[FORMAT_VERSION - 1] = () => null as unknown as Record<string, unknown>;

    try {
      // Act
      const report = await migrateOldFormats(pool, FORMAT_VERSION);

      // Assert: the broken step lands on the reset path, not in the store.
      expect(report.migrated).toEqual([]);
      expect(report.resetRequired).toEqual([id]);
      expect(await rowsOf('worlds', id)).toBe(1);
    } finally {
      delete MIGRATIONS[FORMAT_VERSION - 1];
    }
  });

  it('lets the first visit create a fresh town in the freed id', async () => {
    // Arrange: a format-1 world is cleared.
    const id = newWorldId();
    await insertWorld(id, { ...createWorld(3), formatVersion: FORMAT_VERSION - 1 });
    await migrateOldFormats(pool, FORMAT_VERSION, { reset: true });

    // Act: the first join inserts a new world under the same id.
    const store = new PgWorldStore(pool);
    const at = new Date();
    await store.createIfAbsent(id, createWorld(4), at, at);
    const snapshot = await store.withWorld(id, async (session) => session.snapshot);

    // Assert
    expect(snapshot.world.formatVersion).toBe(FORMAT_VERSION);
    expect(snapshot.world.week).toBe(1);
  });
});
