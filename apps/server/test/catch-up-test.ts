import { describe, expect, it } from 'vitest';

import {
  createWorld,
  PACING,
  RULES,
  stateHash,
  tick,
  WorldVersionError,
  type Action,
  type Event,
  type World,
} from '@brigue/core';

import { catchUp } from '../src/catch-up.ts';
import type { StoredAction } from '../src/worlds.ts';

const START = new Date('2026-10-31T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function storedAction(id: string, week: number, action: Action): StoredAction {
  return { id, houseId: 'brigue', week, action, receivedAt: START };
}

function buyWool(units: number): Action {
  return { type: 'market.buy', houseId: 'brigue', good: 'wool', units };
}

function run(options: {
  world?: World;
  weekStartedAt?: Date;
  now?: Date;
  actions?: Map<number, StoredAction[]>;
  lastEvents?: Event[];
  maxWeeks?: number;
}) {
  const actions = options.actions ?? new Map<number, StoredAction[]>();

  return catchUp({
    world: options.world ?? createWorld(20261031),
    weekStartedAt: options.weekStartedAt ?? START,
    lastEvents: options.lastEvents ?? [],
    now: options.now ?? START,
    actionsFor: async (week) => actions.get(week) ?? [],
    maxWeeks: options.maxWeeks,
  });
}

describe('catching the world up', () => {
  it('does nothing until a whole week has elapsed', async () => {
    // Arrange
    const world = createWorld(20261031);

    // Act
    const result = await run({ world, now: new Date(START.getTime() + HOUR - 1) });

    // Assert
    expect(result.summary).toEqual({ weeksPlayed: 0, skippedWeeks: 0, counts: {}, refusals: {} });
    expect(result.events).toEqual([]);
    expect(stateHash(result.world)).toBe(stateHash(world));
    expect(result.weekStartedAt).toEqual(START);
  });

  it('plays one week per elapsed hour and keeps the partial hour', async () => {
    // Arrange
    const now = new Date(START.getTime() + HOUR + 59 * 60_000);

    // Act
    const result = await run({ now });

    // Assert
    expect(result.summary.weeksPlayed).toBe(1);
    expect(result.world.week).toBe(2);
    expect(result.weekStartedAt).toEqual(new Date(START.getTime() + HOUR));
  });

  it('returns the same events and hash when read again with no time passing', async () => {
    // Arrange
    const first = await run({ now: new Date(START.getTime() + HOUR) });

    // Act
    const second = await run({
      world: first.world,
      weekStartedAt: first.weekStartedAt,
      lastEvents: first.events,
      now: new Date(START.getTime() + HOUR),
    });

    // Assert
    expect(second.summary.weeksPlayed).toBe(0);
    expect(second.events).toEqual(first.events);
    expect(stateHash(second.world)).toBe(stateHash(first.world));
  });

  it('applies a week to the actions queued for that week, before its tick', async () => {
    // Arrange
    const actions = new Map<number, StoredAction[]>([
      [1, [storedAction('a1', 1, buyWool(1))]],
      [2, [storedAction('a2', 2, buyWool(2))]],
    ]);

    // Act
    const result = await run({ actions, now: new Date(START.getTime() + 2 * HOUR) });

    // Assert
    expect(result.events[0]).toMatchObject({ type: 'market.bought', houseId: 'brigue', units: 2 });
    expect(result.summary.counts['market.bought']).toBe(1);
    expect(result.summary.counts['market.sold']).toBe(4);
  });

  it('applies the actions of one week in the order they were received', async () => {
    // Arrange
    const actions = new Map<number, StoredAction[]>([
      [1, [storedAction('a1', 1, buyWool(1)), storedAction('a2', 1, buyWool(2))]],
    ]);

    // Act
    const result = await run({ actions, now: new Date(START.getTime() + HOUR) });

    // Assert
    const bought = result.events.filter((event) => event.type === 'market.bought');
    expect(bought.map((event) => (event.type === 'market.bought' ? event.units : 0))).toEqual([1, 2]);
  });

  it('reduces every week but the last to counters', async () => {
    // Arrange
    const world = createWorld(20261031);
    const first = tick(world, []);
    const second = tick(first.world, []);
    const third = tick(second.world, []);

    // Act
    const result = await run({ world, now: new Date(START.getTime() + 3 * HOUR) });

    // Assert
    expect(result.summary.weeksPlayed).toBe(3);
    expect(result.summary.counts).toEqual(countTypes([...first.events, ...second.events]));
    expect(result.events).toEqual(third.events);
  });

  it('catches a month-long absence up in one call', async () => {
    // Arrange
    const month = 30 * 24 * HOUR;

    // Act
    const result = await run({ now: new Date(START.getTime() + month) });

    // Assert
    expect(result.summary.weeksPlayed).toBe(720);
    expect(result.summary.skippedWeeks).toBe(0);
    expect(result.world.week).toBe(721);
    expect(result.events.length).toBeLessThan(100);
  });

  it('caps the ticks and jumps the clock over the rest of a longer absence', async () => {
    // Arrange
    const elapsed = PACING.maxCatchUpWeeks + 100;
    const now = new Date(START.getTime() + elapsed * HOUR);

    // Act
    const result = await run({ now });

    // Assert
    expect(result.summary.weeksPlayed).toBe(PACING.maxCatchUpWeeks);
    expect(result.summary.skippedWeeks).toBe(100);
    // The skipped weeks never happened: the town only counts what it lived.
    expect(result.world.week).toBe(1 + PACING.maxCatchUpWeeks);
    expect(result.weekStartedAt.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(result.weekStartedAt.getTime()).toBeGreaterThan(now.getTime() - HOUR);
  });

  it('refuses a world of another version before replaying anything', async () => {
    // Arrange
    const world = { ...createWorld(1), rulesetVersion: RULES.version + 1 };
    let asked = false;

    // Act
    const attempt = catchUp({
      world,
      weekStartedAt: START,
      lastEvents: [],
      now: new Date(START.getTime() + HOUR),
      actionsFor: async () => {
        asked = true;
        return [];
      },
    });

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(WorldVersionError);
    expect(asked).toBe(false);
  });
});

function countTypes(events: readonly Event[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  return counts;
}
