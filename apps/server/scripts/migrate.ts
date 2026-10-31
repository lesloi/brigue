import { applyMigrations } from '../src/migrations.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const { Pool } = await import('pg');
const pool = new Pool({ connectionString });

try {
  for (const file of await applyMigrations(pool)) {
    process.stdout.write(`applied ${file}\n`);
  }
} finally {
  await pool.end();
}
