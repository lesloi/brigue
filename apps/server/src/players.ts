export interface Player {
  /** SHA-256 of the raw token, never the token itself. */
  tokenHash: string;
  worldId: string;
  houseId: string;
  createdAt: Date;
  /** The last visit. Dormancy and the thirty-day deletion are measured from it. */
  lastSeenAt: Date;
  /** The last journal entry this reader has seen. */
  cursorEventId?: number;
  revokedAt: Date | null;
  /** Set when the player asks to delete their identity: the erasure deadline. */
  deleteAfter: Date | null;
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
  /** Records a visit without reopening a revoked session. */
  touch(tokenHash: string, at: Date): Promise<void>;
  /** Moves the reader's journal cursor forward; it never goes back. */
  advanceCursor(tokenHash: string, cursor: number): Promise<void>;
  /** Every row of a world, live or revoked, so presence can see the last visit. */
  listByWorld(worldId: string): Promise<Player[]>;
  /** Revokes every live token of a house, for the thirty-day deletion. */
  revokeHouse(worldId: string, houseId: string, at: Date): Promise<void>;
  /** Schedules the erasure of an identity; a second request keeps the first. */
  markDeletion(tokenHash: string, at: Date): Promise<void>;
  /** Cancels a scheduled erasure: the player came back. */
  cancelDeletion(tokenHash: string): Promise<void>;
  /** Deletes every row of a house, for an identity the scheduler erased. */
  deleteHouse(worldId: string, houseId: string): Promise<void>;
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

  async advanceCursor(tokenHash: string, cursor: number): Promise<void> {
    const player = this.players.get(tokenHash);

    if (player !== undefined) {
      player.cursorEventId = Math.max(player.cursorEventId ?? 0, cursor);
    }
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    const player = this.players.get(tokenHash);
    if (player && player.revokedAt === null) {
      this.players.set(tokenHash, { ...player, revokedAt: at, lastSeenAt: at });
    }
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    const player = this.players.get(tokenHash);
    if (player && player.revokedAt === null) {
      this.players.set(tokenHash, { ...player, lastSeenAt: at });
    }
  }

  async listByWorld(worldId: string): Promise<Player[]> {
    return [...this.players.values()].filter((player) => player.worldId === worldId).map((player) => ({ ...player }));
  }

  async revokeHouse(worldId: string, houseId: string, at: Date): Promise<void> {
    for (const [tokenHash, player] of this.players) {
      if (player.worldId === worldId && player.houseId === houseId && player.revokedAt === null) {
        this.players.set(tokenHash, { ...player, revokedAt: at });
      }
    }
  }

  async markDeletion(tokenHash: string, at: Date): Promise<void> {
    const player = this.players.get(tokenHash);

    if (player !== undefined && player.deleteAfter === null) {
      this.players.set(tokenHash, { ...player, deleteAfter: new Date(at) });
    }
  }

  async cancelDeletion(tokenHash: string): Promise<void> {
    const player = this.players.get(tokenHash);

    if (player !== undefined) {
      this.players.set(tokenHash, { ...player, deleteAfter: null });
    }
  }

  async deleteHouse(worldId: string, houseId: string): Promise<void> {
    for (const [tokenHash, player] of this.players) {
      if (player.worldId === worldId && player.houseId === houseId) {
        this.players.delete(tokenHash);
      }
    }
  }
}
