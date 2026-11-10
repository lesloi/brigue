import { PACING, type SeatId, type World } from '@brigue/core';

import type { Player } from '../identity/players.ts';

export interface Presence {
  world: World;
  /** People that run nothing and vote nowhere for this advance only. */
  dormant: ReadonlySet<number>;
  /** People that crossed the deletion threshold; their accounts must be erased. */
  deletedPersonIds: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The server owns dormancy: it reads the last visit from the players table and
 * hands the core the set of people that run nothing and vote nowhere for the
 * advance. A human person with no account, or whose last visit is older than
 * the dormancy threshold, is in that set. Past the deletion threshold it is
 * removed, and its seats become vacant.
 *
 * A human person with no player row cannot be written by the store — a person
 * is written with its account — so such a row is a crash's residue: it is left
 * alone here and no longer holds a place a join would take.
 */
export function applyPresence(world: World, players: readonly Player[], now: number): Presence {
  const latestSeen = new Map<number, number>();

  for (const player of players) {
    // An account between towns has no person to wake or to measure.
    if (player.personId === null) {
      continue;
    }

    const seen = player.lastSeenAt.getTime();
    latestSeen.set(player.personId, Math.max(latestSeen.get(player.personId) ?? Number.NEGATIVE_INFINITY, seen));
  }

  const next = structuredClone(world);
  const dormant = new Set<number>();
  const deletedPersonIds: number[] = [];
  const dormancyMs = PACING.dormancyDays * DAY_MS;
  const deletionMs = PACING.deletionDays * DAY_MS;

  for (const person of Object.values(next.people)) {
    // An AI person is always played; it has no token to go silent.
    if (person.ia) {
      continue;
    }

    const seen = latestSeen.get(person.id);
    if (seen !== undefined && now - seen > deletionMs) {
      deletedPersonIds.push(person.id);
      continue;
    }

    if (seen === undefined || now - seen >= dormancyMs) {
      dormant.add(person.id);
    }
  }

  for (const personId of deletedPersonIds) {
    removePerson(next, personId);
  }

  // A token can outlive its person if a revocation failed after the world was
  // saved. Treat that row as a deletion to erase, so it can never reach a
  // projection that no longer knows the person.
  for (const personId of latestSeen.keys()) {
    if (next.people[personId] === undefined && !deletedPersonIds.includes(personId)) {
      deletedPersonIds.push(personId);
    }
  }

  return { world: next, dormant, deletedPersonIds };
}

/** Removes a person, its seats and its queued campaign votes. */
export function removePerson(world: World, personId: number): void {
  delete world.people[personId];

  for (const seat of Object.values(world.seats)) {
    if (seat.personId === personId) {
      seat.personId = null;
    }
  }

  // A person that is gone stands for nothing: its candidacies go with it.
  for (const [seatId, personIds] of Object.entries(world.campaigns)) {
    world.campaigns[seatId as SeatId] = (personIds ?? []).filter((candidate) => candidate !== personId);
  }
}
