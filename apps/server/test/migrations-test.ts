import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, pendingMigrations } from '../src/migrations.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';
const directories: string[] = [];

// Skips as a whole when there is no database to talk to, like the store test.
describe.runIf(databaseUrl !== '')('migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applyMigrations(pool);
  });

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function migrationsWith(file: string, sql: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'brigue-migrations-'));
    directories.push(directory);
    await writeFile(join(directory, file), sql);

    return directory;
  }

  it('has nothing pending once the schema is up to date', async () => {
    // Act
    const pending = await pendingMigrations(pool);

    // Assert
    expect(pending).toEqual([]);
  });

  it('reports a migration the running image carries and the schema does not', async () => {
    // Arrange
    const directory = await migrationsWith('9999_pending.sql', 'SELECT 1;');

    // Act
    const pending = await pendingMigrations(pool, directory);

    // Assert
    expect(pending).toEqual(['9999_pending.sql']);
  });

  it('applies a migration once and keeps no row twice', async () => {
    // Arrange
    const directory = await migrationsWith('9998_once.sql', 'CREATE TABLE IF NOT EXISTS once_test (id int);');

    // Act
    const first = await applyMigrations(pool, directory);
    const second = await applyMigrations(pool, directory);

    // Assert
    expect(first).toEqual(['9998_once.sql']);
    expect(second).toEqual([]);
    expect(await pendingMigrations(pool, directory)).toEqual([]);
  });

  it('leaves a failing migration pending, and unapplied', async () => {
    // Arrange
    const directory = await migrationsWith('9997_broken.sql', 'CREATE TABLE broken_test (id int) nonsense;');

    // Act
    const apply = applyMigrations(pool, directory);

    // Assert
    await expect(apply).rejects.toThrow();
    expect(await pendingMigrations(pool, directory)).toEqual(['9997_broken.sql']);
  });
});
