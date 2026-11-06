export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window ends; only meaningful when refused. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  take(key: string, nowMs: number): RateLimitDecision;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed window, one process. Refusing a login attempt is hygiene, not a
 * security boundary: a restarted container starts its windows again, which is
 * fine while there is one container and one ingress.
 */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, Bucket>();
  // Spoofed addresses could otherwise grow the map without bound; evicting the
  // oldest bucket only lets an attacker move to a fresh one, which is already
  // what a new address does.
  const maxBuckets = 10_000;

  return {
    take(key, nowMs) {
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= nowMs) {
        if (buckets.size >= maxBuckets) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) {
            buckets.delete(oldest);
          }
        }
        buckets.set(key, { count: 1, resetAt: nowMs + windowMs });

        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)),
        };
      }

      bucket.count += 1;

      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
