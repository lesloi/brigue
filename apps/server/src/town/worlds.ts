import { FORMAT_VERSION, PACING, RULES, WorldVersionError, type Action, type Event, type World } from '@brigue/core';

/** One real hour is one town hour, and twenty-four of them make a year. */
export const HOUR_MS = 60 * 60 * 1000;

/** Where a catch-up read would land; the cap bounds what it actually plays. */
export function currentHourOf(world: World, hourStartedAt: Date, at: Date): number {
  const elapsed = Math.max(0, Math.floor((at.getTime() - hourStartedAt.getTime()) / HOUR_MS));

  return world.hour + Math.min(elapsed, PACING.maxCatchUpHours);
}

/** A read returns at most this many messages, and as many chronicle lines. */
export const JOURNAL_PAGE = 50;

/** A town a player can join: the id the rows carry, the name the screen shows. */
export interface TownInfo {
  id: number;
  name: string;
}

export interface StoredAction {
  /** Client-generated; the database primary key is what makes a retry a duplicate. */
  id: string;
  /** Always the authenticated player's dynasty, never whatever the request body said. */
  dynastyId: string;
  /** The town hour the action plays on. */
  playsAt: number;
  action: Action;
  receivedAt: Date;
  /** Set when the player cancels before it plays; the row stays for dedup and replay. */
  cancelledAt: Date | null;
  /**
   * The degree a title purchase buys, read at the order and kept for the
   * screen: the world replay derives it, so this is a label, never a rule.
   */
  title?: string;
}

export interface WorldSnapshot {
  town: TownInfo;
  world: World;
  /** When the town's current hour began, in real time. */
  hourStartedAt: Date;
}

/** One page of a dynasty's private mail, and what the badge counts. */
export interface MessagePage {
  /**
   * In the order they happened. Their `at` is 0: a message carries no town
   * hour, only the instant it was written.
   */
  messages: Event[];
  /** How many messages of the box are still unread, at most the page. */
  unread: number;
}

/** One unit of work on the town, inside the state row's lock. */
export interface WorldSession {
  readonly snapshot: WorldSnapshot;
  /** Actions queued for the hours in `[from, to]`, in the order they were received. */
  actionsBetween(from: number, to: number): Promise<StoredAction[]>;
  /** The newest private messages of a dynasty, in the order they happened. */
  recentMessages(limit: number, dynastyId: string): Promise<MessagePage>;
  /** The newest public chronicle lines, in the order they happened. */
  recentChronicle(limit: number): Promise<Event[]>;
  findAction(id: string): Promise<StoredAction | null>;
  append(action: StoredAction): Promise<void>;
  /** Marks an unplayed action cancelled; it is never handed to the advance. */
  cancel(id: string, at: Date): Promise<void>;
  /** Cancels every unplayed action of a dynasty, for an identity that goes. */
  cancelDynasty(dynastyId: string, at: Date): Promise<void>;
  /** Writes the whole town and appends the events of the span. */
  save(world: World, hourStartedAt: Date, events: Event[]): Promise<void>;
  /**
   * Deletes the town — its state, dynasties, people, actions and journal — and
   * leaves the players and the sealed seasons. The next join founds a new one.
   */
  clear(): Promise<void>;
}

/**
 * The loaded town must be the format and ruleset this code plays: wake no dynasty
 * and revoke no token before the world is known readable.
 */
export function sessionWorld(session: WorldSession): World {
  const world = session.snapshot.world;
  if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
    throw new WorldVersionError(world);
  }

  return world;
}

export interface WorldStore {
  /**
   * Creates the town row and its first state, and returns the town with the id
   * the database assigned. It is not idempotent: a second call creates a second
   * town, so a join calls it once inside `withJoinLock`.
   */
  createTown(name: string, world: World, hourStartedAt: Date): Promise<TownInfo>;
  /** Every town, oldest first, so a join can look for a free place. */
  listTowns(): Promise<TownInfo[]>;
  /**
   * Locks the town for the whole callback — the scheduler and the reader both
   * write, and two passes over the same town would lose one of them.
   */
  withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T>;
  /**
   * Serializes the joins: two newcomers must not take the same freed place, nor
   * found two towns at once. It spans several towns, so it cannot be the lock
   * of one `state` row.
   */
  withJoinLock<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Drops the chronicle and the mail written before their cut. Their own
   * statements, outside the state lock: a prune that fails must not roll back an
   * hour the town already lived. The cutoffs are the server's clock; each row
   * carries the database's instant at insertion, so the boundary is only as
   * exact as the two clocks.
   */
  pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void>;
  /**
   * Marks the unread mail of a dynasty as read, without locking the town: the
   * flag feeds the badge and no rule.
   */
  markMessagesRead(dynastyId: string): Promise<void>;
  /**
   * The keys of every human dynasty's name, the whole server over: the global
   * ranking reads human dynasties by name, so no two of them may share one. An AI
   * dynasty is not here — it carries the same names in every town.
   */
  listHumanNames(): Promise<string[]>;
  close(): Promise<void>;
}

export class UnknownWorldError extends Error {
  constructor() {
    super('the town does not exist yet');
    this.name = 'UnknownWorldError';
  }
}

/**
 * A human dynasty of the server already carries the name a write tried to give
 * one. The store refuses it whole, so no town is half written; the routes
 * answer the same 409 a rename answers, and a retry reads the dynasties again.
 */
export class NameInUseError extends Error {
  constructor() {
    super('a human dynasty of the server already carries this name');
    this.name = 'NameInUseError';
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
  chronicle: { id: number; event: Event; recordedAt: Date }[];
  messages: { id: number; dynastyId: string; event: Event; recordedAt: Date; read: boolean }[];
  nextEventId: number;
  nextMessageId: number;
}

/**
 * Mirrors the Postgres store for tests: one callback at a time on the town, and
 * a rollback of both the snapshot and the actions when the callback throws, the
 * way the surrounding transaction would roll back. Kept deliberately dumb: the
 * real locking is the `SELECT ... FOR UPDATE` in pg-worlds.ts.
 */
export class MemoryWorldStore implements WorldStore {
  private readonly towns = new Map<number, MemoryWorld>();
  private nextTownId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private joinQueue: Promise<unknown> = Promise.resolve();
  /** The instant an event is written, for the real-time journal cut. */
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async createTown(name: string, world: World, hourStartedAt: Date): Promise<TownInfo> {
    const town: TownInfo = { id: this.nextTownId, name };
    this.nextTownId += 1;
    this.towns.set(town.id, {
      snapshot: {
        town,
        world: structuredClone(world),
        hourStartedAt: new Date(hourStartedAt),
      },
      actions: [],
      chronicle: [],
      messages: [],
      nextEventId: 1,
      nextMessageId: 1,
    });

    return { ...town };
  }

  async listTowns(): Promise<TownInfo[]> {
    // A stable sort keeps the insertion order — oldest first — on equal counts.
    return [...this.towns.values()]
      .sort(
        (left, right) =>
          Object.keys(left.snapshot.world.dynasties).length - Object.keys(right.snapshot.world.dynasties).length,
      )
      .map((stored) => ({ ...stored.snapshot.town }));
  }

  async listHumanNames(): Promise<string[]> {
    return [...this.towns.values()].flatMap((stored) =>
      Object.values(stored.snapshot.world.dynasties)
        .filter((dynasty) => dynasty.controller === 'human')
        .map((dynasty) => dynasty.name),
    );
  }

  async pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    const stored = this.towns.get(townId);

    if (stored === undefined) {
      return;
    }
    stored.chronicle = stored.chronicle.filter((entry) => entry.recordedAt >= chronicleBefore);
    stored.messages = stored.messages.filter((entry) => entry.recordedAt >= messagesBefore);
  }

  async markMessagesRead(dynastyId: string): Promise<void> {
    // The box is addressed by its dynasty alone, so every town is a candidate
    // for where it lives.
    for (const stored of this.towns.values()) {
      for (const entry of stored.messages) {
        if (entry.dynastyId === dynastyId) {
          entry.read = true;
        }
      }
    }
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T> {
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

  async withJoinLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.joinQueue;
    const current = previous.then(() => run());

    this.joinQueue = current.then(
      () => undefined,
      () => undefined,
    );

    return current;
  }

  async close(): Promise<void> {}

  private sessionOf(townId: number, stored: MemoryWorld): WorldSession {
    return {
      snapshot: stored.snapshot,
      actionsBetween: async (from, to) =>
        stored.actions
          .filter((action) => action.playsAt >= from && action.playsAt <= to && action.cancelledAt === null)
          .sort((left, right) => left.playsAt - right.playsAt)
          .map((action) => structuredClone(action)),
      recentMessages: async (limit, dynastyId) => {
        const own = stored.messages.filter((entry) => entry.dynastyId === dynastyId);

        return {
          messages: own.slice(Math.max(0, own.length - limit)).map((entry) => structuredClone(entry.event)),
          // The badge names what the page can open, never a backlog below it.
          unread: Math.min(own.filter((entry) => !entry.read).length, limit),
        };
      },
      recentChronicle: async (limit) => {
        const visible = stored.chronicle.slice(Math.max(0, stored.chronicle.length - limit));

        return visible.map((entry) => structuredClone(entry.event));
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
      cancelDynasty: async (dynastyId, at) => {
        for (const action of stored.actions) {
          if (action.dynastyId === dynastyId && action.cancelledAt === null) {
            action.cancelledAt = new Date(at);
          }
        }
      },
      save: async (world, hourStartedAt, events) => {
        stored.snapshot = {
          town: stored.snapshot.town,
          world: structuredClone(world),
          hourStartedAt: new Date(hourStartedAt),
        };
        for (const event of events) {
          if (event.audience === 'town') {
            stored.chronicle.push({ id: stored.nextEventId, event: structuredClone(event), recordedAt: this.now() });
            stored.nextEventId += 1;
          } else if (typeof event.audience === 'object') {
            const reader = world.dynasties[event.audience.dynastyId];
            // An AI dynasty has no mailbox: the line is written for nobody.
            if (reader?.controller === 'human') {
              stored.messages.push({
                id: stored.nextMessageId,
                dynastyId: event.audience.dynastyId,
                event: { ...structuredClone(event), at: 0 },
                recordedAt: this.now(),
                read: false,
              });
              stored.nextMessageId += 1;
            }
          }
        }
      },
      clear: async () => {
        this.towns.delete(townId);
      },
    };
  }
}
