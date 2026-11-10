import { FORMAT_VERSION, RULES, WorldVersionError, type Action, type Event, type World } from '@brigue/core';

/** One real hour is one town hour, and twenty-four of them make a year. */
export const HOUR_MS = 60 * 60 * 1000;

/**
 * The hour the world has reached at an instant. The world is born on hour 1 and
 * gains one every real hour: nothing is stored, the wall clock is the clock.
 */
export function hourAt(worldStartedAt: Date, at: Date): number {
  return 1 + Math.max(0, Math.floor((at.getTime() - worldStartedAt.getTime()) / HOUR_MS));
}

/** The instant an hour begins: the other way round from `hourAt`. */
export function hourStartedOf(worldStartedAt: Date, hour: number): Date {
  return new Date(worldStartedAt.getTime() + (hour - 1) * HOUR_MS);
}

/** A read returns at most this many messages, and as many chronicle lines. */
export const JOURNAL_PAGE = 50;

/** A town a player can join: the id the rows carry, the name the screen shows. */
export interface TownInfo {
  id: number;
  name: string;
}

/** An action as the store receives it: the id is the row's own. */
export interface NewStoredAction {
  /** Always the authenticated person, never whatever the request body said. */
  personId: number;
  /** The town hour the action plays on. */
  playsAt: number;
  action: Action;
  receivedAt: Date;
  /**
   * The degree a title purchase buys, read at the order and kept for the
   * screen: the world replay derives it, so this is a label, never a rule.
   */
  title?: string;
}

export interface StoredAction extends NewStoredAction {
  /** Assigned by the store, in the order the actions arrived. */
  id: number;
}

export interface WorldSnapshot {
  town: TownInfo;
  /** The town's rows, with `hour` the hour those rows have reached. */
  world: World;
  /** The instant the world was founded: every hour is counted from it. */
  worldStartedAt: Date;
}

/**
 * The world's shared clock, both ends of it: the instant it was founded, which
 * says what hour it is, and the instant of its data, which says how far the
 * towns have been played. The gap between the two is what the scheduler owes.
 */
export interface Clock {
  worldStartedAt: Date;
  /** The start of the first hour the rows do not hold yet. */
  lastRunAt: Date;
}

/** One stored message: the row's id, its flag, and the line. */
export interface MessageView {
  id: number;
  read: boolean;
  event: Event;
}

/** One page of an account's private mail, and what the badge counts. */
export interface MessagePage {
  /**
   * In the order they happened. Their `at` is 0: a message carries no town
   * hour, only the instant it was written.
   */
  messages: MessageView[];
  /** How many messages of the box are still unread, at most the page. */
  unread: number;
}

/** One unit of work on the town, inside the world's hour-row lock. */
export interface WorldSession {
  readonly snapshot: WorldSnapshot;
  /** Actions queued for the hours in `[from, to]`, in the order they were received. */
  actionsBetween(from: number, to: number): Promise<StoredAction[]>;
  /** The newest private messages of an account, in the order they happened. */
  recentMessages(limit: number, playerId: number): Promise<MessagePage>;
  /** The newest public chronicle lines, in the order they happened. */
  recentChronicle(limit: number): Promise<Event[]>;
  findAction(id: number): Promise<StoredAction | null>;
  /** Appends the action and returns it with the id the store gave it. */
  append(action: NewStoredAction): Promise<StoredAction>;
  /** Erases an unplayed action; it is never handed to the advance. */
  cancel(id: number): Promise<void>;
  /** Erases every action of a person, for an identity that goes. */
  cancelPerson(personId: number): Promise<void>;
  /**
   * Writes the whole town and appends the events of the span. `accounts` maps a
   * person to the account that reads its mail; a person absent from it is an AI
   * and has no mailbox. The clock is not the town's: a save moves no hour.
   */
  save(world: World, events: Event[], accounts?: ReadonlyMap<number, number>): Promise<void>;
  /**
   * Deletes the town — its people, actions and journal — and leaves the
   * accounts, the sealed seasons and the world's settings. The next join founds
   * a new town.
   */
  clear(): Promise<void>;
}

/**
 * The loaded town must be the format and ruleset this code plays: wake no person
 * and erase no account before the world is known readable.
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
   * Creates the town row and its first rows, and returns the town with the id
   * the database assigned. The first town founds the world at `at`; a later one
   * joins the clock it finds, so every town shares one clock. It is not
   * idempotent: a second call creates a second town, so a join calls it once
   * inside `withJoinLock`.
   */
  createTown(name: string, world: World, at: Date): Promise<TownInfo>;
  /** Every town, oldest first, so a join can look for a free place. */
  listTowns(): Promise<TownInfo[]>;
  /**
   * The shared clock, read once by a pass so every town advances to the same
   * target. Null before the first town has founded the world.
   */
  readClock(): Promise<Clock | null>;
  /**
   * Records how far the world's data has been played, by the start of the first
   * hour the rows do not hold yet. Only a pass writes it, once, after every
   * town: a town's save says nothing about the others.
   */
  markWorldPlayed(firstUnplayedAt: Date): Promise<void>;
  /**
   * Local development only: moves the world's origin back, so the world is
   * `hours` hours further along than the wall clock says. Every town gains the
   * same hours, because there is one clock.
   */
  moveWorldClockBack(hours: number): Promise<void>;
  /**
   * Locks the world for the whole callback — the scheduler and the reader both
   * write, and two passes over the same town would lose one of them.
   */
  withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T>;
  /**
   * Serializes the joins: two newcomers must not take the same freed place, nor
   * found two towns at once. It spans several towns, so it cannot be the shared
   * hour row's lock.
   */
  withJoinLock<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Serializes the passes. Two passes read the same clock before either has
   * played it, so without this both would play the same hours and the town
   * would live them twice. It spans every town, so the row lock cannot hold it.
   */
  withPassLock<T>(run: () => Promise<T>): Promise<T>;
  /**
   * Drops the chronicle and the mail written before their cut. Their own
   * statements, outside the state lock: a prune that fails must not roll back an
   * hour the town already lived. The cutoffs are the server's clock; each row
   * carries the database's instant at insertion, so the boundary is only as
   * exact as the two clocks.
   */
  pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void>;
  /**
   * Marks one message of an account as read, without locking the town: the flag
   * feeds the badge and no rule. A message of another box is left alone.
   */
  markMessageRead(id: number, playerId: number): Promise<{ read: boolean; unread: number }>;
  /**
   * Deletes one message of an account. No trash: the row goes, and the badge's
   * new count comes back with the answer.
   */
  deleteMessage(id: number, playerId: number): Promise<{ deleted: boolean; unread: number }>;
  close(): Promise<void>;
}

export class UnknownWorldError extends Error {
  constructor() {
    super('the town does not exist yet');
    this.name = 'UnknownWorldError';
  }
}

/**
 * An account of the server already carries the family name a write tried to
 * give one. The store refuses it whole, so no town is half written; the routes
 * answer the same 409 a rename answers, and a retry reads the accounts again.
 */
export class NameInUseError extends Error {
  constructor() {
    super('an account of the server already carries this family name');
    this.name = 'NameInUseError';
  }
}

interface MemoryWorld {
  snapshot: WorldSnapshot;
  actions: StoredAction[];
  nextActionId: number;
  chronicle: { id: number; event: Event; recordedAt: Date }[];
  messages: { id: number; playerId: number; event: Event; recordedAt: Date; read: boolean }[];
  nextEventId: number;
  nextMessageId: number;
}

interface StoredClock {
  formatVersion: number;
  rulesetVersion: number;
  worldStartedAt: Date;
  /** The start of the first hour the rows do not hold yet. */
  lastRunAt: Date;
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
  private passQueue: Promise<unknown> = Promise.resolve();
  /** The world's shared clock and identity, outside any town. */
  private clock: StoredClock | null = null;
  /** The instant an event is written, for the real-time journal cut. */
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async createTown(name: string, world: World, at: Date): Promise<TownInfo> {
    const town: TownInfo = { id: this.nextTownId, name };
    this.nextTownId += 1;

    // The first town founds the world; a later one joins the clock it finds and
    // cannot reset the origin.
    if (this.clock === null) {
      this.clock = {
        formatVersion: world.formatVersion,
        rulesetVersion: world.rulesetVersion,
        worldStartedAt: new Date(at),
        lastRunAt: new Date(at),
      };
    } else {
      world.formatVersion = this.clock.formatVersion;
      world.rulesetVersion = this.clock.rulesetVersion;
      world.hour = hourAt(this.clock.worldStartedAt, this.clock.lastRunAt);
    }

    this.towns.set(town.id, {
      snapshot: {
        town,
        world: structuredClone(world),
        worldStartedAt: new Date(this.clock.worldStartedAt),
      },
      actions: [],
      nextActionId: 1,
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
          Object.keys(left.snapshot.world.people).length - Object.keys(right.snapshot.world.people).length,
      )
      .map((stored) => ({ ...stored.snapshot.town }));
  }

  async readClock(): Promise<Clock | null> {
    if (this.clock === null) {
      return null;
    }

    return { worldStartedAt: new Date(this.clock.worldStartedAt), lastRunAt: new Date(this.clock.lastRunAt) };
  }

  async moveWorldClockBack(hours: number): Promise<void> {
    if (this.clock === null) {
      return;
    }

    this.clock.worldStartedAt = new Date(this.clock.worldStartedAt.getTime() - hours * HOUR_MS);
    this.clock.lastRunAt = new Date(this.clock.lastRunAt.getTime() - hours * HOUR_MS);
  }

  async pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    const stored = this.towns.get(townId);

    if (stored === undefined) {
      return;
    }
    stored.chronicle = stored.chronicle.filter((entry) => entry.recordedAt >= chronicleBefore);
    stored.messages = stored.messages.filter((entry) => entry.recordedAt >= messagesBefore);
  }

  async deleteMessage(id: number, playerId: number): Promise<{ deleted: boolean; unread: number }> {
    let deleted = false;
    let unread = 0;

    for (const stored of this.towns.values()) {
      const index = stored.messages.findIndex((entry) => entry.id === id && entry.playerId === playerId);

      if (index >= 0) {
        stored.messages.splice(index, 1);
        deleted = true;
      }

      unread += stored.messages.filter((entry) => entry.playerId === playerId && !entry.read).length;
    }

    return { deleted, unread: Math.min(unread, JOURNAL_PAGE) };
  }

  async markMessageRead(id: number, playerId: number): Promise<{ read: boolean; unread: number }> {
    let read = false;
    let unread = 0;

    // The box is addressed by its account alone, so every town is a candidate
    // for where it lives.
    for (const stored of this.towns.values()) {
      for (const entry of stored.messages) {
        if (entry.id === id && entry.playerId === playerId) {
          entry.read = true;
          read = true;
        }
        if (entry.playerId === playerId && !entry.read) {
          unread += 1;
        }
      }
    }

    return { read, unread: Math.min(unread, JOURNAL_PAGE) };
  }

  async withWorld<T>(run: (session: WorldSession) => Promise<T>, townId: number): Promise<T> {
    const previous = this.queue;
    const current = previous.then(async () => {
      const stored = this.towns.get(townId);
      if (stored === undefined) {
        throw new UnknownWorldError();
      }

      const backup = structuredClone(stored);
      const clockBackup = this.clock === null ? null : structuredClone(this.clock);

      // A town reads the world's clock, not a copy of its own: the hour belongs
      // to the world, the rows belong to the town.
      if (this.clock !== null) {
        stored.snapshot.world.formatVersion = this.clock.formatVersion;
        stored.snapshot.world.rulesetVersion = this.clock.rulesetVersion;
        stored.snapshot.world.hour = hourAt(this.clock.worldStartedAt, this.clock.lastRunAt);
        stored.snapshot.worldStartedAt = new Date(this.clock.worldStartedAt);
      }

      try {
        return await run(this.sessionOf(townId, stored));
      } catch (error) {
        this.towns.set(townId, backup);
        this.clock = clockBackup;
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

  async withPassLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.passQueue;
    const current = previous.then(() => run());

    this.passQueue = current.then(
      () => undefined,
      () => undefined,
    );

    return current;
  }

  async markWorldPlayed(firstUnplayedAt: Date): Promise<void> {
    if (this.clock === null) {
      return;
    }

    // Forward only: a pass that played less than the one before it must not put
    // the world back.
    if (firstUnplayedAt.getTime() > this.clock.lastRunAt.getTime()) {
      this.clock.lastRunAt = new Date(firstUnplayedAt);
    }
  }

  async close(): Promise<void> {}

  private sessionOf(townId: number, stored: MemoryWorld): WorldSession {
    return {
      snapshot: stored.snapshot,
      actionsBetween: async (from, to) =>
        stored.actions
          .filter((action) => action.playsAt >= from && action.playsAt <= to)
          .sort((left, right) => left.playsAt - right.playsAt || left.id - right.id)
          .map((action) => structuredClone(action)),
      recentMessages: async (limit, playerId) => {
        const own = stored.messages.filter((entry) => entry.playerId === playerId);

        return {
          messages: own
            .slice(Math.max(0, own.length - limit))
            .map((entry) => ({ id: entry.id, read: entry.read, event: structuredClone(entry.event) })),
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
        const storedAction: StoredAction = { ...structuredClone(action), id: stored.nextActionId };
        stored.nextActionId += 1;
        stored.actions.push(storedAction);

        return structuredClone(storedAction);
      },
      cancel: async (id) => {
        stored.actions = stored.actions.filter((action) => action.id !== id);
      },
      cancelPerson: async (personId) => {
        stored.actions = stored.actions.filter((action) => action.personId !== personId);
      },
      save: async (world, events, accounts = new Map()) => {
        stored.snapshot = {
          town: stored.snapshot.town,
          world: structuredClone(world),
          worldStartedAt: stored.snapshot.worldStartedAt,
        };
        for (const event of events) {
          if (event.audience === 'town') {
            stored.chronicle.push({ id: stored.nextEventId, event: structuredClone(event), recordedAt: this.now() });
            stored.nextEventId += 1;
          } else if (typeof event.audience === 'object') {
            const playerId = accounts.get(event.audience.personId);
            // An AI person has no mailbox: the line is written for nobody.
            if (playerId !== undefined) {
              stored.messages.push({
                id: stored.nextMessageId,
                playerId,
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
