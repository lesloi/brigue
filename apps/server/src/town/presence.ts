import { PACING, type World } from '@brigue/core';

import type { Player } from '../identity/players.ts';

export interface Presence {
  world: World;
  /** Dynasties that crossed the deletion threshold; their tokens must be revoked. */
  deletedDynastyIds: string[];
  /** Whether the world changed even if no week elapsed, so the caller saves it. */
  changed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The server owns dormancy: it reads the last visit from the players table and
 * writes the dynasty state the core reads. A human dynasty with no live token, or
 * whose last visit is older than the dormancy threshold, runs nothing and votes
 * nowhere. Past the deletion threshold it is removed with its people, and its
 * seats become vacant.
 *
 * A dynasty with no player row at all is dormant but not deleted: there is no
 * visit to measure the silence from, and the join path puts the first dynasty back.
 */
export function applyPresence(world: World, players: readonly Player[], now: number): Presence {
  const latestSeen = new Map<string, number>();
  const live = new Set<string>();

  for (const player of players) {
    // An account between towns has no dynasty to wake or to measure.
    if (player.dynastyId === null) {
      continue;
    }

    const seen = player.lastSeenAt.getTime();
    latestSeen.set(player.dynastyId, Math.max(latestSeen.get(player.dynastyId) ?? Number.NEGATIVE_INFINITY, seen));
    if (player.revokedAt === null) {
      live.add(player.dynastyId);
    }
  }

  const next = structuredClone(world);
  const deletedDynastyIds: string[] = [];
  let changed = false;
  const dormancyMs = PACING.dormancyDays * DAY_MS;
  const deletionMs = PACING.deletionDays * DAY_MS;

  for (const dynasty of Object.values(next.dynasties)) {
    // An AI dynasty is always played; it has no token to go silent.
    if (dynasty.controller === 'ai') {
      if (dynasty.dormant) {
        dynasty.dormant = false;
        changed = true;
      }
      continue;
    }

    const seen = latestSeen.get(dynasty.id);
    if (seen !== undefined && now - seen > deletionMs) {
      deletedDynastyIds.push(dynasty.id);
      continue;
    }

    const dormant = seen === undefined || !live.has(dynasty.id) || now - seen >= dormancyMs;
    if (dynasty.dormant !== dormant) {
      dynasty.dormant = dormant;
      changed = true;
    }
  }

  for (const dynastyId of deletedDynastyIds) {
    removeDynasty(next, dynastyId);
    changed = true;
  }

  // A token can outlive its dynasty if a revocation failed after the world was
  // saved. Treat that row as a deletion to revoke, so it can never reach a
  // projection that no longer knows the dynasty.
  for (const dynastyId of latestSeen.keys()) {
    if (next.dynasties[dynastyId] === undefined && !deletedDynastyIds.includes(dynastyId)) {
      deletedDynastyIds.push(dynastyId);
    }
  }

  return { world: next, deletedDynastyIds, changed };
}

/** Removes a dynasty, its people and their seats, and its queued campaign votes. */
export function removeDynasty(world: World, dynastyId: string): void {
  const removedPeople = new Set<string>();

  for (const [personId, person] of Object.entries(world.people)) {
    if (person.dynastyId === dynastyId) {
      removedPeople.add(personId);
      delete world.people[personId];
    }
  }

  for (const seat of Object.values(world.seats)) {
    if (seat.personId !== null && removedPeople.has(seat.personId)) {
      seat.personId = null;
    }
  }

  for (const map of [world.campaigns, world.closedCampaigns]) {
    for (const byDynasty of Object.values(map)) {
      delete byDynasty?.[dynastyId];
    }
  }

  // A dynasty that is gone owes nothing: its queued engagements must not resolve
  // into an event naming a dynasty the town no longer holds.
  world.engagements = world.engagements.filter((engagement) => engagement.dynastyId !== dynastyId);

  delete world.dynasties[dynastyId];
}
