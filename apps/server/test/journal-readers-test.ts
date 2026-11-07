import { describe, expect, it } from 'vitest';

import type { Event } from '@brigue/core';

import { JOURNAL_PAGE, MemoryWorldStore, type JournalPage, type WorldSession } from '../src/town/worlds.ts';
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
 * The journal is read one reader at a time: the town's events are shared, but
 * each dynasty holds its own cursor, so one player reading must never hide a
 * line from another.
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

  it('hands each reader the lines after their own cursor', async () => {
    // Arrange: three lines, and one reader who has already read the first.
    const { session } = await stored();
    await session.save(session.snapshot.world, session.snapshot.hourStartedAt, [event(1), event(2), event(3)]);
    const first = await session.eventsSince(0, JOURNAL_PAGE, 'leclerc');

    // Act: the other reader starts from zero, the first from its cursor.
    const second = await session.eventsSince(0, JOURNAL_PAGE, 'caron');
    const again = await session.eventsSince(second.lastId, JOURNAL_PAGE, 'leclerc');

    // Assert
    expect(first.events).toHaveLength(3);
    expect(second.events).toHaveLength(3);
    expect(again.events).toEqual([]);
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
    const other = await session.eventsSince(0, JOURNAL_PAGE, 'caron');
    const own = await session.eventsSince(0, JOURNAL_PAGE, 'leclerc');

    // Assert
    expect(other.events.map((entry) => entry.type)).toEqual(['market.price_changed']);
    expect(own.events.map((entry) => entry.type)).toEqual(['dynasty.upkeep_paid', 'market.price_changed']);
  });
});

describe('the page of a journal', () => {
  it('keeps the newest page and counts what it left behind', async () => {
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
    const page: JournalPage | null = await store.withWorld(
      async (session) => session.eventsSince(0, JOURNAL_PAGE, 'leclerc'),
      info.id,
    );

    // Assert: the page reads in time, and the five oldest are counted, not lost.
    expect(page?.events).toHaveLength(JOURNAL_PAGE);
    expect(page?.events.at(0)?.at).toBe(5);
    expect(page?.counts['market.price_changed']).toBe(5);
  });
});
