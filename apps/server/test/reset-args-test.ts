import { describe, expect, it } from 'vitest';

import { isConfirmation, parseResetArgs, ResetUsageError } from '../src/reset-args.ts';

describe('reset arguments', () => {
  it('reads the three flags', () => {
    expect(parseResetArgs(['--force', '--full', '--check'])).toEqual({
      force: true,
      full: true,
      check: true,
    });
    expect(parseResetArgs([])).toEqual({ force: false, full: false, check: false });
  });

  it('refuses a flag it does not know', () => {
    expect(() => parseResetArgs(['--yes'])).toThrow(ResetUsageError);
    expect(() => parseResetArgs(['force'])).toThrow(ResetUsageError);
  });

  it('accepts only a plain yes', () => {
    expect(isConfirmation('yes')).toBe(true);
    expect(isConfirmation(' YES ')).toBe(true);
    expect(isConfirmation('y')).toBe(false);
    expect(isConfirmation('')).toBe(false);
    expect(isConfirmation('no')).toBe(false);
  });
});
