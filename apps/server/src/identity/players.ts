import { nameKey } from '@brigue/core';

export interface Player {
  /** SHA-256 of the raw token, never the token itself. */
  tokenHash: string;
  /** The stable identity the book of kings keeps; the store assigns it. */
  playerId: number;
  /** The human family name; the person carries its display name. */
  name: string;
  /** Empty for an account a reset left between towns, until it chooses again. */
  townId: number | null;
  personId: number | null;
  createdAt: Date;
  /** The last visit. Dormancy and the thirty-day deletion are measured from it. */
  lastSeenAt: Date;
  /** Set when the player asks to delete their identity: the erasure deadline. */
  deleteAfter: Date | null;
}

/**
 * An account with a person. Every route that plays a town needs one: a valid
 * token without a person may only choose a trade, which is an explicit action.
 */
export type BoundPlayer = Player & { townId: number; personId: number };

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

export class PersonAlreadyBoundError extends Error {
  constructor(personId: number | null) {
    super(`person ${personId} already has a live token`);
    this.name = 'PersonAlreadyBoundError';
  }
}

export interface PlayerStore {
  /** Creates the account and returns it with the id the store assigned. */
  insert(player: Omit<Player, 'playerId'>): Promise<Player>;
  findByTokenHash(tokenHash: string): Promise<Player | null>;
  /**
   * Gives the person to an account a reset left without one. Null when the
   * account is already bound or the person is taken: the choice is made once.
   */
  rebind(tokenHash: string, townId: number, personId: number, at: Date): Promise<Player | null>;
  /** Records a visit on an account that still exists. */
  touch(tokenHash: string, at: Date): Promise<void>;
  /** Every account of a town, so presence can see the last visit. */
  listByTown(townId: number): Promise<Player[]>;
  /** Schedules the erasure of an identity; a second request keeps the first. */
  markDeletion(tokenHash: string, at: Date): Promise<void>;
  /** Cancels a scheduled erasure: the player came back. */
  cancelDeletion(tokenHash: string): Promise<void>;
  /**
   * Deletes the account and its mail; the person it holds goes with it, by the
   * schema's cascade. Never called under a town's row lock: the cascade writes
   * the person's row, which the lock covers.
   */
  deleteAccount(playerId: number): Promise<void>;
  /** Erases an account no person ever took: a join that failed after issuing it. */
  eraseAccount(tokenHash: string): Promise<void>;
  /**
   * Erases the accounts a reset left without a person whose deletion deadline
   * has passed, and returns how many. They belong to no town, so the per-town
   * sweep never reaches them.
   */
  deleteUnboundDue(at: Date): Promise<number>;
  /** The family names of every account, for the server-wide uniqueness rule. */
  listNames(): Promise<string[]>;
  /** Changes the family name; a name another account carries is refused. */
  renameName(tokenHash: string, name: string): Promise<void>;
}

/**
 * The database is the real store; this one exists so the auth tests do not
 * need a Postgres service. It mirrors the unique index over the family name.
 */
export class MemoryPlayerStore implements PlayerStore {
  private readonly players = new Map<string, Player>();
  private nextPlayerId = 1;

  async insert(player: Omit<Player, 'playerId'>): Promise<Player> {
    if (this.players.has(player.tokenHash)) {
      throw new PersonAlreadyBoundError(player.personId);
    }
    if (this.carriesName(player.name)) {
      throw new NameAlreadyBoundError(player.name);
    }

    const stored: Player = { ...player, playerId: this.nextPlayerId };
    this.nextPlayerId += 1;
    this.players.set(stored.tokenHash, stored);

    return { ...stored };
  }

  async rebind(tokenHash: string, townId: number, personId: number, at: Date): Promise<Player | null> {
    const player = this.players.get(tokenHash);

    if (player === undefined || player.personId !== null) {
      return null;
    }
    for (const existing of this.players.values()) {
      // The memory store has no global sequence: a person id is scoped by its
      // town, the way the database scopes a real id by the row it names.
      if (existing.townId === townId && existing.personId === personId) {
        throw new PersonAlreadyBoundError(personId);
      }
    }

    const stored: Player = { ...player, townId, personId, lastSeenAt: new Date(at) };
    this.players.set(tokenHash, stored);

    return { ...stored };
  }

  async findByTokenHash(tokenHash: string): Promise<Player | null> {
    const player = this.players.get(tokenHash);

    return player ? { ...player } : null;
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    const player = this.players.get(tokenHash);
    if (player) {
      this.players.set(tokenHash, { ...player, lastSeenAt: at });
    }
  }

  async listByTown(townId: number): Promise<Player[]> {
    return [...this.players.values()].filter((player) => player.townId === townId).map((player) => ({ ...player }));
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

  async deleteAccount(playerId: number): Promise<void> {
    for (const [tokenHash, player] of this.players) {
      if (player.playerId === playerId) {
        this.players.delete(tokenHash);
      }
    }
  }

  async eraseAccount(tokenHash: string): Promise<void> {
    this.players.delete(tokenHash);
  }

  async deleteUnboundDue(at: Date): Promise<number> {
    let erased = 0;

    for (const [tokenHash, player] of this.players) {
      if (player.personId === null && player.deleteAfter !== null && player.deleteAfter.getTime() <= at.getTime()) {
        this.players.delete(tokenHash);
        erased += 1;
      }
    }

    return erased;
  }

  async listNames(): Promise<string[]> {
    return [...this.players.values()].map((player) => player.name).sort();
  }

  async renameName(tokenHash: string, name: string): Promise<void> {
    const player = this.players.get(tokenHash);

    if (player === undefined) {
      return;
    }
    if (this.carriesName(name, tokenHash)) {
      throw new NameAlreadyBoundError(name);
    }
    this.players.set(tokenHash, { ...player, name });
  }

  private carriesName(name: string, exceptTokenHash?: string): boolean {
    const key = nameKey(name);

    return [...this.players.values()].some(
      (player) => player.tokenHash !== exceptTokenHash && nameKey(player.name) === key,
    );
  }

  /** Mirrors the reset: every account keeps its identity and loses its person. */
  resetAccounts(): void {
    for (const [tokenHash, player] of this.players) {
      this.players.set(tokenHash, { ...player, townId: null, personId: null });
    }
  }
}

/** A family name another account already carries. */
export class NameAlreadyBoundError extends Error {
  constructor(name: string) {
    super(`the family name "${name}" is already carried`);
    this.name = 'NameAlreadyBoundError';
  }
}
