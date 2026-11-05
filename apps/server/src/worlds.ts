import type { Action, Event, World } from '@brigue/core';

/** One real hour is one town hour, and twenty-four of them make a year. */
export const HOUR_MS = 60 * 60 * 1000;

/** The house a new player gets until multiplayer assigns AI houses. */
export const FIRST_HOUSE_ID = 'brigue';

export interface StoredAction {
  /** Client-generated; the database primary key is what makes a retry a duplicate. */
  id: string;
  /** Always the authenticated player's house, never whatever the request body said. */
  houseId: string;
  /** The town hour the action plays on. */
  playsAt: number;
  action: Action;
  receivedAt: Date;
  /** Set when the player cancels before it plays; the row stays for dedup and replay. */
  cancelledAt: Date | null;
}

export interface WorldSnapshot {
  world: World;
  /** When the town's current hour began, in real time. */
  hourStartedAt: Date;
}

/** One unit of work on the town, inside the state row's lock. */
export interface WorldSession {
  readonly snapshot: WorldSnapshot;
  /** Actions queued for the hours in `[from, to]`, in the order they were received. */
  actionsBetween(from: number, to: number): Promise<StoredAction[]>;
  findAction(id: string): Promise<StoredAction | null>;
  append(action: StoredAction): Promise<void>;
  /** Marks an unplayed action cancelled; it is never handed to the advance. */
  cancel(id: string, at: Date): Promise<void>;
  /** Writes the whole town and appends the events of the span. */
  save(world: World, hourStartedAt: Date, events: Event[]): Promise<void>;
}

export interface WorldStore {
  /** Idempotent: a town that already exists keeps its state and its seed. */
  createIfAbsent(world: World, hourStartedAt: Date, at: Date): Promise<void>;
  /**
   * Locks the town for the whole callback — the scheduler and the reader both
   * write, and two passes over the same town would lose one of them.
   */
  withWorld<T>(run: (session: WorldSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class UnknownWorldError extends Error {
  constructor() {
    super('the town does not exist yet');
    this.name = 'UnknownWorldError';
  }
}

export class DuplicateActionError extends Error {
  constructor(id: string) {
    super(`action ${id} was already received`);
    this.name = 'DuplicateActionError';
  }
}

interface MemoryWorld {
  snapshot: WorldSnapshot;
  actions: StoredAction[];
}

/**
 * Mirrors the Postgres store for tests: one callback at a time on the town, and
 * a rollback of both the snapshot and the actions when the callback throws, the
 * way the surrounding transaction would roll back. Kept deliberately dumb: the
 * real locking is the `SELECT ... FOR UPDATE` in pg-worlds.ts.
 */
export class MemoryWorldStore implements WorldStore {
  private stored: MemoryWorld | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  async createIfAbsent(world: World, hourStartedAt: Date, at: Date): Promise<void> {
    if (this.stored !== null) {
      return;
    }

    this.stored = {
      snapshot: { world: structuredClone(world), hourStartedAt: new Date(hourStartedAt) },
      actions: [],
    };
    void at;
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>): Promise<T> {
    const previous = this.queue;
    const current = previous.then(async () => {
      if (this.stored === null) {
        throw new UnknownWorldError();
      }

      const backup = structuredClone(this.stored);

      try {
        return await run(this.sessionOf(this.stored));
      } catch (error) {
        this.stored = backup;
        throw error;
      }
    });

    // A failed callback must not block the queue behind it, but its error still
    // reaches its own caller.
    this.queue = current.then(
      () => undefined,
      () => undefined,
    );

    return current;
  }

  async close(): Promise<void> {}

  private sessionOf(stored: MemoryWorld): WorldSession {
    return {
      snapshot: stored.snapshot,
      actionsBetween: async (from, to) =>
        stored.actions
          .filter((action) => action.playsAt >= from && action.playsAt <= to && action.cancelledAt === null)
          .sort((left, right) => left.playsAt - right.playsAt)
          .map((action) => structuredClone(action)),
      findAction: async (id) => {
        const found = stored.actions.find((action) => action.id === id);

        return found ? structuredClone(found) : null;
      },
      append: async (action) => {
        if (stored.actions.some((existing) => existing.id === action.id)) {
          throw new DuplicateActionError(action.id);
        }
        stored.actions.push(structuredClone(action));
      },
      cancel: async (id, at) => {
        const found = stored.actions.find((action) => action.id === id);

        if (found !== undefined && found.cancelledAt === null) {
          found.cancelledAt = new Date(at);
        }
      },
      save: async (world, hourStartedAt, events) => {
        stored.snapshot = {
          world: structuredClone(world),
          hourStartedAt: new Date(hourStartedAt),
        };
        void events;
      },
    };
  }
}
