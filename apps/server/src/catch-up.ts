import {
  FORMAT_VERSION,
  PACING,
  RULES,
  tick,
  WorldVersionError,
  type Event,
  type RefusalReason,
  type World,
} from '@brigue/core';

import type { StoredAction } from './worlds.ts';

export const WEEK_MS = PACING.minutesPerWeek * 60_000;

export interface CatchUpSummary {
  weeksPlayed: number;
  /**
   * Weeks the wall clock jumped over because the backlog exceeded the cap.
   * They were never simulated, so their events do not exist and are not counted;
   * the town's week counter only advances with the weeks it actually lived.
   */
  skippedWeeks: number;
  counts: Partial<Record<Event['type'], number>>;
  refusals: Partial<Record<RefusalReason, number>>;
}

export interface CatchUpResult {
  world: World;
  weekStartedAt: Date;
  /** The last week played, or the one already on record when nothing elapsed. */
  events: Event[];
  summary: CatchUpSummary;
}

export interface CatchUpInput {
  world: World;
  weekStartedAt: Date;
  lastEvents: readonly Event[];
  now: Date;
  actionsFor(week: number): Promise<readonly StoredAction[]>;
  maxWeeks?: number;
}

/**
 * Plays every whole week that elapsed since `weekStartedAt`, one `tick` per
 * week, bounded by `PACING.maxCatchUpWeeks`. Anything beyond the cap is not
 * replayed: the wall clock jumps over it and the summary says how much was
 * skipped. Without that jump a long absence would leave a backlog that every
 * immediate read keeps ticking, and two reads with no time passing would
 * disagree.
 */
export async function catchUp(input: CatchUpInput): Promise<CatchUpResult> {
  // Refuse before any replay, never after a partial catch-up.
  if (input.world.formatVersion !== FORMAT_VERSION || input.world.rulesetVersion !== RULES.version) {
    throw new WorldVersionError(input.world);
  }

  const maxWeeks = input.maxWeeks ?? PACING.maxCatchUpWeeks;
  const elapsed = Math.max(0, Math.floor((input.now.getTime() - input.weekStartedAt.getTime()) / WEEK_MS));
  const weeksPlayed = Math.min(elapsed, maxWeeks);
  const skippedWeeks = elapsed - weeksPlayed;

  const counts: CatchUpSummary['counts'] = {};
  const refusals: CatchUpSummary['refusals'] = {};
  let world = input.world;
  let weekStartedAt = input.weekStartedAt;
  let events: Event[] = [...input.lastEvents];

  for (let played = 0; played < weeksPlayed; played += 1) {
    const queued = await input.actionsFor(world.week);
    const result = tick(
      world,
      queued.map((stored) => stored.action),
    );
    world = result.world;
    weekStartedAt = new Date(weekStartedAt.getTime() + WEEK_MS);

    // Everything but the last week is reduced to counters: a month away must
    // not return thousands of events.
    if (played < weeksPlayed - 1) {
      tally(result.events, counts, refusals);
    } else {
      events = result.events;
    }
  }

  if (skippedWeeks > 0) {
    weekStartedAt = new Date(weekStartedAt.getTime() + skippedWeeks * WEEK_MS);
  }

  return {
    world,
    weekStartedAt,
    events,
    summary: { weeksPlayed, skippedWeeks, counts, refusals },
  };
}

function tally(events: readonly Event[], counts: CatchUpSummary['counts'], refusals: CatchUpSummary['refusals']): void {
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;

    if (event.type === 'action.refused') {
      refusals[event.reason] = (refusals[event.reason] ?? 0) + 1;
    }
  }
}
