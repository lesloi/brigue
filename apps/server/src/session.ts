import { hashToken, isTokenShaped, mintToken, sameDigest, DUMMY_DIGEST } from './tokens.ts';
import type { Player, PlayerStore } from './players.ts';

export interface IssuedToken {
  /** Shown once and never stored: the store only keeps `player.tokenHash`. */
  token: string;
  player: Player;
}

export async function issueToken(
  store: PlayerStore,
  townId: number,
  houseId: string,
  now: Date = new Date(),
  mint: () => string = mintToken,
): Promise<IssuedToken> {
  // A wrong id here is a server bug, not a player's refusal: throw while the
  // server is creating the house, not later when the player logs in.
  if (townId <= 0 || houseId.length === 0) {
    throw new Error('an account needs a town and a house');
  }

  const token = mint();
  const player: Omit<Player, 'playerId'> = {
    tokenHash: hashToken(token),
    townId,
    houseId,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
    deleteAfter: null,
  };

  return { token, player: await store.insert(player) };
}

export async function authenticate(store: PlayerStore, token: string | undefined): Promise<Player | null> {
  const digest = hashToken(token ?? '');
  const player = token !== undefined && isTokenShaped(token) ? await store.findByTokenHash(digest) : null;

  // A missing, malformed, unknown and revoked token all run the same
  // comparison; only a live match survives.
  const matches = sameDigest(digest, player?.tokenHash ?? DUMMY_DIGEST);

  return matches && player !== null && player.revokedAt === null ? player : null;
}
