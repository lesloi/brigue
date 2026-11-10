import { createWorld, type Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { MemoryWorldStore, UnknownWorldError, type MessageView } from '../src/town/worlds.ts';
import { CARON, LECLERC, town } from './helpers.ts';

const PLAYER = 900_001;
const OTHER_PLAYER = 900_002;
const ACCOUNTS = new Map([[LECLERC, PLAYER]]);

/** One chronicle line per hour, so a cut has a visible order to work on. */
function heldAt(hour: number): Event {
  return {
    type: 'council.election_held',
    audience: 'town',
    at: hour,
    seatId: 'maire',
    winnerPersonId: null,
    votes: {},
  };
}

/** One private line per hour, addressed to the weaver of `town()`. */
function repaidAt(hour: number): Extract<Event, { type: 'person.debt_repaid' }> {
  return {
    type: 'person.debt_repaid',
    audience: { personId: LECLERC },
    at: hour,
    personId: LECLERC,
    // The payload carries the hour, since a stored message keeps no `at`.
    amountCents: hour,
  };
}

function hours(from: number, to: number): Event[] {
  return Array.from({ length: to - from + 1 }, (_, index) => heldAt(from + index));
}

function mailHours(from: number, to: number): Event[] {
  return Array.from({ length: to - from + 1 }, (_, index) => repaidAt(from + index));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** The payload of each message, which carries the hour it stands for. */
function amountsOf(messages: MessageView[]): number[] {
  return messages.map((message) => (message.event.type === 'person.debt_repaid' ? message.event.amountCents : -1));
}

describe('the town store', () => {
  it('keeps two towns apart and clears one without the other', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const first = await store.createTown('A', createWorld(), new Date());
    const second = await store.createTown('B', createWorld(), new Date());

    // Act: each town reads its own snapshot.
    const a = await store.withWorld(async (session) => session.snapshot, first.id);
    const b = await store.withWorld(async (session) => session.snapshot, second.id);

    // Assert: names do not mix, and both towns share the world's seed.
    expect(a.town).toEqual(first);
    expect(b.town).toEqual(second);
    expect(a.world.hour).toBe(b.world.hour);
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([first.id, second.id]);

    // Act: the first town goes, the second stays.
    await store.withWorld(async (session) => session.clear(), first.id);

    // Assert
    await expect(store.withWorld(async (session) => session.snapshot, first.id)).rejects.toBeInstanceOf(
      UnknownWorldError,
    );
    expect((await store.withWorld(async (session) => session.snapshot, second.id)).town.id).toBe(second.id);
  });

  it('lists the least-filled town first, the oldest on a tie', async () => {
    // Arrange: an older town of four people and a younger one of three.
    const store = new MemoryWorldStore();
    const old = await store.createTown('Old', town(1), new Date());
    const young = await store.createTown('New', createWorld(), new Date());

    // Act and assert: the emptier town comes first, whatever its age.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('counts only the living when it picks the least-filled town', async () => {
    // Arrange: the younger town's only person is dead.
    const store = new MemoryWorldStore();
    const old = await store.createTown('Old', town(1), new Date());
    const young = await store.createTown('New', town(1), new Date());
    await store.withWorld(async (session) => {
      const world = session.snapshot.world;
      for (const person of Object.values(world.people)) {
        person.alive = false;
      }
      await session.write(world, []);
    }, young.id);

    // Assert: the dead take no place, so the emptied town comes first.
    expect((await store.listTowns()).map((entry) => entry.id)).toEqual([young.id, old.id]);
  });

  it('gives a name that comes back a new id', async () => {
    // Arrange: a town that has lived and gone.
    const store = new MemoryWorldStore();
    const first = await store.createTown('Amiens', createWorld(), new Date());
    await store.withWorld(async (session) => session.clear(), first.id);

    // Act: the same name comes back.
    const second = await store.createTown('Amiens', createWorld(), new Date());

    // Assert: the id is new, the name is not.
    expect(second.name).toBe('Amiens');
    expect(second.id).not.toBe(first.id);
  });

  it('creates a new town on a second call', async () => {
    // Arrange
    const store = new MemoryWorldStore();
    const first = await store.createTown('A', createWorld(), new Date());

    // Act: a second creation is a second town, not a retry.
    const second = await store.createTown('A', createWorld(), new Date());

    // Assert
    expect(second.id).not.toBe(first.id);
    expect(await store.listTowns()).toHaveLength(2);
  });

  it('drops the chronicle written more than seven days ago', async () => {
    // Arrange: two batches written a week apart.
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => now);
    const created = await store.createTown('A', town(1), now);
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(1, 60));
    }, created.id);
    now = new Date('2026-01-09T00:00:00.000Z');
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(61, 120));
    }, created.id);

    // Act: the cut is seven days after the first batch, before the second.
    await store.pruneJournal(created.id, new Date('2026-01-08T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'));

    // Assert: the second batch survives whole.
    const page = await store.withWorld(async (session) => session.recentChronicle(120), created.id);
    expect(page.map((event) => event.at)).toEqual(range(61, 120));
  });

  it('keeps a chronicle entry exactly on the cut', async () => {
    // Arrange
    const written = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => written);
    const created = await store.createTown('A', town(1), written);
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, hours(1, 10));
    }, created.id);

    // Act: the cut is the write instant itself.
    await store.pruneJournal(created.id, written, new Date('2000-01-01T00:00:00.000Z'));

    // Assert
    const page = await store.withWorld(async (session) => session.recentChronicle(100), created.id);
    expect(page.map((event) => event.at)).toEqual(range(1, 10));
  });

  it('drops the mail written more than thirty days ago, and keeps it past the chronicle cut', async () => {
    // Arrange: one batch written a week ago, one written today.
    let now = new Date('2026-01-01T00:00:00.000Z');
    const store = new MemoryWorldStore(() => now);
    const created = await store.createTown('A', town(1), now);
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, mailHours(1, 10), ACCOUNTS);
    }, created.id);
    now = new Date('2026-01-09T00:00:00.000Z');
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, mailHours(11, 20), ACCOUNTS);
    }, created.id);

    // Act: the chronicle cut falls between the batches, the mail cut before both.
    await store.pruneJournal(created.id, new Date('2026-01-08T00:00:00.000Z'), new Date('2025-12-01T00:00:00.000Z'));

    // Assert: the mail keeps both batches whole; only a line's own cut drops it.
    const page = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    expect(amountsOf(page.messages)).toEqual(range(1, 20));

    // Act: a mail cut inside the batches drops the first.
    await store.pruneJournal(created.id, new Date('2026-01-08T00:00:00.000Z'), new Date('2026-01-05T00:00:00.000Z'));

    // Assert
    const kept = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    expect(amountsOf(kept.messages)).toEqual(range(11, 20));
  });

  it('counts the unread mail and reads one message at a time', async () => {
    // Arrange: five messages, all unread.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', town(1), new Date());
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, mailHours(1, 5), ACCOUNTS);
    }, created.id);
    const before = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    const target = before.messages[2];
    expect(target).toBeDefined();

    // Assert: the page reads in order, the badge counts the box, and a stored
    // message carries no town hour.
    expect(amountsOf(before.messages)).toEqual(range(1, 5));
    expect(before.messages.every((message) => message.event.at === 0)).toBe(true);
    expect(before.messages.every((message) => !message.read)).toBe(true);
    expect(before.unread).toBe(5);

    // Act: another dynasty names the id, then the owner opens it.
    const foreign = await store.markMessageRead(target?.id ?? 0, OTHER_PLAYER);
    const own = await store.markMessageRead(target?.id ?? 0, PLAYER);

    // Assert: the foreigner reads nothing; the owner's one line only.
    expect(foreign).toEqual({ read: false, unread: 0 });
    expect(own).toEqual({ read: true, unread: 4 });
    const after = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    expect(after.unread).toBe(4);
    expect(after.messages.filter((message) => message.read).map((message) => message.id)).toEqual([target?.id]);
  });

  it('caps the badge at the page it can open', async () => {
    // Arrange: five unread messages, read two at a time.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', town(1), new Date());
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, mailHours(1, 5), ACCOUNTS);
    }, created.id);

    // Act
    const page = await store.withWorld(async (session) => session.recentMessages(2, PLAYER), created.id);

    // Assert: messages 4 and 5, and the badge names what the page holds.
    expect(amountsOf(page.messages)).toEqual([4, 5]);
    expect(page.unread).toBe(2);
  });

  it('deletes one message of the account, and only its own', async () => {
    // Arrange: five messages for the weaver.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', town(1), new Date());
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, mailHours(1, 5), ACCOUNTS);
    }, created.id);
    const page = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    const target = page.messages[2];
    expect(target).toBeDefined();

    // Act: another dynasty names the id, then the owner does.
    const foreign = await store.deleteMessage(target?.id ?? 0, OTHER_PLAYER);
    const own = await store.deleteMessage(target?.id ?? 0, PLAYER);

    // Assert: the foreign delete is a no-op (and answers the foreigner's own
    // badge, which is empty); the owner's removes the line.
    expect(foreign).toEqual({ deleted: false, unread: 0 });
    expect(own).toEqual({ deleted: true, unread: 4 });
    const after = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);
    expect(amountsOf(after.messages)).toEqual([1, 2, 4, 5]);
  });

  it('writes a refusal with no reader nowhere', async () => {
    // Arrange: a poisoned action the tick refused has no dynasty to answer.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', town(1), new Date());
    const refused: Event = {
      type: 'action.refused',
      audience: 'court',
      at: 1,
      action: 'unknown',
      personId: 0,
      reason: 'unknown_action',
    };
    await store.withWorld(async (session) => {
      await session.write(session.snapshot.world, [refused]);
    }, created.id);

    // Act
    const chronicle = await store.withWorld(async (session) => session.recentChronicle(100), created.id);
    const mail = await store.withWorld(async (session) => session.recentMessages(100, PLAYER), created.id);

    // Assert: neither the town's page nor a mailbox carries it.
    expect(chronicle).toEqual([]);
    expect(mail.messages).toEqual([]);
  });

  it('writes no mail for an AI dynasty', async () => {
    // Arrange: one line for the human weaver, one for the AI caron.
    const store = new MemoryWorldStore();
    const created = await store.createTown('A', town(1), new Date());
    await store.withWorld(async (session) => {
      await session.write(
        session.snapshot.world,
        [repaidAt(1), { ...repaidAt(2), audience: { personId: CARON }, personId: CARON }],
        ACCOUNTS,
      );
    }, created.id);

    // Act
    const caron = await store.withWorld(async (session) => session.recentMessages(100, 900_003), created.id);

    // Assert
    expect(caron.messages).toEqual([]);
    expect(caron.unread).toBe(0);
  });
});
