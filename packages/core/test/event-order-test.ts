import { describe, expect, it } from 'vitest';

import { advance, type Action, type World } from '../src/index.ts';
import { LECLERC, seeded, town } from './helpers.ts';

const SEED = 20261109;

/**
 * The messages of an hour read in the order the hour lived: what the player
 * asked and got comes first, in the order they asked; the town's own steps
 * follow. The hour is written whole, so a reader's line must not fall between
 * two of another dynasty's.
 */
describe('the order of an hour', () => {
  const play = (world: World, actions: Action[] = []) =>
    advance(
      world,
      world.hour,
      actions.map((action) => ({ at: world.hour, action })),
      new Set(),
      seeded(world.hour),
    ).events;

  it('keeps a refusal before the message the town writes afterwards', () => {
    // Arrange: a sale the dynasty cannot make, and an empty purse with a
    // workshop to run, so the town's own upkeep line falls due in the same hour.
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 0;

    // Act
    const events = play(world, [{ type: 'market.sell', personId: LECLERC, good: 'grain', units: 1 }]);

    // Assert: the refusal opens the hour, and the upkeep the town pays after the
    // actions comes after it.
    const refused = events.findIndex((event) => event.type === 'action.refused');
    const penniless = events.findIndex((event) => event.type === 'person.penniless');
    expect(refused).toBe(0);
    expect(penniless).toBeGreaterThan(refused);
  });

  it('keeps the order of two actions of one hour', () => {
    // Arrange: a sale the dynasty cannot make, then a good the town does not
    // trade.
    const world = town(SEED);
    const unknown = { type: 'market.buy', personId: LECLERC, good: 'silk', units: 1 } as unknown as Action;

    // Act
    const events = play(world, [{ type: 'market.sell', personId: LECLERC, good: 'grain', units: 1 }, unknown]);

    // Assert
    expect(events[0]).toMatchObject({ type: 'action.refused', reason: 'insufficient_stock' });
    expect(events[1]).toMatchObject({ type: 'action.refused', reason: 'unknown_good' });
  });

  it('writes the hour of every message it returns', () => {
    // Arrange
    const world = town(SEED);

    // Act
    const events = play(world, [{ type: 'market.sell', personId: LECLERC, good: 'grain', units: 1 }]);

    // Assert
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.at).toBe(world.hour);
    }
  });
});
