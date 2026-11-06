import { resetDatabase } from '../src/reset.ts';

/**
 * The schema reset, for the one deployment that changes the shape of the
 * database. It destroys the town — its houses, its actions, its journal, its
 * tokens — and the migrations record, then builds an empty schema from
 * `db/migrations` and carries the sealed seasons across. With `--full` it
 * deletes the sealed seasons too: the register and the book of kings are the
 * one thing that otherwise outlives a reset.
 *
 * Nothing happens without `--confirm`: the script names what it would destroy
 * and exits non-zero, so a reset is never silent.
 */
const args = process.argv.slice(2);
const known = new Set(['--confirm', '--full']);
const unknown = args.filter((arg) => !known.has(arg));

if (unknown.length > 0) {
  throw new Error('usage: reset-schema.ts [--confirm] [--full]');
}

const confirmed = args.includes('--confirm');
const full = args.includes('--full');
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

if (!confirmed) {
  process.stderr.write(
    (full
      ? 'This resets the database completely: the town, its actions, its journal and its\n' +
        'tokens are deleted, and so are the sealed seasons — the register and the book of\n' +
        'kings — and schema_migrations.\n'
      : 'This resets the database: the town, its actions, its journal and its tokens are\n' +
        'deleted, and schema_migrations with them. The sealed seasons are kept.\n') +
      'Re-run with --confirm to do it.\n',
  );
  process.exitCode = 1;
} else {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });

  try {
    const report = await resetDatabase(pool, { full });

    for (const file of report.applied) {
      process.stdout.write(`applied ${file}\n`);
    }
    process.stdout.write(
      report.full
        ? 'database reset: everything deleted, the sealed seasons included\n'
        : `database reset: ${report.archivedHouses} archived house(s), ${report.kings} king(s) kept\n`,
    );
  } finally {
    await pool.end();
  }
}
