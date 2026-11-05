import { createFounder, type World } from '@brigue/core';

import { FIRST_HOUSE_ID } from './worlds.ts';

/**
 * A freed place waits for a human: when the founder's house was deleted after
 * thirty days of silence, the next arrival starts the house again with a loom
 * and no seat. Without this, the join would bind a token to a house the world
 * no longer holds and every read would answer 500.
 */
export function withFounder(world: World): World {
  if (world.houses[FIRST_HOUSE_ID] !== undefined) {
    return world;
  }

  const next = structuredClone(world);
  const { house, person } = createFounder();
  next.houses[house.id] = house;
  next.people[person.id] = person;

  return next;
}
