import { advance, createWorld, withFirstPerson } from '../src/index.ts';
import type { Action, Event, PersonIdentity, Trade, World } from '../src/index.ts';

const MINSTD_MODULUS = 2147483647;

/**
 * A seeded stand-in for the random source the server passes to `advance`.
 * MINSTD, the generator the old world cursor used: 48271 × (2^31 - 1) stays
 * below 2^53, so the arithmetic is exact. Tests replay the same town when the
 * seed is the same.
 */
export function seeded(seed = 1): () => number {
  let state = ((seed % MINSTD_MODULUS) + MINSTD_MODULUS) % MINSTD_MODULUS || 1;

  return () => {
    state = (state * 48271) % MINSTD_MODULUS;

    return state / MINSTD_MODULUS;
  };
}

/**
 * One hour of the town, played the way the scheduler plays it: the actions are
 * placed on the hour being stepped. The stream is seeded from the world and the
 * hour, so a test replaying the same town draws the same values.
 */
export function tick(
  world: World,
  actions: readonly Action[] = [],
  dormant: ReadonlySet<number> = new Set(),
  random: () => number = seeded(world.hour),
): { world: World; events: Event[] } {
  return advance(
    world,
    world.hour,
    actions.map((action) => ({ at: world.hour, action })),
    dormant,
    random,
  );
}

/** Plays until the town reaches `hour`, one hour at a time. */
export function playUntil(
  world: World,
  hour: number,
  dormant: ReadonlySet<number> = new Set(),
  random: () => number = seeded(world.hour),
): { world: World; events: Event[] } {
  return advance(world, hour, [], dormant, random);
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
  dormant: ReadonlySet<number> = new Set(),
): { world: World; events: Event[] } {
  const first = tick(world, actions, dormant);

  return playUntil(first.world, nextBell(first.world.hour - 1), dormant);
}

/** The ids createWorld gives its three AI people, in creation order. */
export const CARON = 1;
export const FOURNIER = 2;
export const CHARPENTIER = 3;

/** The first person a player adds to the opening town. */
export const LECLERC = 4;

/** The fixture identity the tests play; production draws its own. */
export const TEST_FIRST_DYNASTY: PersonIdentity = {
  personName: 'Colin Leclerc',
};

/** The playable town: the AI people plus the first player's person. */
export function town(seed: number, trade: Trade = 'weaver'): World {
  return withFirstPerson(createWorld(), trade, TEST_FIRST_DYNASTY);
}
