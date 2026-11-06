import { isVisibleTo, type Action, type Event, type RefusalReason, type World } from '@brigue/core';

import { countEvent, emptyTally } from './journal.ts';

/** One real hour is one town hour, and twenty-four of them make a year. */
export const HOUR_MS = 60 * 60 * 1000;

/** The town the single-town path still uses; a join picks or creates its own. */
export const WORLD_ID = 'saint-aubin';

export interface TownInfo {
  id: string;
  name: string;
}

export const DEFAULT_TOWN: TownInfo = { id: WORLD_ID, name: 'Saint-Aubin' };

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

export type JournalCounts = Partial<Record<Event['type'], number>>;
export type JournalRefusals = Partial<Record<RefusalReason, number>>;

export interface JournalPage {
  /** The newest entries after the cursor, in the order they happened. */
  events: Event[];
  /** The newest entry's id: the cursor jumps over what the counts cover. */
  lastId: number;
  /** What the page left behind, counted by type. */
  counts: JournalCounts;
  /** The refused actions among them, counted by reason. */
  refusals: JournalRefusals;
}

export interface WorldSnapshot {
  town: TownInfo;
  world: World;
  /** When the town's current hour began, in real time. */
  hourStartedAt: Date;
}

/** One unit of work on the town, inside the state row's lock. */
export interface WorldSession {
  readonly snapshot: WorldSnapshot;
  /** Actions queued for the hours in `[from, to]`, in the order they were received. */
  actionsBetween(from: number, to: number): Promise<StoredAction[]>;
  /** The journal after a reader's cursor, and how much is left beyond the page. */
  eventsSince(afterId: number, limit: number, houseId: string): Promise<JournalPage>;
  findAction(id: string): Promise<StoredAction | null>;
  append(action: StoredAction): Promise<void>;
  /** Marks an unplayed action cancelled; it is never handed to the advance. */
  cancel(id: string, at: Date): Promise<void>;
  /** Writes the whole town and appends the events of the span. */
  save(world: World, hourStartedAt: Date, events: Event[]): Promise<void>;
  /**
   * Deletes the town — its state, houses, people, actions and journal — and
   * leaves the players and the sealed seasons. The next join founds a new one.
   */
  clear(): Promise<void>;
}

export interface WorldStore {
  /** Idempotent: a town that already exists keeps its state and its seed. */
  createIfAbsent(world: World, hourStartedAt: Date, at: Date): Promise<void>;
  /** Idempotent per id: creates the town row and its first state. */
  createTown(town: TownInfo, world: World, hourStartedAt: Date): Promise<void>;
  /** Every town, oldest first, so a join can look for a free place. */
  listTowns(): Promise<TownInfo[]>;
  /**
   * Locks the town for the whole callback — the scheduler and the reader both
   * write, and two passes over the same town would lose one of them. Omitted,
   * the town is the single-town path's default.
   */
  withWorld<T>(run: (session: WorldSession) => Promise<T>, townId?: string): Promise<T>;
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
  town: TownInfo;
  snapshot: WorldSnapshot;
  actions: StoredAction[];
  events: { id: number; event: Event }[];
  nextEventId: number;
}

/**
 * Mirrors the Postgres store for tests: one callback at a time on the town, and
 * a rollback of both the snapshot and the actions when the callback throws, the
 * way the surrounding transaction would roll back. Kept deliberately dumb: the
 * real locking is the `SELECT ... FOR UPDATE` in pg-worlds.ts.
 */
export class MemoryWorldStore implements WorldStore {
  private readonly towns = new Map<string, MemoryWorld>();
  private queue: Promise<unknown> = Promise.resolve();

  async createIfAbsent(world: World, hourStartedAt: Date, at: Date): Promise<void> {
    await this.createTown(DEFAULT_TOWN, world, hourStartedAt);
    void at;
  }

  async createTown(town: TownInfo, world: World, hourStartedAt: Date): Promise<void> {
    if (this.towns.has(town.id)) {
      return;
    }

    this.towns.set(town.id, {
      town: { ...town },
      snapshot: {
        town: { ...town },
        world: structuredClone(world),
        hourStartedAt: new Date(hourStartedAt),
      },
      actions: [],
      events: [],
      nextEventId: 1,
    });
  }

  async listTowns(): Promise<TownInfo[]> {
    return [...this.towns.values()].map((stored) => ({ ...stored.town }));
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId = DEFAULT_TOWN.id): Promise<T> {
    const previous = this.queue;
    const current = previous.then(async () => {
      const stored = this.towns.get(townId);
      if (stored === undefined) {
        throw new UnknownWorldError();
      }

      const backup = structuredClone(stored);

      try {
        return await run(this.sessionOf(townId, stored));
      } catch (error) {
        this.towns.set(townId, backup);
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

  private sessionOf(townId: string, stored: MemoryWorld): WorldSession {
    return {
      snapshot: stored.snapshot,
      actionsBetween: async (from, to) =>
        stored.actions
          .filter((action) => action.playsAt >= from && action.playsAt <= to && action.cancelledAt === null)
          .sort((left, right) => left.playsAt - right.playsAt)
          .map((action) => structuredClone(action)),
      eventsSince: async (afterId, limit, houseId) => {
        const visible = stored.events.filter((entry) => entry.id > afterId && isVisibleTo(entry.event, houseId));
        const page = visible.slice(-limit);
        const tally = emptyTally();

        for (const entry of visible.slice(0, visible.length - page.length)) {
          countEvent(tally, entry.event);
        }

        return {
          events: page.map((entry) => structuredClone(entry.event)),
          lastId: page.at(-1)?.id ?? afterId,
          ...tally,
        };
      },
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
          town: stored.town,
          world: structuredClone(world),
          hourStartedAt: new Date(hourStartedAt),
        };
        for (const event of events) {
          stored.events.push({ id: stored.nextEventId, event: structuredClone(event) });
          stored.nextEventId += 1;
        }
      },
      clear: async () => {
        this.towns.delete(townId);
      },
    };
  }
}
