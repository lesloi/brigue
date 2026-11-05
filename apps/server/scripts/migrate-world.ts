import { FORMAT_VERSION } from '@brigue/core';

import { migrateOldFormats } from '../src/migrate.ts';

/**
 * Run after a format rollout, once the new pod is the only one serving. With
 * no argument it targets the format of this image, which is the release being
 * deployed; a numeric argument targets another format.
 *
 * A world with no registered migration is never deleted in silence: the script
 * stops, names the worlds and the cost, and exits non-zero. Only an operator
 * who has read that warning passes --reset. A world of a newer format is left
 * alone: this image cannot read it, and a rollback is not a migration.
 */
const args = process.argv.slice(2);
const reset = args.includes('--reset');
const targetArg = args.find((arg) => arg !== '--reset');

if (targetArg !== undefined && (!/^\d+$/.test(targetArg) || Number(targetArg) < 1)) {
  throw new Error('usage: migrate-world.ts [target-format] [--reset]');
}

const targetFormat = targetArg === undefined ? FORMAT_VERSION : Number(targetArg);
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const { Pool } = await import('pg');
const pool = new Pool({ connectionString });

try {
  const report = await migrateOldFormats(pool, targetFormat, { reset });

  for (const id of report.migrated) {
    process.stdout.write(`migrated world ${id} to format ${targetFormat}\n`);
  }
  if (reset) {
    for (const id of report.resetRequired) {
      process.stdout.write(`reset world ${id}\n`);
    }
  }

  if (report.newer.length > 0) {
    process.stderr.write(
      `world(s) ${report.newer.join(', ')} are newer than format ${targetFormat}; ` +
        'this image cannot read them and must not downgrade them.\n',
    );
    process.exitCode = 1;
  }

  if (report.resetRequired.length > 0 && !reset) {
    process.stderr.write(
      `no migration to format ${targetFormat} for world(s) ${report.resetRequired.join(', ')}.\n` +
        'This would RESET them: their actions and tokens are deleted.\n' +
        'Re-run with --reset to confirm, or ship the migration.\n',
    );
    process.exitCode = 1;
  }

  if (report.migrated.length === 0 && report.resetRequired.length === 0 && report.newer.length === 0) {
    process.stdout.write(`no world to migrate to format ${targetFormat}\n`);
  }
} finally {
  await pool.end();
}
