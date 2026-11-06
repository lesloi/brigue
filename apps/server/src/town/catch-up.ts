import { humanHouseOf, type World } from '@brigue/core';

import type { PlayerStore } from '../identity/players.ts';
import type { Logger } from '../logger.ts';
import { applyPresence, type Presence } from './presence.ts';
import { playDue, type Due } from './scheduler.ts';
import { HOUR_MS, JOURNAL_PAGE, type JournalPage, type TownInfo, type WorldStore, sessionWorld } from './worlds.ts';

export interface TownAccess {
  /** Accounts, for presence and deletion. */
  players: PlayerStore;
  worlds: WorldStore;
  logger: Logger;
}

export type TownOutcome = { kind: 'caught'; town: TownInfo; result: Due; journal: JournalPage } | { kind: 'gone' };

/**
 * A read wakes the town when the scheduler has left it more than an hour
 * behind, and returns what this reader has not seen yet.
 */
export function catchUpTown(
  access: TownAccess,
  townId: number,
  houseId: string,
  cursor: number,
  at: Date,
): Promise<TownOutcome> {
  return access.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);
    const presence = await synchronisePresence(access, townId, world, at);

    // The last human house went with the silence: the town goes too, and the
    // next join starts a new one. The players and the sealed seasons stay.
    if (humanHouseOf(presence.world) === undefined) {
      await session.clear();
      return { kind: 'gone' as const };
    }

    if (presence.deletedHouseIds.includes(houseId)) {
      // Another human house is gone, but the town remains: the deletion is a
      // real change and must be kept even though nothing is caught up for
      // this reader.
      await session.save(presence.world, session.snapshot.hourStartedAt, []);
      return { kind: 'gone' as const };
    }

    // The reader is the backstop, not the clock: it only wakes a town the
    // scheduler has left more than an hour behind.
    const due = await playDue(session, { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt }, at, 2);
    // The absence was simulated dormant; the visit itself wakes the house for
    // the hour that follows.
    const woke = wake(due.world, houseId);

    if (due.hours > 0 || presence.changed || woke) {
      await session.save(due.world, due.hourStartedAt, due.events);
    }

    const journal = await session.eventsSince(cursor, JOURNAL_PAGE, houseId);

    return { kind: 'caught' as const, town: session.snapshot.town, result: due, journal };
  }, townId);
}

/**
 * Local development only: plays one hour now and re-anchors the next natural
 * hour on a fresh clock read, after the hour was played.
 */
export function advanceTown(
  access: TownAccess,
  townId: number,
  houseId: string,
  cursor: number,
  at: Date,
  now: () => number,
): Promise<TownOutcome> {
  return access.worlds.withWorld(async (session) => {
    const world = sessionWorld(session);
    const presence = await synchronisePresence(access, townId, world, at);

    if (humanHouseOf(presence.world) === undefined) {
      await session.clear();
      return { kind: 'gone' as const };
    }

    if (presence.deletedHouseIds.includes(houseId)) {
      await session.save(presence.world, session.snapshot.hourStartedAt, []);
      return { kind: 'gone' as const };
    }

    // One hour further than the town's own clock, whatever the wall clock
    // says: the click is the hour.
    const forced = new Date(session.snapshot.hourStartedAt.getTime() + HOUR_MS);
    const due = await playDue(
      session,
      { world: presence.world, hourStartedAt: session.snapshot.hourStartedAt },
      forced,
      1,
    );
    wake(due.world, houseId);
    // The hour was simulated, not lived. Put the next natural hour an hour
    // from the real now, instead of stacking a backlog.
    const savedAt = new Date(now());
    await session.save(due.world, savedAt, due.events);

    const journal = await session.eventsSince(cursor, JOURNAL_PAGE, houseId);

    return {
      kind: 'caught' as const,
      town: session.snapshot.town,
      result: { ...due, hourStartedAt: savedAt },
      journal,
    };
  }, townId);
}

async function synchronisePresence(access: TownAccess, townId: number, world: World, at: Date): Promise<Presence> {
  const players = await access.players.listByTown(townId);
  const presence = applyPresence(world, players, at.getTime());

  for (const houseId of presence.deletedHouseIds) {
    await access.players.revokeHouse(townId, houseId, at);
    access.logger.warn('world.house_deleted', { townId, houseId });
  }

  return presence;
}

/** The visit wakes a house the absence had made dormant, for the hour to come. */
function wake(world: World, houseId: string): boolean {
  const house = world.houses[houseId];

  if (house === undefined || !house.dormant) {
    return false;
  }

  house.dormant = false;

  return true;
}
