import { advance } from '@brigue/core';
import type { Action, Event, World } from '@brigue/core';

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
