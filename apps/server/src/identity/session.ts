import { hashToken, isTokenShaped, mintToken, sameDigest, DUMMY_DIGEST } from './tokens.ts';
import type { Player, PlayerStore } from './players.ts';

export interface IssuedToken {
  /** Shown once and never stored: the store only keeps `player.tokenHash`. */
  token: string;
  player: Player;
}

/**
 * Opens an account under the family name the player kept. The person is bound
 * later, once a place has been found: a failed join must not leave an account
 * pointing at a person the town no longer holds.
 */
export async function issueToken(
  store: PlayerStore,
  name: string,
  now: Date = new Date(),
  mint: () => string = mintToken,
): Promise<IssuedToken> {
  if (name.length === 0) {
    throw new Error('an account needs a family name');
  }

  const token = mint();
  const player: Omit<Player, 'playerId'> = {
    tokenHash: hashToken(token),
    name,
    townId: null,
    personId: null,
    createdAt: now,
    lastSeenAt: now,
    deleteAfter: null,
  };

  return { token, player: await store.insert(player) };
}

export async function authenticate(store: PlayerStore, token: string | undefined): Promise<Player | null> {
  const digest = hashToken(token ?? '');
  const player = token !== undefined && isTokenShaped(token) ? await store.findByTokenHash(digest) : null;

  // A missing, malformed and unknown token all run the same comparison; only a
  // match survives.
  const matches = sameDigest(digest, player?.tokenHash ?? DUMMY_DIGEST);

  return matches ? player : null;
}
