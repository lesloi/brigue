import { describe, expect, it } from 'vitest';

import { MemoryPlayerStore } from '../src/identity/players.ts';
import { issueToken } from '../src/identity/session.ts';
import { createLogger } from '../src/logger.ts';
import { advanceTown } from '../src/town/catch-up.ts';
import { MemoryWorldStore } from '../src/town/worlds.ts';
import { LECLERC, TEST_TOWN, town } from './helpers.ts';

const START = new Date('2026-11-05T00:00:00.000Z');

describe('advanceTown', () => {
  it('anchors the next hour on a fresh clock read, not on the request instant', async () => {
    // Arrange: the request arrived first, and the hour was played before the
    // clock was read again.
    const worlds = new MemoryWorldStore();
    const players = new MemoryPlayerStore();
    await worlds.createTown(TEST_TOWN.name, town(20261105), START);
    const { player } = await issueToken(players, 'Leclerc', START);
    await players.rebind(player.tokenHash, TEST_TOWN.id, LECLERC, START);
    const access = { players, worlds, logger: createLogger(() => {}) };
    const at = new Date(START.getTime() + 1_000);
    const savedAt = new Date(START.getTime() + 1_042);

    // Act
    const outcome = await advanceTown(access, TEST_TOWN.id, LECLERC, player.playerId, at, () => savedAt.getTime());

    // Assert: both the result and the stored town carry the post-advance read.
    expect(outcome.kind).toBe('caught');
    if (outcome.kind !== 'caught') {
      return;
    }
    expect(outcome.result.hourStartedAt).toEqual(savedAt);
    expect(await worlds.withWorld(async (session) => session.snapshot.hourStartedAt, TEST_TOWN.id)).toEqual(savedAt);
  });
});
