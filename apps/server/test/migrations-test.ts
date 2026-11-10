import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applySchema, defaultSchemaPath, pendingSchema } from '../src/db/migrations.ts';

const databaseUrl = process.env.DATABASE_URL ?? '';
const directories: string[] = [];

// The move of this module into `src/db` is what the path depends on: the
// command the image runs has no database to prove it, so the file system does.
describe('the default schema file', () => {
  it('is the schema the image ships', async () => {
    // Act
    const sql = await readFile(defaultSchemaPath(), 'utf8');

    // Assert
    expect(sql).toContain('CREATE TABLE towns');
  });
});

// Skips as a whole when there is no database to talk to, like the store test.
describe.runIf(databaseUrl !== '')('the schema file', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await applySchema(pool);
  });

  afterEach(async () => {
    // A temp schema is recorded like the real one; left behind, it would make
    // the next run of this suite believe it was already applied.
    await pool.query(
      `DELETE FROM schema_migrations
       WHERE name IN ('9999_pending.sql', '9998_once.sql', '9997_broken.sql')`,
    );
    await pool.query('DROP TABLE IF EXISTS once_test');
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function schemaWith(file: string, sql: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'brigue-schema-'));
    directories.push(directory);
    const path = join(directory, file);
    await writeFile(path, sql);

    return path;
  }

  it('has nothing pending once the schema is up to date', async () => {
    // Act
    const pending = await pendingSchema(pool);

    // Assert
    expect(pending).toEqual([]);
  });

  it('reports a schema the running image carries and the database does not', async () => {
    // Arrange
    const path = await schemaWith('9999_pending.sql', 'SELECT 1;');

    // Act
    const pending = await pendingSchema(pool, path);

    // Assert
    expect(pending).toEqual(['9999_pending.sql']);
  });

  it('applies a schema once and keeps no row twice', async () => {
    // Arrange
    const path = await schemaWith('9998_once.sql', 'CREATE TABLE IF NOT EXISTS once_test (id int);');

    // Act
    const first = await applySchema(pool, path);
    const second = await applySchema(pool, path);

    // Assert
    expect(first).toEqual(['9998_once.sql']);
    expect(second).toEqual([]);
    expect(await pendingSchema(pool, path)).toEqual([]);
  });

  it('leaves a failing schema pending, and unapplied', async () => {
    // Arrange
    const path = await schemaWith('9997_broken.sql', 'CREATE TABLE broken_test (id int) nonsense;');

    // Act
    const apply = applySchema(pool, path);

    // Assert
    await expect(apply).rejects.toThrow();
    expect(await pendingSchema(pool, path)).toEqual(['9997_broken.sql']);
  });
});
