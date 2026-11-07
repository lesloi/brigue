import { advance, createWorld, withFirstDynasty } from '@brigue/core';
import type { Action, Event, DynastyIdentity, Trade, World } from '@brigue/core';

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
export const TEST_FIRST_DYNASTY: DynastyIdentity = {
  id: 'leclerc',
  dynastyName: 'Leclerc',
  personName: 'Colin Leclerc',
};

/** The playable town: the AI dynasties plus the first player's dynasty. */
export function town(seed: number, trade: Trade = 'weaver'): World {
  return withFirstDynasty(createWorld(seed), trade, TEST_FIRST_DYNASTY);
}
