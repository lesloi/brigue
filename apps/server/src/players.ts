export interface Player {
  /** SHA-256 of the raw token, never the token itself. */
  tokenHash: string;
  worldId: string;
  houseId: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export class HouseAlreadyBoundError extends Error {
  constructor(worldId: string, houseId: string) {
    super(`house ${worldId}/${houseId} already has a live token`);
    this.name = 'HouseAlreadyBoundError';
  }
}

export interface PlayerStore {
  insert(player: Player): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Player | null>;
  revoke(tokenHash: string, at: Date): Promise<void>;
}

/**
 * The database is the real store; this one exists so the auth tests do not
 * need a Postgres service. It mirrors the migration's partial unique index:
 * one live token per house.
 */
export class MemoryPlayerStore implements PlayerStore {
  private readonly players = new Map<string, Player>();

  async insert(player: Player): Promise<void> {
    if (this.players.has(player.tokenHash)) {
      throw new HouseAlreadyBoundError(player.worldId, player.houseId);
    }

    for (const existing of this.players.values()) {
      if (existing.revokedAt === null && existing.worldId === player.worldId && existing.houseId === player.houseId) {
        throw new HouseAlreadyBoundError(player.worldId, player.houseId);
      }
    }

    this.players.set(player.tokenHash, { ...player });
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const player = this.players.get(tokenHash);

    return player ? { ...player } : null;
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    const player = this.players.get(tokenHash);
    if (player && player.revokedAt === null) {
      this.players.set(tokenHash, { ...player, revokedAt: at });
    }
  }
}
