import { advance, humanDynastyOf, PACING, type Event, type World } from '@brigue/core';

import type { Logger } from '../logger.ts';
import type { Player, PlayerStore } from '../identity/players.ts';
import { applyPresence, removeDynasty } from './presence.ts';
import {
  HOUR_MS,
  UnknownWorldError,
  sessionWorld,
  type TownInfo,
  type WorldSession,
  type WorldStore,
} from './worlds.ts';

export interface Due {
  /** The town after the pass. */
  world: World;
  /** The instant the town's current hour began, after the pass. */
  hourStartedAt: Date;
  /** Whole hours the town lived in this pass. */
  hours: number;
  /** Hours the wall clock jumped over because the backlog was too long. */
  skipped: number;
  events: Event[];
}

export interface Source {
  world: World;
  hourStartedAt: Date;
}

/**
 * Plays every whole hour the town owes, in order, and moves the wall-clock
 * anchor by the same amount: a town three hours behind is played hour by hour,
 * so a late pass and three on-time passes leave the same town.
 *
 * Beyond `maxCatchUpHours` the wall clock jumps over the backlog. Those hours
 * were never lived, and the town only counts the ones it played.
 *
 * `minHours` is what separates the scheduler from the reader: the scheduler
 * plays from the first unplayed hour, the reader only wakes the town when it is
 * more than an hour behind — that is, when the scheduler is down.
 *
 * Pure: the caller decides whether to save the result.
 */
export async function playDue(session: WorldSession, source: Source, now: Date, minHours = 1): Promise<Due> {
  const elapsed = Math.floor((now.getTime() - source.hourStartedAt.getTime()) / HOUR_MS);

  if (elapsed < minHours) {
    return { world: source.world, hourStartedAt: source.hourStartedAt, hours: 0, skipped: 0, events: [] };
  }

  const hours = Math.min(elapsed, PACING.maxCatchUpHours);
  const skipped = elapsed - hours;
  const until = source.world.hour + hours - 1;
  const actions = await session.actionsBetween(source.world.hour, until);
  const result = advance(
    source.world,
    until,
    actions.map((stored) => ({ at: stored.playsAt, action: stored.action })),
  );

  // The anchor moves by every elapsed hour, played or skipped, so the town's
  // clock and the wall clock agree again.
  return {
    world: result.world,
    hourStartedAt: new Date(source.hourStartedAt.getTime() + elapsed * HOUR_MS),
    hours,
    skipped,
    events: result.events,
  };
}

export interface SchedulerOptions {
  /** The town. */
  store: WorldStore;
  /** The players, so a silent town expires without waiting for a visit. */
  players: PlayerStore;
  logger: Logger;
  now: () => Date;
  /** How often the loop looks at the clock. A minute is enough for an hour's step. */
  everyMs?: number;
}

/**
 * The town moves without a reader. The loop looks at the clock, and the lock in
 * the store makes two passes on the same town harmless: the second finds nothing
 * due and writes nothing. Every town is played on its own: a town that fails
 * must not freeze the others.
 */
export function startScheduler(options: SchedulerOptions): { stop(): void } {
  const everyMs = options.everyMs ?? 60_000;
  let busy = false;

  const pass = async (): Promise<void> => {
    if (busy) {
      return;
    }

    busy = true;

    try {
      const at = options.now();

      // An account a reset left between towns belongs to none, so the per-town
      // sweep never sees it: its own deadline is checked once per pass.
      await eraseUnboundAccounts(options.players, at, options.logger);

      const towns = await options.store.listTowns();

      for (const town of towns) {
        await playTown(town, at);
      }
    } catch (error) {
      // The list itself is unreachable: the database is down, and every town
      // waits for the next pass.
      failure(options.logger, undefined, error);
    } finally {
      busy = false;
    }
  };

  async function playTown(town: TownInfo, at: Date): Promise<void> {
    try {
      const outcome = await options.store.withWorld(async (session) => {
        const world = sessionWorld(session);

        // The same silence rule the read path applies, but on its own clock: a
        // town whose last human has gone expires even if nobody comes back.
        const players = await options.players.listByTown(town.id);
        const presence = applyPresence(world, players, at.getTime());

        for (const dynastyId of presence.deletedDynastyIds) {
          await options.players.revokeDynasty(town.id, dynastyId, at);
          options.logger.warn('world.dynasty_deleted', { townId: town.id, dynastyId });
        }

        // The identities whose week is over go before the hour plays: a dynasty
        // being erased must not act again.
        const expired = players.filter(
          (player): player is Player & { dynastyId: string } =>
            player.dynastyId !== null && player.deleteAfter !== null && player.deleteAfter.getTime() <= at.getTime(),
        );
        const dynasties = new Set(expired.map((player) => player.dynastyId));

        for (const dynastyId of dynasties) {
          removeDynasty(presence.world, dynastyId);
          await session.cancelDynasty(dynastyId, at);
        }

        if (humanDynastyOf(presence.world) === undefined) {
          await session.clear();
          options.logger.info('town.deleted', { townId: town.id });
          return { expired, hour: null };
        }

        const due = await playDue(
          session,
          { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
          at,
        );

        if (due.hours > 0 || presence.changed || dynasties.size > 0) {
          await session.save(due.world, due.hourStartedAt, due.events);
        }
        if (due.skipped > 0) {
          options.logger.warn('town.catch_up_capped', { townId: town.id, skipped: due.skipped });
        }
        if (due.hours > 0) {
          options.logger.info('town.advanced', { townId: town.id, hours: due.hours });
        }

        return { expired, hour: due.world.hour };
      }, town.id);

      // The rows go once the world has committed: a failed save leaves the
      // identity whole, and the next pass tries again.
      for (const dynastyId of new Set(outcome.expired.map((player) => player.dynastyId))) {
        await options.players.deleteDynasty(town.id, dynastyId);
        options.logger.info('player.deleted', { townId: town.id, dynastyId });
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
    } catch (error) {
      // A town deleted between the list and the lock is no town: the next join
      // starts a new one.
      if (error instanceof UnknownWorldError) {
        return;
      }

      // A stopped scheduler leaves every screen healthy and the town frozen, so
      // the failure is logged on every pass: silence is the failure mode.
      failure(options.logger, town.id, error);
    }
  }

  async function pruneJournal(townId: number, chronicleBefore: Date, messagesBefore: Date): Promise<void> {
    try {
      await options.store.pruneJournal(townId, chronicleBefore, messagesBefore);
    } catch (error) {
      // A journal that cannot be pruned grows, but the town must keep playing:
      // this failure gets its own line and the next pass tries again.
      options.logger.warn('town.journal_prune_failed', {
        townId: townId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

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

function failure(logger: Logger, townId: number | undefined, error: unknown): void {
  logger.warn('town.advance_failed', {
    ...(townId === undefined ? {} : { townId }),
    detail: error instanceof Error ? error.message : String(error),
  });
}
