import { advance, createWorld, withFounder } from '@brigue/core';
import type { Action, Event, FounderIdentity, Trade, World } from '@brigue/core';

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

/** The fixture identity the tests play; production draws its own. */
export const TEST_FOUNDER: FounderIdentity = {
  id: 'brigue',
  houseName: 'Brigue',
  personName: 'Colin Brigue',
};

/** The playable town: the AI houses plus the first player's house. */
export function town(seed: number, trade: Trade = 'weaver'): World {
  return withFounder(createWorld(seed), trade, TEST_FOUNDER);
}
