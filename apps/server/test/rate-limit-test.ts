import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/rate-limit.ts';

describe('the rate limiter', () => {
  it('allows the limit and refuses the next attempt in the window', () => {
    const limiter = createRateLimiter(2, 60_000);

    expect(limiter.take('203.0.113.7', 0).allowed).toBe(true);
    expect(limiter.take('203.0.113.7', 1_000).allowed).toBe(true);

    const refused = limiter.take('203.0.113.7', 2_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(58);
  });

  it('forgets a window once it has passed', () => {
    const limiter = createRateLimiter(1, 60_000);

    expect(limiter.take('203.0.113.7', 0).allowed).toBe(true);
    expect(limiter.take('203.0.113.7', 60_000).allowed).toBe(true);
  });

  it('keeps client budgets separate', () => {
    const limiter = createRateLimiter(1, 60_000);

    expect(limiter.take('203.0.113.7', 0).allowed).toBe(true);
    expect(limiter.take('198.51.100.4', 0).allowed).toBe(true);
    expect(limiter.take('198.51.100.4', 0).allowed).toBe(false);
  });
});
