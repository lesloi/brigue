import { humanPersonOf, type Event, type World } from '@brigue/core';

import type { PlayerStore } from '../identity/players.ts';
import type { Logger } from '../logger.ts';
import { applyPresence, type Presence } from './presence.ts';
import { accountsOf, playDue, type Due } from './scheduler.ts';
import { HOUR_MS, JOURNAL_PAGE, type MessageView, type TownInfo, type WorldStore, sessionWorld } from './worlds.ts';

export interface TownAccess {
  /** Accounts, for presence and deletion. */
  players: PlayerStore;
  worlds: WorldStore;
  logger: Logger;
  /** The world's random stream; the server passes `Math.random`, a test a seed. */
  random?: () => number;
}

export type TownOutcome =
  | {
      kind: 'caught';
      town: TownInfo;
      result: Due;
      /** The newest page of the account's mail, in the order it happened. */
      messages: MessageView[];
      /** The newest page of the town's public chronicle, in time order. */
      chronicle: Event[];
      /** What the badge counts: the unread messages of the box, at most a page. */
      unread: number;
    }
  | { kind: 'gone' };

/**
 * A read wakes the town when the scheduler has left it more than an hour
 * behind, and returns the newest page of its mail and of the town's chronicle.
 */
export function catchUpTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  return access.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);
    const { presence, accounts } = await synchronisePresence(access, townId, world, at);

    // The last human person went with the silence: the town goes too, and the
    // next join starts a new one. The accounts and the sealed seasons stay.
    if (humanPersonOf(presence.world) === undefined) {
      await session.clear();
      return { kind: 'gone' as const };
    }

    if (presence.deletedPersonIds.includes(personId)) {
      // Another human person is gone, but the town remains: the deletion is a
      // real change and must be kept even though nothing is caught up for
      // this reader.
      await session.save(presence.world, session.snapshot.hourStartedAt, [], accounts);
      return { kind: 'gone' as const };
    }

    // The reader is the backstop, not the clock: it only wakes a town the
    // scheduler has left more than an hour behind.
    const due = await playDue(
      session,
      { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
      at,
      2,
      presence.dormant,
      access.random ?? Math.random,
    );

    if (due.hours > 0) {
      await session.save(due.world, due.hourStartedAt, due.events, accounts);
    }

    const mail = await session.recentMessages(JOURNAL_PAGE, playerId);
    const chronicle = await session.recentChronicle(JOURNAL_PAGE);

    return {
      kind: 'caught' as const,
      town: session.snapshot.town,
      result: due,
      messages: mail.messages,
      chronicle,
      unread: mail.unread,
    };
  }, townId);
}

/**
 * Local development only: plays one hour now and re-anchors the next natural
 * hour on a fresh clock read, after the hour was played.
 */
export function advanceTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
  now: () => number,
): Promise<TownOutcome> {
  return access.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);
    const { presence, accounts } = await synchronisePresence(access, townId, world, at);

    if (humanPersonOf(presence.world) === undefined) {
      await session.clear();
      return { kind: 'gone' as const };
    }

    if (presence.deletedPersonIds.includes(personId)) {
      await session.save(presence.world, session.snapshot.hourStartedAt, [], accounts);
      return { kind: 'gone' as const };
    }

    // One hour further than the town's own clock, whatever the wall clock
    // says: the click is the hour.
    const forced = new Date(session.snapshot.hourStartedAt.getTime() + HOUR_MS);
    // The absence was simulated dormant; the visit itself wakes the reader for
    // the hour that follows, and for that hour only.
    const awake = new Set(presence.dormant);
    awake.delete(personId);
    const due = await playDue(
      session,
      { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
      forced,
      1,
      awake,
      access.random ?? Math.random,
    );
    // The hour was simulated, not lived. Put the next natural hour an hour
    // from the real now, instead of stacking a backlog.
    const savedAt = new Date(now());
    await session.save(due.world, savedAt, due.events, accounts);

    const mail = await session.recentMessages(JOURNAL_PAGE, playerId);
    const chronicle = await session.recentChronicle(JOURNAL_PAGE);

    return {
      kind: 'caught' as const,
      town: session.snapshot.town,
      result: { ...due, hourStartedAt: savedAt },
      messages: mail.messages,
      chronicle,
      unread: mail.unread,
    };
  }, townId);
}

async function synchronisePresence(
  access: TownAccess,
  townId: number,
  world: World,
  at: Date,
): Promise<{ presence: Presence; accounts: Map<number, number> }> {
  const players = await access.players.listByTown(townId);
  const presence = applyPresence(world, players, at.getTime());

  for (const personId of presence.deletedPersonIds) {
    await access.players.deletePerson(personId);
    access.logger.warn('world.person_deleted', { townId, personId });
  }

  return { presence, accounts: accountsOf(players) };
}
