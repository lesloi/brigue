import { isConfirmation, parseResetArgs, ResetUsageError } from '../src/db/reset-args.ts';
import { previewReset, resetDatabase, type ResetPreview } from '../src/db/reset.ts';

/**
 * The schema reset, for the one deployment that changes the shape of the
 * database. It destroys the town — its dynasties, its actions, its journal — and
 * the migrations record, then builds an empty schema from `db/schema.sql` and
 * carries the book of kings and the accounts across. A carried account keeps
 * its token and its player id and loses its dynasty: the next visit chooses a
 * trade. With `--full` it deletes the book and the accounts too.
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
        ? 'database reset: everything deleted, the book of kings and the accounts included\n'
        : `database reset: ${count(report.kings, 'king')} and ${count(report.accounts, 'account')} kept\n`,
    );
  } finally {
    await pool.end();
  }
}

function printPreview(preview: ResetPreview): void {
  process.stdout.write(
    `database ${preview.database}: a reset drops the public schema and rebuilds it from the schema file.\n`,
  );

  for (const table of preview.tables) {
    process.stdout.write(`  ${table.name.padEnd(20)} ${count(table.rows, 'row')}\n`);
  }

  process.stdout.write(
    preview.full
      ? 'the book of kings and the accounts are deleted too (--full)\n'
      : `the book of kings is kept: ${count(preview.kings, 'king')}\n`,
  );

  if (!preview.full) {
    process.stdout.write(`the accounts are kept, without their dynasty: ${count(preview.accounts, 'account')}\n`);
  }
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
