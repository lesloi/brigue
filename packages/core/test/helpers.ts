import { advance, createWorld, withFirstDynasty } from '../src/index.ts';
import type { Action, Event, DynastyIdentity, Trade, World } from '../src/index.ts';

/**
 * One hour of the town, played the way the scheduler plays it: the actions are
 * placed on the hour being stepped.
 */
export function tick(
  world: World,
  actions: readonly Action[] = [],
  dormant: ReadonlySet<string> = new Set(),
): { world: World; events: Event[] } {
  return advance(
    world,
    world.hour,
    actions.map((action) => ({ at: world.hour, action })),
    dormant,
  );
}

/** Plays until the town reaches `hour`, one hour at a time. */
export function playUntil(
  world: World,
  hour: number,
  dormant: ReadonlySet<string> = new Set(),
): { world: World; events: Event[] } {
  return advance(world, hour, [], dormant);
}

/** The next bell: noon or midnight, whichever comes first. */
export function nextBell(hour: number): number {
  const noon = Math.ceil(hour / 12) * 12;

  return noon > hour ? noon : hour + 12;
}

/** Plays to the next bell, where the market is priced. */
export function playHalfDay(
  world: World,
  actions: readonly Action[] = [],
  dormant: ReadonlySet<string> = new Set(),
): { world: World; events: Event[] } {
  const first = tick(world, actions, dormant);

  return playUntil(first.world, nextBell(first.world.hour - 1), dormant);
}

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
