import { advance, createWorld, withFirstPerson } from '@brigue/core';
import type { Action, Event, PersonIdentity, Trade, World } from '@brigue/core';

import type { TownInfo } from '../src/town/worlds.ts';

/**
 * One hour of the town, played the way the scheduler plays it: the actions are
 * placed on the hour being stepped.
 */
export function tick(world: World, actions: readonly Action[] = []): { world: World; events: Event[] } {
  return advance(
    world,
    world.hour,
    actions.map((action) => ({ at: world.hour, action })),
  );
}

/** The fixture town the tests play; production draws and names its own. */
export const TEST_TOWN: TownInfo = { id: 1, name: 'Saint-Aubin' };

/** The fixture identity the tests play; production draws its own. */
export const TEST_FIRST_PERSON: PersonIdentity = {
  personName: 'Colin Leclerc',
};

/** The id `createWorld` leaves for the first player's person. */
export const LECLERC = 4;

/** The ids of the three AI people `createWorld` opens with. */
export const CARON = 1;
export const FOURNIER = 2;
export const CHARPENTIER = 3;

/** The playable town: the AI people plus the first player's person. */
export function town(seed: number, trade: Trade = 'weaver'): World {
  return withFirstPerson(createWorld(seed), trade, TEST_FIRST_PERSON);
}
