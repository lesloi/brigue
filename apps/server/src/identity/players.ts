export interface Player {
  /** SHA-256 of the raw token, never the token itself. */
  tokenHash: string;
  /** The stable identity the book of kings keeps; the store assigns it. */
  playerId: number;
  /** Empty for an account a reset left between towns, until it chooses again. */
  townId: number | null;
  dynastyId: string | null;
  createdAt: Date;
  /** The last visit. Dormancy and the thirty-day deletion are measured from it. */
  lastSeenAt: Date;
  revokedAt: Date | null;
  /** Set when the player asks to delete their identity: the erasure deadline. */
  deleteAfter: Date | null;
}

/**
 * An account with a dynasty. Every route that plays a town needs one: a valid
 * token without a dynasty may only choose a trade, which is an explicit action.
 */
export type BoundPlayer = Player & { townId: number; dynastyId: string };

export type Closing = { kind: 'none' } | { kind: 'pending'; after: Date } | { kind: 'due' };

/** What a deletion state allows: everything, only the way back, or nothing. */
export function closingOf(player: Player, at: Date): Closing {
  if (player.deleteAfter === null) {
    return { kind: 'none' };
  }

  return player.deleteAfter.getTime() <= at.getTime()
    ? { kind: 'due' }
    : { kind: 'pending', after: player.deleteAfter };
}

export class DynastyAlreadyBoundError extends Error {
  constructor(townId: number | null, dynastyId: string | null) {
    super(`dynasty ${townId}/${dynastyId} already has a live token`);
    this.name = 'DynastyAlreadyBoundError';
  }
}

export interface PlayerStore {
  /** Creates the account and returns it with the id the store assigned. */
  insert(player: Omit<Player, 'playerId'>): Promise<Player>;
  findByTokenHash(tokenHash: string): Promise<Player | null>;
  /**
   * Gives a dynasty back to an account a reset left without one. Null when the
   * account is already bound or revoked: the choice is only made once.
   */
  rebind(tokenHash: string, townId: number, dynastyId: string, at: Date): Promise<Player | null>;
  revoke(tokenHash: string, at: Date): Promise<void>;
  /** Records a visit without reopening a revoked session. */
  touch(tokenHash: string, at: Date): Promise<void>;
  /** Every account of a town, live or revoked, so presence can see the last visit. */
  listByTown(townId: number): Promise<Player[]>;
  /**
   * Revokes every live account of a dynasty, for the thirty-day deletion. The
   * dynasty id alone scopes it: a human dynasty id is minted once for the whole
   * server, and the dynasty row may already be gone from the world.
   */
  revokeDynasty(dynastyId: string, at: Date): Promise<void>;
  /** Schedules the erasure of an identity; a second request keeps the first. */
  markDeletion(tokenHash: string, at: Date): Promise<void>;
  /** Cancels a scheduled erasure: the player came back. */
  cancelDeletion(tokenHash: string): Promise<void>;
  /** Deletes every row of a dynasty, for an identity the scheduler erased. */
  deleteDynasty(dynastyId: string): Promise<void>;
  /**
   * Erases the accounts a reset left without a dynasty whose deletion deadline
   * has passed, and returns how many. They belong to no town, so the per-town
   * sweep never reaches them.
   */
  deleteUnboundDue(at: Date): Promise<number>;
}

/**
 * The database is the real store; this one exists so the auth tests do not
 * need a Postgres service. It mirrors the migration's partial unique index:
 * one live token per dynasty.
 */
export class MemoryPlayerStore implements PlayerStore {
  private readonly players = new Map<string, Player>();
  private nextPlayerId = 1;

  async insert(player: Omit<Player, 'playerId'>): Promise<Player> {
    if (this.players.has(player.tokenHash)) {
      throw new DynastyAlreadyBoundError(player.townId, player.dynastyId);
    }

    // A dynasty-less account holds no place: only a bound one can collide.
    for (const existing of this.players.values()) {
      if (
        player.townId !== null &&
        player.dynastyId !== null &&
        existing.revokedAt === null &&
        existing.townId === player.townId &&
        existing.dynastyId === player.dynastyId
      ) {
        throw new DynastyAlreadyBoundError(player.townId, player.dynastyId);
      }
    }

    const stored: Player = { ...player, playerId: this.nextPlayerId };
    this.nextPlayerId += 1;
    this.players.set(stored.tokenHash, stored);

    return { ...stored };
  }

  async rebind(tokenHash: string, townId: number, dynastyId: string, at: Date): Promise<Player | null> {
    const player = this.players.get(tokenHash);

    if (player === undefined || player.revokedAt !== null || player.dynastyId !== null) {
      return null;
    }

    for (const existing of this.players.values()) {
      if (existing.revokedAt === null && existing.townId === townId && existing.dynastyId === dynastyId) {
        throw new DynastyAlreadyBoundError(townId, dynastyId);
      }
    }

    const stored: Player = { ...player, townId, dynastyId, lastSeenAt: new Date(at) };
    this.players.set(tokenHash, stored);

    return { ...stored };
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const player = this.players.get(tokenHash);

    return player ? { ...player } : null;
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

  async listByTown(townId: number): Promise<Player[]> {
    return [...this.players.values()].filter((player) => player.townId === townId).map((player) => ({ ...player }));
  }

  async revokeDynasty(dynastyId: string, at: Date): Promise<void> {
    for (const [tokenHash, player] of this.players) {
      if (player.dynastyId === dynastyId && player.revokedAt === null) {
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

  async deleteDynasty(dynastyId: string): Promise<void> {
    for (const [tokenHash, player] of this.players) {
      if (player.dynastyId === dynastyId) {
        this.players.delete(tokenHash);
      }
    }
  }

  async deleteUnboundDue(at: Date): Promise<number> {
    let erased = 0;

    for (const [tokenHash, player] of this.players) {
      if (player.dynastyId === null && player.deleteAfter !== null && player.deleteAfter.getTime() <= at.getTime()) {
        this.players.delete(tokenHash);
        erased += 1;
      }
    }

    return erased;
  }

  /** Mirrors the reset: every account keeps its identity and loses its dynasty. */
  resetAccounts(): void {
    for (const [tokenHash, player] of this.players) {
      this.players.set(tokenHash, { ...player, townId: null, dynastyId: null });
    }
  }
}
