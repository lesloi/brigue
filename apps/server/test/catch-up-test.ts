import { describe, expect, it } from 'vitest';

import { MemoryPlayerStore } from '../src/identity/players.ts';
import { issueToken } from '../src/identity/session.ts';
import { createLogger } from '../src/logger.ts';
import { advanceTown, catchUpTown } from '../src/town/catch-up.ts';
import { HOUR_MS, MemoryWorldStore, hourAt } from '../src/town/worlds.ts';
import { LECLERC, TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-11-05T00:00:00.000Z');
const HOUR = HOUR_MS;

describe('catchUpTown', () => {
  it('advances every town, not only the one visited', async () => {
    // Arrange: two towns, one reader, and an hour the scheduler has not played.
    const worlds = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const first = await worlds.createTown('A', town(20261105), START);
    const second = await worlds.createTown('B', town(20261106), START);
    const { player } = await issueToken(players, 'Leclerc', START);
    await players.rebind(player.tokenHash, first.id, LECLERC, START);
    const access = { players, worlds, logger: createLogger(() => {}) };

    // Act: the reader visits the first town, two hours after the founding.
    const outcome = await catchUpTown(access, first.id, LECLERC, player.playerId, new Date(START.getTime() + 2 * HOUR));

    // Assert: the world moved, so both towns lived the two hours.
    expect(outcome.kind).toBe('caught');
    if (outcome.kind !== 'caught') {
      return;
    }
    expect(outcome.hours).toBe(2);
    expect(outcome.world.hour).toBe(3);
    expect(await worlds.withWorld(async (session) => session.snapshot.world.hour, second.id)).toBe(3);
  });

  it('writes nothing when the world owes no hour', async () => {
    // Arrange: the scheduler has already played the hour the clock shows.
    const worlds = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    const created = await worlds.createTown(TEST_TOWN.name, town(20261105), START);
    const { player } = await issueToken(players, 'Leclerc', START);
    await players.rebind(player.tokenHash, created.id, LECLERC, START);
    const access = { players, worlds, logger: createLogger(() => {}) };
    const at = new Date(START.getTime() + HOUR - 1);

    // Act
    const outcome = await catchUpTown(access, created.id, LECLERC, player.playerId, at);

    // Assert: the visit only read.
    expect(outcome.kind).toBe('caught');
    if (outcome.kind !== 'caught') {
      return;
    }
    expect(outcome.hours).toBe(0);
    expect(outcome.world.hour).toBe(1);
    expect((await worlds.readClock())?.lastRunAt).toEqual(START);
  });
});

describe('advanceTown', () => {
  it('moves the world clock an hour ahead of the wall clock, and plays that hour', async () => {
    // Arrange: development wants the next hour now, and the hour belongs to the
    // world, so the world's origin moves rather than a town's.
    const worlds = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    await worlds.createTown(TEST_TOWN.name, town(20261105), START);
    const { player } = await issueToken(players, 'Leclerc', START);
    await players.rebind(player.tokenHash, TEST_TOWN.id, LECLERC, START);
    const access = { players, worlds, logger: createLogger(() => {}) };
    const at = new Date(START.getTime() + 1_000);

    // Act
    const outcome = await advanceTown(access, TEST_TOWN.id, LECLERC, player.playerId, at);

    // Assert: the hour played, and the world now counts one more than the real
    // time elapsed since the founding.
    expect(outcome.kind).toBe('caught');
    if (outcome.kind !== 'caught') {
      return;
    }
    expect(outcome.hours).toBe(1);
    expect(outcome.world.hour).toBe(2);

    const clock = await worlds.readClock();
    expect(clock?.worldStartedAt).toEqual(new Date(START.getTime() - HOUR));
    expect(hourAt(clock!.worldStartedAt, at)).toBe(2);
  });
});
