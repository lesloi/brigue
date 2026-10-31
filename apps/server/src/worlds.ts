import type { Action, Event, World } from '@brigue/core';

/** One town, shared by every house. The id is stable across deploys. */
export const WORLD_ID = 'saint-aubin';

/** The house a new player gets until multiplayer assigns AI houses. */
export const FIRST_HOUSE_ID = 'brigue';

export interface StoredAction {
  /** Client-generated; the database primary key is what makes a retry a duplicate. */
  id: string;
  /** Always the authenticated player's house, never whatever the request body said. */
  houseId: string;
  week: number;
  action: Action;
  receivedAt: Date;
}

export interface WorldSnapshot {
  world: World;
  /** When the world's current week began. Catch-up is measured from here. */
  weekStartedAt: Date;
  /** Events of the last tick that was played, so an empty read still shows one. */
  lastEvents: Event[];
}

/** One unit of work on a world, inside the row lock (or its in-memory equivalent). */
export interface WorldSession {
  readonly snapshot: WorldSnapshot;
  /** Actions queued for a week, in the order they were received. */
  actionsFor(week: number): Promise<StoredAction[]>;
  findAction(id: string): Promise<StoredAction | null>;
  append(action: StoredAction): Promise<void>;
  save(world: World, weekStartedAt: Date, lastEvents: Event[], at: Date): Promise<void>;
}

export interface WorldStore {
  /** Idempotent: a world that already exists keeps its state and its seed. */
  createIfAbsent(id: string, world: World, weekStartedAt: Date, at: Date): Promise<void>;
  /**
   * Locks the world for the whole callback. Everything that can turn a read
   * into a write goes through here, so two requests never replay the same week.
   */
  withWorld<T>(id: string, run: (session: WorldSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class UnknownWorldError extends Error {
  constructor(worldId: string) {
    super(`unknown world ${worldId}`);
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
 * Mirrors the Postgres store for tests: one callback at a time per world, and a
 * rollback of both the snapshot and the actions when the callback throws, the
 * way the surrounding transaction would roll back. Kept deliberately dumb: the
 * real locking is the `SELECT ... FOR UPDATE` in pg-worlds.ts.
 */
export class MemoryWorldStore implements WorldStore {
  private readonly worlds = new Map<string, MemoryWorld>();
  private readonly queues = new Map<string, Promise<unknown>>();

  async createIfAbsent(id: string, world: World, weekStartedAt: Date, at: Date): Promise<void> {
    if (this.worlds.has(id)) {
      return;
    }

    this.worlds.set(id, {
      snapshot: {
        world: structuredClone(world),
        weekStartedAt: new Date(weekStartedAt),
        lastEvents: [],
      },
      actions: [],
    });
    void at;
  }

  async withWorld<T>(id: string, run: (session: WorldSession) => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const current = previous.then(async () => {
      const stored = this.worlds.get(id);
      if (!stored) {
        throw new UnknownWorldError(id);
      }

      const backup = structuredClone(stored);

      try {
        return await run(this.sessionOf(stored));
      } catch (error) {
        stored.snapshot = backup.snapshot;
        stored.actions = backup.actions;
        throw error;
      }
    });

    // A failed callback must not block the queue behind it, but its error still
    // reaches its own caller.
    this.queues.set(
      id,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );

    return current;
  }

  async close(): Promise<void> {}

  private sessionOf(stored: MemoryWorld): WorldSession {
    return {
      snapshot: stored.snapshot,
      actionsFor: async (week) =>
        stored.actions.filter((action) => action.week === week).map((action) => structuredClone(action)),
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
      save: async (world, weekStartedAt, lastEvents, at) => {
        stored.snapshot = {
          world: structuredClone(world),
          weekStartedAt: new Date(weekStartedAt),
          lastEvents: structuredClone(lastEvents),
        };
        void at;
      },
    };
  }
}
