import { describe, expect, it } from 'vitest';

import type { Event } from '@brigue/core';

import { JOURNAL_PAGE, MemoryWorldStore, type WorldSession } from '../src/town/worlds.ts';
import { town } from './helpers.ts';

const event = (at: number): Event => ({
  at,
  type: 'market.price_changed',
  audience: 'town',
  good: 'cloth',
  before: 1,
  after: 2,
});

/**
 * The journal is a window, not a feed: the town's events are shared, every
 * reader gets the same newest page, and no reader's visit can hide a line from
 * another.
 */
describe('the journal of a town with two readers', () => {
  async function stored(): Promise<{ store: MemoryWorldStore; session: WorldSession }> {
    const store = new MemoryWorldStore();
    const info = await store.createTown('Amiens', town(7), new Date());

    return {
      store,
      session: await new Promise<WorldSession>((resolve) => {
        void store.withWorld(async (session) => {
          resolve(session);
        }, info.id);
      }),
    };
  }

  it('hands every reader the same newest page', async () => {
    // Arrange: three lines.
    const { session } = await stored();
    await session.save(session.snapshot.world, session.snapshot.hourStartedAt, [event(1), event(2), event(3)]);

    // Act: one reader reads, then the other, then the first again.
    const first = await session.recentEvents(JOURNAL_PAGE, 'leclerc');
    const second = await session.recentEvents(JOURNAL_PAGE, 'caron');
    const again = await session.recentEvents(JOURNAL_PAGE, 'leclerc');

    // Assert: reading is not a consumption; the page is the same for all.
    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    expect(again).toEqual(first);
  });

  it('keeps a dynasty line from another dynasty', async () => {
    // Arrange: one line for the clerk, one for the town.
    const { session } = await stored();
    await session.save(session.snapshot.world, session.snapshot.hourStartedAt, [
      {
        type: 'dynasty.upkeep_paid',
        audience: { dynastyId: 'leclerc' },
        at: 1,
        dynastyId: 'leclerc',
        amountCents: 240,
      },
      event(2),
    ]);

    // Act
    const other = await session.recentEvents(JOURNAL_PAGE, 'caron');
    const own = await session.recentEvents(JOURNAL_PAGE, 'leclerc');

    // Assert
    expect(other.map((entry) => entry.type)).toEqual(['market.price_changed']);
    expect(own.map((entry) => entry.type)).toEqual(['dynasty.upkeep_paid', 'market.price_changed']);
  });
});

describe('the page of a journal', () => {
  it('keeps the newest page', async () => {
    // Arrange: more lines than a page.
    const store = new MemoryWorldStore();
    const info = await store.createTown('Amiens', town(7), new Date());
    await store.withWorld(async (session) => {
      await session.save(
        session.snapshot.world,
        session.snapshot.hourStartedAt,
        Array.from({ length: JOURNAL_PAGE + 5 }, (_, index) => event(index)),
      );
    }, info.id);

    // Act
    const page = await store.withWorld(async (session) => session.recentEvents(JOURNAL_PAGE, 'leclerc'), info.id);

    // Assert: the page reads in time, and the five oldest fall out of it.
    expect(page).toHaveLength(JOURNAL_PAGE);
    expect(page.at(0)?.at).toBe(5);
  });
});
