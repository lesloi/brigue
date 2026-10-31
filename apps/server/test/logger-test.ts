import { describe, expect, it } from 'vitest';

import { createLogger } from '../src/logger.ts';
import { mintToken } from '../src/tokens.ts';

describe('the logger', () => {
  it('redacts fields that could carry a credential', () => {
    const lines: string[] = [];
    const logger = createLogger(
      (line) => lines.push(line),
      () => new Date('2026-10-31T12:00:00Z'),
    );

    logger.info('test', { token: 'secret', nested: { cookie: 'session', setCookie: 'x' } });

    expect(lines[0]).toContain('"token":"[redacted]"');
    expect(lines[0]).toContain('"cookie":"[redacted]"');
    expect(lines[0]).not.toContain('secret');
  });

  it('scrubs a token-shaped string wherever it appears', () => {
    const token = mintToken();
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));

    logger.info(`opened ${token}`, { detail: token });

    expect(lines[0]).not.toContain(token);
    expect(lines[0]).toContain('bgk_[redacted]');
  });
});
