import {
  advance,
  firstHouseOf,
  FORMAT_VERSION,
  PACING,
  RULES,
  WorldVersionError,
  type Event,
  type World,
} from '@brigue/core';

import type { Logger } from './logger.ts';
import type { PlayerStore } from './players.ts';
import { applyPresence } from './presence.ts';
import { HOUR_MS, UnknownWorldError, WORLD_ID, type WorldSession, type WorldStore } from './worlds.ts';

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
 * due and writes nothing.
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
      await options.store.withWorld(async (session) => {
        const world = session.snapshot.world;

        if (world.formatVersion !== FORMAT_VERSION || world.rulesetVersion !== RULES.version) {
          throw new WorldVersionError(world);
        }

        // The same silence rule the read path applies, but on its own clock: a
        // town whose last human has gone expires even if nobody comes back.
        const at = options.now();
        const presence = applyPresence(world, await options.players.listByWorld(WORLD_ID), at.getTime());

        for (const houseId of presence.deletedHouseIds) {
          await options.players.revokeHouse(WORLD_ID, houseId, at);
          options.logger.warn('world.house_deleted', { worldId: WORLD_ID, houseId });
        }

        if (firstHouseOf(presence.world) === undefined) {
          await session.clear();
          options.logger.info('town.deleted', { worldId: WORLD_ID });
          return;
        }

        const due = await playDue(
          session,
          { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
          at,
        );

        if (due.hours > 0 || presence.changed) {
          await session.save(due.world, due.hourStartedAt, due.events);
        }
        if (due.skipped > 0) {
          options.logger.warn('town.catch_up_capped', { skipped: due.skipped });
        }
        if (due.hours > 0) {
          options.logger.info('town.advanced', { hours: due.hours });
        }
      });
    } catch (error) {
      // A town with no player is no town: the read path deletes it, and the
      // next join starts a new one. That is not a failure to report.
      if (error instanceof UnknownWorldError) {
        return;
      }

      // A stopped scheduler leaves every screen healthy and the town frozen, so
      // the failure is logged on every pass: silence is the failure mode.
      options.logger.warn('town.advance_failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
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
