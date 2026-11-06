import { advance, createWorld, withFounder } from '../src/index.ts';
import type { Action, Event, Trade, World } from '../src/index.ts';

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

/** Plays until the town reaches `hour`, one hour at a time. */
export function playUntil(world: World, hour: number): { world: World; events: Event[] } {
  return advance(world, hour);
}

/** The next bell: noon or midnight, whichever comes first. */
export function nextBell(hour: number): number {
  const noon = Math.ceil(hour / 12) * 12;

  return noon > hour ? noon : hour + 12;
}

/** Plays to the next bell, where the market is priced. */
export function playHalfDay(world: World, actions: readonly Action[] = []): { world: World; events: Event[] } {
  const first = tick(world, actions);

  return playUntil(first.world, nextBell(first.world.hour - 1));
}

/** The playable town: the AI houses plus the first player's house. */
export function town(seed: number, trade: Trade = 'weaver'): World {
  return withFounder(createWorld(seed), trade);
}
