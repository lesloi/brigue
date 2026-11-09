import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BoundPlayer, Player, PlayerStore } from '../identity/players.ts';
import { closingOf } from '../identity/players.ts';
import { authenticate } from '../identity/session.ts';
import type { Logger } from '../logger.ts';
import type { WorldStore } from '../town/worlds.ts';
import { readSessionCookie } from './cookies.ts';
import type { RateLimiter } from './rate-limit.ts';
import { sendJson, unauthorized } from './respond.ts';

export interface AppDeps {
  store: PlayerStore;
  worlds: WorldStore;
  logger: Logger;
  /**
   * Readiness: what a readiness probe asks before it sends traffic here. Wired
   * to a database ping in production. Liveness is not this and must never
   * touch it.
   */
  ready: () => Promise<void>;
  /** Directory of the built client. Unset in development, where Vite serves it. */
  webRoot?: string;
  /** Local development only: exposes `POST /api/dev/advance`. Never set in production. */
  devAdvance?: boolean;
  now?: () => number;
  secureCookies?: boolean;
  trustProxy?: boolean;
  limiter?: RateLimiter;
  sessionAttemptsPerMinute?: number;
}

/** What every route shares: the stores it talks to, the clock, and the cookie policy. */
export interface AppContext {
  deps: AppDeps;
  now: () => number;
  secureCookies: boolean;
  trustProxy: boolean;
  limiter: RateLimiter;
}

export async function identifiedBy(
  context: AppContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<Player | null> {
  const player = await authenticate(context.deps.store, readSessionCookie(request.headers.cookie));

  if (player === null) {
    unauthorized(response, context.secureCookies, true);
  }

  return player;
}

/** A closing identity can only come back: every other route refuses it. */
export function refuseClosing(context: AppContext, player: Player, response: ServerResponse, at: Date): boolean {
  const closing = closingOf(player, at);

  if (closing.kind === 'none') {
    return false;
  }
  if (closing.kind === 'due') {
    unauthorized(response, context.secureCookies, true);
    return true;
  }

  sendJson(response, 409, { error: 'deletion_pending', deleteAfter: closing.after.toISOString() });
  return true;
}

/**
 * An account a reset left between towns holds a valid token and no person. It
 * may choose a trade, which is an explicit action, but no read of the town and
 * no action can be served before that: the token stays, so this is not a 401.
 */
export function boundPlayerOf(context: AppContext, player: Player, response: ServerResponse): BoundPlayer | null {
  if (player.townId === null || player.personId === null) {
    sendJson(response, 409, { error: 'dynasty_lost' });
    return null;
  }

  return player as BoundPlayer;
}
