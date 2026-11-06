import { isConfirmation, parseResetArgs, ResetUsageError } from '../src/reset-args.ts';
import { previewReset, resetDatabase, type ResetPreview } from '../src/reset.ts';

/**
 * The schema reset, for the one deployment that changes the shape of the
 * database. It destroys the town — its houses, its actions, its journal, its
 * accounts — and the migrations record, then builds an empty schema from
 * `db/migrations` and carries the book of kings across. With `--full` it
 * deletes the book too: it is the one thing that otherwise outlives a reset.
 *
 * `--check` shows what the reset would destroy and changes nothing. Without
 * `--force`, the script asks first; with no terminal to ask on, it refuses.
 */

async function main(): Promise<void> {
  let args;

  try {
    args = parseResetArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ResetUsageError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString });

  try {
    // The preview answers both the dry run and the question: the operator
    // reads what will go before saying yes.
    if (args.check || !args.force) {
      printPreview(await previewReset(pool, { full: args.full }));

      if (args.check) {
        process.stdout.write('nothing was changed (--check)\n');
        return;
      }

      if (!(await ask())) {
        process.stderr.write('nothing was changed\n');
        process.exitCode = 1;
        return;
      }
    }

    const report = await resetDatabase(pool, { full: args.full });

    for (const file of report.applied) {
      process.stdout.write(`applied ${file}\n`);
    }
    process.stdout.write(
      report.full
        ? 'database reset: everything deleted, the book of kings included\n'
        : `database reset: ${report.kings} king(s) kept\n`,
    );
  } finally {
    await pool.end();
  }
}

function printPreview(preview: ResetPreview): void {
  process.stdout.write(
    `database ${preview.database}: a reset drops the public schema and rebuilds it from the migrations.\n`,
  );

  for (const table of preview.tables) {
    process.stdout.write(`  ${table.name.padEnd(20)} ${count(table.rows, 'row')}\n`);
  }

  process.stdout.write(
    preview.full
      ? 'the book of kings is deleted too (--full)\n'
      : `the book of kings is kept: ${count(preview.kings, 'king')}\n`,
  );
}

function count(value: number, word: string): string {
  return `${value} ${word}${value === 1 ? '' : 's'}`;
}

/** A terminal question, never a piped answer: a reset has to be signed live. */
async function ask(): Promise<boolean> {
  if (process.stdin.isTTY !== true) {
    process.stderr.write('no terminal to ask on; pass --force to reset without a prompt\n');

    return false;
  }

  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return isConfirmation(await readline.question('Type "yes" to reset this database: '));
  } finally {
    readline.close();
  }
}

await main();
