import { advance, PACING, type Event } from '@brigue/core';

import type { Logger } from './logger.ts';
import { HOUR_MS, type WorldSession, type WorldStore } from './worlds.ts';

export interface Played {
  /** Whole hours the town lived in this pass. */
  hours: number;
  /** Hours the wall clock jumped over because the backlog was too long. */
  skipped: number;
  events: Event[];
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
 */
export async function advanceIfDue(session: WorldSession, now: Date, minHours = 1): Promise<Played> {
  const { world, hourStartedAt } = session.snapshot;
  const elapsed = Math.floor((now.getTime() - hourStartedAt.getTime()) / HOUR_MS);

  if (elapsed < minHours) {
    return { hours: 0, skipped: 0, events: [] };
  }

  const hours = Math.min(elapsed, PACING.maxCatchUpHours);
  const skipped = elapsed - hours;
  const until = world.hour + hours - 1;
  const actions = await session.actionsBetween(world.hour, until);
  const result = advance(
    world,
    until,
    actions.map((stored) => ({ at: stored.playsAt, action: stored.action })),
  );

  // The anchor moves by every elapsed hour, played or skipped, so the town's
  // clock and the wall clock agree again.
  await session.save(result.world, new Date(hourStartedAt.getTime() + elapsed * HOUR_MS), result.events);

  return { hours, skipped, events: result.events };
}

export interface SchedulerOptions {
  store: WorldStore;
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
        const played = await advanceIfDue(session, options.now());

        if (played.skipped > 0) {
          options.logger.warn('town.catch_up_capped', { skipped: played.skipped });
        }
        if (played.hours > 0) {
          options.logger.info('town.advanced', { hours: played.hours });
        }
      });
    } catch (error) {
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
