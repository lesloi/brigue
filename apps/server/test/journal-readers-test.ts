import { describe, expect, it } from 'vitest';

import type { Event } from '@brigue/core';

import { JOURNAL_PAGE, MemoryWorldStore, type WorldSession } from '../src/town/worlds.ts';
import { LECLERC, town } from './helpers.ts';

const PLAYER = 900_001;
const OTHER_PLAYER = 900_002;
const ACCOUNTS = new Map([[LECLERC, PLAYER]]);

const chronicleAt = (at: number): Event => ({
  at,
  type: 'council.election_held',
  audience: 'town',
  seatId: 'maire',
  winnerPersonId: null,
  votes: {},
});

const mailAt = (at: number, personId: number = LECLERC): Event => ({
  at,
  type: 'person.debt_repaid',
  audience: { personId },
  personId,
  // The payload carries the hour, since a stored message keeps no `at`.
  amountCents: at,
});

/**
 * The journal is two pages: a public chronicle every reader shares, and one
 * mailbox per dynasty. A private line never surfaces in the chronicle, and no
 * reader's visit hides a line from another.
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

  it('puts the town’s line in the chronicle and a person’s in its mailbox', async () => {
    // Arrange: one election and one private debt line.
    const { session } = await stored();
    await session.save(session.snapshot.world, [chronicleAt(1), mailAt(2)], ACCOUNTS);

    // Act
    const chronicle = await session.recentChronicle(JOURNAL_PAGE);
    const leclerc = await session.recentMessages(JOURNAL_PAGE, PLAYER);
    const caron = await session.recentMessages(JOURNAL_PAGE, OTHER_PLAYER);

    // Assert: the private line is in its own box only.
    expect(chronicle.map((event) => event.type)).toEqual(['council.election_held']);
    expect(leclerc.messages.map((message) => message.event.type)).toEqual(['person.debt_repaid']);
    expect(caron.messages).toEqual([]);
  });

  it('hands every reader the same chronicle page', async () => {
    // Arrange: three lines.
    const { session } = await stored();
    await session.save(session.snapshot.world, [chronicleAt(1), chronicleAt(2), chronicleAt(3)]);

    // Act: one reader reads, then the other, then the first again.
    const first = await session.recentChronicle(JOURNAL_PAGE);
    const second = await session.recentChronicle(JOURNAL_PAGE);
    const again = await session.recentChronicle(JOURNAL_PAGE);

    // Assert: reading is not a consumption; the page is the same for all.
    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    expect(again).toEqual(first);
  });

  it('keeps the newest page of a mailbox, and says how much is unread', async () => {
    // Arrange: more lines than a page, all for the weaver.
    const store = new MemoryWorldStore();
    const info = await store.createTown('Amiens', town(7), new Date());
    await store.withWorld(async (session) => {
      await session.save(
        session.snapshot.world,
        Array.from({ length: JOURNAL_PAGE + 5 }, (_, index) => mailAt(index + 1)),
        ACCOUNTS,
      );
    }, info.id);

    // Act
    const page = await store.withWorld(async (session) => session.recentMessages(JOURNAL_PAGE, PLAYER), info.id);

    // Assert: the page reads in time, the five oldest fall out of it, and the
    // badge counts the page it can open.
    expect(page.messages).toHaveLength(JOURNAL_PAGE);
    expect(page.messages.at(0)).toMatchObject({ event: { amountCents: 6 } });
    expect(page.unread).toBe(JOURNAL_PAGE);
  });
});
