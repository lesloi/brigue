import { humanPersonOf, type Event, type World } from '@brigue/core';

import type { PlayerStore } from '../identity/players.ts';
import type { Logger } from '../logger.ts';
import { applyPresence, type Presence } from './presence.ts';
import { accountsOf, playWorld } from './scheduler.ts';
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
      /** The town as it stands after the pass that preceded the read. */
      world: World;
      /** The instant the world was founded: the screen places its calendar from it. */
      worldStartedAt: Date;
      /** Whole hours the town lived in that pass. */
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
 * A visit reads the town, after bringing the whole world up to its hour: the
 * clock is the world's, so a reader cannot advance its own town alone. The pass
 * runs only when the world owes an hour — that is, when the scheduler missed
 * one — and returns the hours the towns lived.
 */
export function catchUpTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  return readTown(access, townId, personId, playerId, at, () => playWorldIfDue(access, at));
}

/**
 * Local development only: moves the world's clock one hour further than the
 * wall clock, then passes as a visit would. Every town gains that hour, because
 * there is one clock.
 */
export function advanceTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
): Promise<TownOutcome> {
  return readTown(access, townId, personId, playerId, at, async () => {
    await access.worlds.moveWorldClockBack(1);

    return playWorld(worldPass(access), at);
  });
}

/** The worlds a pass plays, once the clock says an hour is owed. */
function worldPass(access: TownAccess) {
  return { store: access.worlds, players: access.players, logger: access.logger, random: access.random };
}

async function playWorldIfDue(access: TownAccess, at: Date): Promise<number> {
  const clock = await access.worlds.readClock();

  if (clock === null) {
    return 0;
  }

  if (hourAt(clock.worldStartedAt, at) <= hourAt(clock.worldStartedAt, clock.lastRunAt)) {
    return 0;
  }

  // The guard above only keeps a visit from sweeping a world that owes nothing;
  // the pass itself says how many hours it played, whichever pass ran first.
  return playWorld(worldPass(access), at);
}

async function readTown(
  access: TownAccess,
  townId: number,
  personId: number,
  playerId: number,
  at: Date,
  play: () => Promise<number>,
): Promise<TownOutcome> {
  const hours = await play();

  try {
    return await access.worlds.withWorld(async (session) => {
      const world = sessionWorld(session);
      const { presence, accounts } = await synchronisePresence(access, townId, world, at);

      // The last human person went with the silence: the town goes too, and the
      // next join starts a new one. The accounts and the sealed seasons stay.
      if (humanPersonOf(presence.world) === undefined) {
        await session.clear();
        return { kind: 'gone' as const };
      }

      if (presence.world.people[personId] === undefined) {
        // The person is gone, but the town remains: keep the deletion and tell
        // the reader their session no longer exists.
        if (presence.deletedPersonIds.includes(personId)) {
          await session.save(presence.world, [], accounts);
        }

        return { kind: 'gone' as const };
      }

      const mail = await session.recentMessages(JOURNAL_PAGE, playerId);
      const chronicle = await session.recentChronicle(JOURNAL_PAGE);

      return {
        kind: 'caught' as const,
        town: session.snapshot.town,
        world: presence.world,
        worldStartedAt: session.snapshot.worldStartedAt,
        hours,
        messages: mail.messages,
        chronicle,
        unread: mail.unread,
      };
    }, townId);
  } catch (error) {
    // The pass deleted the town between the list and the read: it has no human
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
): Promise<{ presence: Presence; accounts: Map<number, number> }> {
  const players = await access.players.listByTown(townId);
  const presence = applyPresence(world, players, at.getTime());

  for (const personId of presence.deletedPersonIds) {
    await access.players.deletePerson(personId);
    access.logger.warn('world.person_deleted', { townId, personId });
  }

  return { presence, accounts: accountsOf(players) };
}
