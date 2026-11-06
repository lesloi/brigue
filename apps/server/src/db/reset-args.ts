export interface ResetArgs {
  /** Skip the interactive question. */
  force: boolean;
  /** Also delete the sealed seasons. */
  full: boolean;
  /** Show what the reset would destroy, and do nothing. */
  check: boolean;
}

export class ResetUsageError extends Error {
  constructor() {
    super('usage: reset-schema.ts [--force] [--full] [--check]');
    this.name = 'ResetUsageError';
  }
}

/** The command line, read once: only the three flags are known. */
export function parseResetArgs(argv: readonly string[]): ResetArgs {
  const known = new Set(['--force', '--full', '--check']);

  if (argv.some((arg) => !known.has(arg))) {
    throw new ResetUsageError();
  }

  return {
    force: argv.includes('--force'),
    full: argv.includes('--full'),
    check: argv.includes('--check'),
  };
}

/** Only a plain "yes" confirms; anything else, including an empty line, aborts. */
export function isConfirmation(answer: string): boolean {
  return answer.trim().toLowerCase() === 'yes';
}
