import { describe, expect, it } from 'vitest';

import { createWorld, GOODS, RULES, START_YEAR, stockUnits, tick, WEEKS_PER_YEAR, type World } from '@brigue/core';

import { projectWorld } from '../src/projection.ts';

const SEED = 20261105;
const START = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function play(world: World, weeks: number): World {
  let current = world;

  for (let week = 0; week < weeks; week += 1) {
    current = tick(current).world;
  }

  return current;
}

describe('the projection calendar', () => {
  it('agrees with the world on the week and the year it derives', () => {
    // Arrange: twenty-four ticks make a year.
    const world = play(createWorld(SEED), WEEKS_PER_YEAR);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.week).toBe(world.week);
    expect(projection.week).toBe(WEEKS_PER_YEAR + 1);
    expect(projection.year).toBe(world.year);
    expect(projection.year).toBe(START_YEAR + 1);
  });

  it('tells the screen where the year stands without making it derive a date', () => {
    // Arrange: the first week of the first year.
    const projection = projectWorld(createWorld(SEED), 'brigue', START);

    // Act and assert
    expect(projection.calendar).toEqual({
      weeksPerYear: WEEKS_PER_YEAR,
      weekOfYear: 1,
      nextScrutinyWeek: WEEKS_PER_YEAR,
      nextScrutinyAt: new Date(START.getTime() + WEEKS_PER_YEAR * HOUR).toISOString(),
    });
  });

  it('counts the partial year down to the end of the scrutiny week', () => {
    // Arrange: the fifth week of the first year.
    const world = play(createWorld(SEED), 4);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert: twenty weeks in progress plus the scrutiny week itself.
    expect(projection.calendar.weekOfYear).toBe(5);
    expect(projection.calendar.nextScrutinyWeek).toBe(WEEKS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (WEEKS_PER_YEAR - 5 + 1) * HOUR).toISOString(),
    );
  });

  it('ends the scrutiny week with the week it closes', () => {
    // Arrange: the town is playing the last week of its first year.
    const world = play(createWorld(SEED), WEEKS_PER_YEAR - 1);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert: the scrutiny happens when this week ends, like the next tick.
    expect(projection.calendar.weekOfYear).toBe(WEEKS_PER_YEAR);
    expect(projection.calendar.nextScrutinyWeek).toBe(WEEKS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(projection.nextTickAt);
  });

  it('carries the workshop chain and weekly figures so the client derives no rule', () => {
    // Arrange
    const world = createWorld(SEED, 'baker');

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.house.workshops).toEqual([
      {
        good: 'bread',
        level: 2,
        workers: 2,
        input: 'grain',
        outputUnitsPerWeek: 4,
        inputUnitsPerWeek: 4,
        wagesCentsPerWeek: 240,
      },
    ]);
  });

  it('carries zero input for a raw workshop', () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [{ good: 'wool', level: 2, workers: 1 }];

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.house.workshops[0]).toEqual({
      good: 'wool',
      level: 2,
      workers: 1,
      input: null,
      outputUnitsPerWeek: 4,
      inputUnitsPerWeek: 0,
      wagesCentsPerWeek: 120,
    });
  });

  it('scales the weekly figures with the level and the workers', () => {
    // Arrange
    const world = createWorld(SEED);
    world.houses.brigue.workshops = [{ good: 'cloth', level: 3, workers: 1 }];

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.house.workshops[0]).toEqual({
      good: 'cloth',
      level: 3,
      workers: 1,
      input: 'wool',
      outputUnitsPerWeek: 6,
      inputUnitsPerWeek: 6,
      wagesCentsPerWeek: 120,
    });
  });

  it('carries six prices, the stock and the warehouse capacity', () => {
    // Arrange
    const world = createWorld(SEED);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert: the client sums nothing and derives no capacity.
    expect(Object.keys(projection.town.market).sort()).toEqual([...GOODS].sort());
    expect(projection.house.stockUnits).toBe(stockUnits(world.houses.brigue));
    expect(projection.house.stockUnits).toBe(8);
    expect(projection.house.stockCapacityUnits).toBe(RULES.stockCapacityUnits);
  });

  it('points at the next year once a scrutiny has closed the last one', () => {
    // Arrange: the first week of the second year.
    const world = play(createWorld(SEED), WEEKS_PER_YEAR);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.calendar.weekOfYear).toBe(1);
    expect(projection.calendar.nextScrutinyWeek).toBe(WEEKS_PER_YEAR * 2);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (WEEKS_PER_YEAR * 2 - world.week + 1) * HOUR).toISOString(),
    );
  });
});
