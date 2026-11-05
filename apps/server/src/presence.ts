import { PACING, type World } from '@brigue/core';

import type { Player } from './players.ts';

export interface Presence {
  world: World;
  /** Houses that crossed the deletion threshold; their tokens must be revoked. */
  deletedHouseIds: string[];
  /** Whether the world changed even if no week elapsed, so the caller saves it. */
  changed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The server owns dormancy: it reads the last visit from the players table and
 * writes the house state the core reads. A human house with no live token, or
 * whose last visit is older than the dormancy threshold, runs nothing and votes
 * nowhere. Past the deletion threshold it is removed with its people, and its
 * seats become vacant.
 *
 * A house with no player row at all is dormant but not deleted: there is no
 * visit to measure the silence from, and the join path puts the founder back.
 */
export function applyPresence(world: World, players: readonly Player[], now: number): Presence {
  const latestSeen = new Map<string, number>();
  const live = new Set<string>();

  for (const player of players) {
    const seen = player.lastSeenAt.getTime();
    latestSeen.set(player.houseId, Math.max(latestSeen.get(player.houseId) ?? Number.NEGATIVE_INFINITY, seen));
    if (player.revokedAt === null) {
      live.add(player.houseId);
    }
  }

  const next = structuredClone(world);
  const deletedHouseIds: string[] = [];
  let changed = false;
  const dormancyMs = PACING.dormancyDays * DAY_MS;
  const deletionMs = PACING.deletionDays * DAY_MS;

  for (const house of Object.values(next.houses)) {
    // An AI house is always played; it has no token to go silent.
    if (house.controller === 'ai') {
      if (house.dormant) {
        house.dormant = false;
        changed = true;
      }
      continue;
    }

    const seen = latestSeen.get(house.id);
    if (seen !== undefined && now - seen > deletionMs) {
      deletedHouseIds.push(house.id);
      continue;
    }

    const dormant = seen === undefined || !live.has(house.id) || now - seen >= dormancyMs;
    if (house.dormant !== dormant) {
      house.dormant = dormant;
      changed = true;
    }
  }

  for (const houseId of deletedHouseIds) {
    removeHouse(next, houseId);
    changed = true;
  }

  // A token can outlive its house if a revocation failed after the world was
  // saved. Treat that row as a deletion to revoke, so it can never reach a
  // projection that no longer knows the house.
  for (const houseId of latestSeen.keys()) {
    if (next.houses[houseId] === undefined && !deletedHouseIds.includes(houseId)) {
      deletedHouseIds.push(houseId);
    }
  }

  return { world: next, deletedHouseIds, changed };
}

/** Removes a house, its people and their seats, and its queued campaign votes. */
function removeHouse(world: World, houseId: string): void {
  const removedPeople = new Set<string>();

  for (const [personId, person] of Object.entries(world.people)) {
    if (person.houseId === houseId) {
      removedPeople.add(personId);
      delete world.people[personId];
    }
  }

  for (const seat of Object.values(world.seats)) {
    if (seat.personId !== null && removedPeople.has(seat.personId)) {
      seat.personId = null;
    }
  }

  for (const byHouse of Object.values(world.campaigns)) {
    delete byHouse?.[houseId];
  }

  // A house that is gone owes nothing: its queued engagements must not resolve
  // into an event naming a house the town no longer holds.
  world.engagements = world.engagements.filter((engagement) => engagement.houseId !== houseId);

  delete world.houses[houseId];
}
