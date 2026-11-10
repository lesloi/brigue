import { advance, humanPersonOf, PACING, type Event, type World } from '@brigue/core';

import type { Logger } from '../logger.ts';
import type { Player, PlayerStore } from '../identity/players.ts';
import { applyPresence, removePerson } from './presence.ts';
import {
  HOUR_MS,
  UnknownWorldError,
  hourAt,
  hourStartedOf,
  sessionWorld,
  type TownInfo,
  type WorldSession,
  type WorldStore,
} from './worlds.ts';

export interface Due {
  /** The town after the pass. */
  world: World;
  /** Whole hours the town lived in this pass. */
  hours: number;
  events: Event[];
}

/**
 * Plays every whole hour the world owes, up to `target`, in order: a late pass
 * and several on-time passes leave the same town.
 *
 * `target` is the hour the world has reached, exclusive — the hours played are
 * `[world.hour, target - 1]`, and the town comes out at `target`. The world is
 * born on hour 1, so a town created at `START` plays its first hour at
 * `START + HOUR_MS`.
 *
 * `random` is the world's stream, injected so a test replays the same town.
 *
 * Pure: the caller decides whether to save the result.
 */
export async function playDue(
  session: WorldSession,
  world: World,
  target: number,
  dormant: ReadonlySet<number>,
  random: () => number,
): Promise<Due> {
  const hours = target - world.hour;

  if (hours <= 0) {
    return { world, hours: 0, events: [] };
  }

  const actions = await session.actionsBetween(world.hour, target - 1);
  const result = advance(
    world,
    target - 1,
    actions.map((stored) => ({ at: stored.playsAt, action: stored.action })),
    dormant,
    random,
  );

  return { world: result.world, hours, events: result.events };
}

export interface WorldPass {
  store: WorldStore;
  /** The players, so a silent town expires without waiting for a visit. */
  players: PlayerStore;
  logger: Logger;
  /** The world's random stream. A test passes a seeded one to replay a pass. */
  random?: () => number;
}

export interface SchedulerOptions extends WorldPass {
  now: () => Date;
  /** How often the loop looks at the clock. A minute is enough for an hour's step. */
  everyMs?: number;
}

/**
 * The town moves without a reader: one pass over the world plays every hour the
 * wall clock owes, for every town alike. Only one pass runs at a time: the
 * store's pass lock makes the second read a world the first already brought up,
 * so it finds nothing due and writes nothing. A town that fails is logged while
 * the others still move.
 *
 * The target hour is computed once per pass, from the world's origin, and every
 * town advances to it: there is one clock for the world, and no town can move
 * it alone. A visit calls this too, so a reader never advances only its own
 * town.
 */
export async function playWorld(pass: WorldPass, at: Date): Promise<number> {
  // Two passes read the same clock before either has played it, and would play
  // the same hours twice: the pass owns the world for its duration.
  return pass.store.withPassLock(() => passOnce(pass, at));
}

/** Returns the whole hours the world lived in this pass, which is none if another was before it. */
async function passOnce(pass: WorldPass, at: Date): Promise<number> {
  const random = pass.random ?? Math.random;

  // An account a reset left between towns belongs to none, so the per-town
  // sweep never sees it: its own deadline is checked once per pass.
  await eraseUnboundAccounts(pass.players, at, pass.logger);

  const towns = await pass.store.listTowns();
  if (towns.length === 0) {
    return 0;
  }

  // One clock, one target: read it before any town advances, so nothing moves
  // the hour under the towns behind it.
  const clock = await pass.store.readClock();
  if (clock === null) {
    throw new Error('the world has no settings');
  }
  const target = hourAt(clock.worldStartedAt, at);
  const played = hourAt(clock.worldStartedAt, clock.lastRunAt);

  let advanced = false;

  for (const town of towns) {
    advanced = (await playTown(town, at, target)) || advanced;
  }

  // The data's watermark moves once, after every town, and only if some town
  // lived an hour: a marker moved mid-pass would let a reader label rows with
  // an hour they have not lived, and one moved by a town's save would speak for
  // the others.
  if (!advanced || target <= played) {
    return 0;
  }

  await pass.store.markWorldPlayed(hourStartedOf(clock.worldStartedAt, target));

  return target - played;

  async function playTown(town: TownInfo, at: Date, target: number): Promise<boolean> {
    try {
      const outcome = await pass.store.withWorld(async (session) => {
        const world = sessionWorld(session);

        // The same silence rule the read path applies, but on its own clock: a
        // town whose last human has gone expires even if nobody comes back.
        const players = await pass.players.listByTown(town.id);
        const presence = applyPresence(world, players, at.getTime());
        const accounts = accountsOf(players);

        for (const personId of presence.deletedPersonIds) {
          await pass.players.deletePerson(personId);
          pass.logger.warn('world.person_deleted', { townId: town.id, personId });
        }

        // The identities whose week is over go before the hour plays: a person
        // being erased must not act again.
        const expired = players.filter(
          (player): player is Player & { personId: number } =>
            player.personId !== null && player.deleteAfter !== null && player.deleteAfter.getTime() <= at.getTime(),
        );
        const persons = new Set(expired.map((player) => player.personId));

        for (const personId of persons) {
          removePerson(presence.world, personId);
          await session.cancelPerson(personId);
          // The person row still exists here: erase the account before the
          // save removes the row it is found through.
          await pass.players.deletePerson(personId);
        }

        if (humanPersonOf(presence.world) === undefined) {
          await session.clear();
          pass.logger.info('town.deleted', { townId: town.id });
          return { expired, hour: null, advanced: false };
        }

        const due = await playDue(session, presence.world, target, presence.dormant, random);

        if (due.hours > 0 || presence.deletedPersonIds.length > 0 || persons.size > 0) {
          await session.save(due.world, due.events, accounts);
        }
        if (due.hours > 0) {
          pass.logger.info('town.advanced', { townId: town.id, hours: due.hours });
        }

        return { expired, hour: due.world.hour, advanced: due.hours > 0 };
      }, town.id);

      for (const personId of new Set(outcome.expired.map((player) => player.personId))) {
        pass.logger.info('player.deleted', { townId: town.id, personId });
      }

      // The chronicle keeps the last seven real days and the mail thirty: what
      // fell out of each window goes, even on a pass that played nothing. A town
      // that was just deleted carries no hour.
      if (outcome.hour !== null) {
        await pruneJournal(
          town.id,
          new Date(at.getTime() - PACING.chronicleRetentionHours * HOUR_MS),
          new Date(at.getTime() - PACING.messageRetentionHours * HOUR_MS),
        );
      }

      return outcome.advanced;
    } catch (error) {
      // A town deleted between the list and the lock is no town: the next join
      // starts a new one.
      if (error instanceof UnknownWorldError) {
        return false;
      }

      // A stopped scheduler leaves every screen healthy and the town frozen, so
      // the failure is logged on every pass: silence is the failure mode.
      failure(pass.logger, town.id, error);

      return false;
    }
  }

  async function pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    try {
      await pass.store.pruneJournal(townId, chronicleBefore, messagesBefore);
    } catch (error) {
      // A journal that cannot be pruned grows, but the town must keep playing:
      // this failure gets its own line and the next pass tries again.
      pass.logger.warn('town.journal_prune_failed', {
        townId: townId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function startScheduler(options: SchedulerOptions): { stop(): void } {
  const everyMs = options.everyMs ?? 60_000;
  let busy = false;

  const pass = async (): Promise<void> => {
    if (busy) {
      return;
    }

    busy = true;

    try {
      await playWorld(options, options.now());
    } catch (error) {
      // The list itself is unreachable: the database is down, and every town
      // waits for the next pass.
      failure(options.logger, undefined, error);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void pass(), everyMs);
  // The loop must not hold the process open on its own: a deploy that stops the
  // server stops the town until the next one starts.
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}

/**
 * The accounts a reset left without a dynasty: their deletion deadline is the
 * same promise as a dynasty's, and the erasure is the row itself. A failure here
 * must not stop the towns, so it gets its own line and the next pass retries.
 */
async function eraseUnboundAccounts(players: PlayerStore, at: Date, logger: Logger): Promise<void> {
  try {
    const erased = await players.deleteUnboundDue(at);

    if (erased > 0) {
      logger.info('player.deleted_unbound', { count: erased });
    }
  } catch (error) {
    logger.warn('player.erase_failed', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The account that reads each person's mail, for the store's message writer. */
export function accountsOf(players: readonly Player[]): Map<number, number> {
  const accounts = new Map<number, number>();

  for (const player of players) {
    if (player.personId !== null) {
      accounts.set(player.personId, player.playerId);
    }
  }

  return accounts;
}

function failure(logger: Logger, townId: number | undefined, error: unknown): void {
  logger.warn('town.advance_failed', {
    ...(townId === undefined ? {} : { townId }),
    detail: error instanceof Error ? error.message : String(error),
  });
}
