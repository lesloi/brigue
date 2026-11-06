import { resetDatabase } from '../src/reset.ts';

/**
 * The schema reset, for the one deployment that changes the shape of the
 * database. It destroys the town — its houses, its actions, its journal — and
 * the migrations record, then builds an empty schema from `db/migrations`.
 * Players and the sealed seasons are carried across.
 *
 * Nothing happens without `--confirm`: the script names what it would destroy
 * and exits non-zero, so a reset is never silent.
 */
const confirmed = process.argv.includes('--confirm');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

if (!confirmed) {
  process.stderr.write(
    'This resets the database: the town, its actions, its journal and its tokens are\n' +
      'deleted, and schema_migrations with them. The sealed seasons are kept.\n' +
      'Re-run with --confirm to do it.\n',
  );
  process.exitCode = 1;
} else {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });

  try {
    const report = await resetDatabase(pool);

    for (const file of report.applied) {
      process.stdout.write(`applied ${file}\n`);
    }
    process.stdout.write(
      `database reset: ${report.archivedHouses} archived house(s), ` + `${report.kings} king(s) kept\n`,
    );
  } finally {
    await pool.end();
  }
}
