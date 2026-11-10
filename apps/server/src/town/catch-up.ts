import { humanPersonOf, type Event, type World } from '@brigue/core';

import type { PlayerStore } from '../identity/players.ts';
import type { Logger } from '../logger.ts';
import { applyPresence, type Presence } from './presence.ts';
import { accountsOf, playDue } from './scheduler.ts';
import {
  JOURNAL_PAGE,
  UnknownWorldError,
  hourAt,
  sessionWorld,
  type MessageView,
  type TownInfo,
  type WorldStore,
} from './worlds.ts';

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
      /** The town as it stands after the read played what it owed. */
      world: World;
      /** The instant the world was founded: the screen places its calendar from it. */
      worldStartedAt: Date;
      /** Whole hours this town lived during the read. */
      hours: number;
      /** The newest page of the account's mail, in the order it happened. */
      messages: MessageView[];
      /** The newest page of the town's public chronicle, in time order. */
      chronicle: Event[];
      /** What the badge counts: the unread messages of the box, at most a page. */
      unread: number;
    }
  | { kind: 'gone' };

/**
 * A visit plays the town it visits, and only that one: the clock belongs to the
 * world, the watermark to the town, so a reader cannot make its neighbours owe
 * an hour less than they do.
 */
export function catchUpTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  return readTown(access, townId, personId, playerId, at);
}

/**
 * Local development only: moves the world's clock one hour further than the
 * wall clock, then reads the town as a visit would. The origin moves and every
 * town's watermark with it, so every town owes one more hour and this read pays
 * this town's.
 */
export function advanceTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  return access.worlds.moveWorldClockBack(1).then(() => readTown(access, townId, personId, playerId, at));
}

async function readTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  let erasable: number[];

  try {
    const outcome = await access.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);
      const presence = await synchronisePresence(access, townId, world, at);
      erasable = presence.erasable;

      // The last human person went with the silence: the town goes too, and the
      // next join starts a new one. The accounts and the sealed seasons stay.
      if (humanPersonOf(presence.presence.world) === undefined) {
        await session.clear();
        return { kind: 'gone' as const };
      }

      if (presence.presence.world.people[personId] === undefined) {
        // The person is gone, but the town remains: keep the deletion and tell
        // the reader their session no longer exists.
        if (presence.presence.deletedPersonIds.includes(personId)) {
          await session.write(presence.presence.world, [], presence.accounts);
        }

        return { kind: 'gone' as const };
      }

      // The town is played inside the same lock as the read: two writers of one
      // town never play the same hour twice.
      const target = hourAt(session.snapshot.worldStartedAt, at);
      const due = await playDue(
        session,
        presence.presence.world,
        target,
        presence.presence.dormant,
        access.random ?? Math.random,
      );

      if (due.hours > 0 || presence.presence.deletedPersonIds.length > 0) {
        await session.write(due.world, due.events, presence.accounts);
      }

      const mail = await session.recentMessages(JOURNAL_PAGE, playerId);
      const chronicle = await session.recentChronicle(JOURNAL_PAGE);

      return {
        kind: 'caught' as const,
        town: session.snapshot.town,
        world: due.world,
        worldStartedAt: session.snapshot.worldStartedAt,
        hours: due.hours,
        messages: mail.messages,
        chronicle,
        unread: mail.unread,
      };
    }, townId);

    // Outside the town's lock: the account takes its person with it.
    for (const account of erasable!) {
      await access.players.deleteAccount(account);
    }

    return outcome;
  } catch (error) {
    // The town was deleted between the token and the lock: it has no human
    // left, and the next join starts a new one.
    if (error instanceof UnknownWorldError) {
      return { kind: 'gone' };
    }

    throw error;
  }
}

async function synchronisePresence(
  access: TownAccess,
  townId: number,
  world: World,
  at: Date,
): Promise<{ presence: Presence; accounts: Map<number, number>; erasable: number[] }> {
  const players = await access.players.listByTown(townId);
  const presence = applyPresence(world, players, at.getTime());
  const erasable: number[] = [];

  for (const personId of presence.deletedPersonIds) {
    const player = players.find((candidate) => candidate.personId === personId);
    if (player !== undefined) {
      erasable.push(player.playerId);
    }
    access.logger.warn('world.person_deleted', { townId, personId });
  }

  return { presence, accounts: accountsOf(players), erasable };
}
