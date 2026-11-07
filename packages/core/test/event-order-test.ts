import { describe, expect, it } from 'vitest';

import { advance, type Action, type World } from '@brigue/core';

import { town } from '../../../packages/core/test/helpers.ts';

const SEED = 20261109;

/**
 * A journal reads like a ledger: what the player asked and what became of it
 * comes first, in the order they asked; the town's own steps follow. The hour
 * is written whole, so the reader's lines must not fall between two purchases
 * of another house.
 */
describe('the order of an hour', () => {
  const play = (world: World, actions: Action[] = []) =>
    advance(
      world,
      world.hour,
      actions.map((action) => ({ at: world.hour, action })),
    ).events;

  it('opens the site of a title before saying the title was bought', () => {
    // Arrange: a purse that pays for the degree.
    const world = town(SEED);
    world.houses.leclerc.treasuryCents = 1_000_000;

    // Act
    const events = play(world, [{ type: 'house.buy_title', houseId: 'leclerc' }]);

    // Assert
    const opened = events.findIndex((event) => event.type === 'engagement.opened' && event.houseId === 'leclerc');
    const bought = events.findIndex((event) => event.type === 'house.title_bought');
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(bought).toBeGreaterThan(opened);
  });

  it('never lets the house’s lines fall between two steps of the town', () => {
    // Arrange: the player buys on the market while the AI houses trade too.
    const world = town(SEED);
    world.houses.leclerc.treasuryCents = 1_000_000;

    // Act
    const events = play(world, [{ type: 'market.buy', houseId: 'leclerc', good: 'wool', units: 4 }]);

    // Assert: the house's own action opens the hour, and every line after it
    // belongs to the town's steps, whichever house it names.
    expect(events[0]).toMatchObject({ type: 'market.bought', houseId: 'leclerc' });
  });

  it('keeps a refusal before the sale it prevented', () => {
    // Arrange: a house that cannot afford its degree.
    const world = town(SEED);
    world.houses.leclerc.treasuryCents = 0;

    // Act
    const events = play(world, [{ type: 'house.buy_title', houseId: 'leclerc' }]);

    // Assert
    expect(events[0]?.type).toBe('action.refused');
    expect(events.some((event) => event.type === 'house.title_bought')).toBe(false);
  });

  it('keeps the order of two actions of one hour', () => {
    // Arrange: a sale then a purchase, as the player queued them.
    const world = town(SEED);
    world.houses.leclerc.stock = { cloth: 4 };

    // Act
    const events = play(world, [
      { type: 'market.sell', houseId: 'leclerc', good: 'cloth', units: 2 },
      { type: 'market.buy', houseId: 'leclerc', good: 'wool', units: 1 },
    ]);

    // Assert
    const sold = events.findIndex((event) => event.type === 'market.sold' && event.houseId === 'leclerc');
    const bought = events.findIndex((event) => event.type === 'market.bought' && event.houseId === 'leclerc');
    expect(sold).toBeGreaterThanOrEqual(0);
    expect(bought).toBeGreaterThan(sold);
  });
});
