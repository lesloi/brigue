import { describe, expect, it } from 'vitest';

import { createWorld, GOODS, HOURS_PER_YEAR, RULES, START_YEAR, stockUnits, type World } from '@brigue/core';
import { tick } from './helpers.ts';

import { projectWorld } from '../src/projection.ts';

const SEED = 20261105;
const START = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function play(world: World, hours: number): World {
  let current = world;

  for (let hour = 0; hour < hours; hour += 1) {
    current = tick(current).world;
  }

  return current;
}

describe('the projection calendar', () => {
  it('agrees with the world on the hour and the year it derives', () => {
    // Arrange: twenty-four ticks make a year.
    const world = play(createWorld(SEED), HOURS_PER_YEAR);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.hour).toBe(world.hour);
    expect(projection.hour).toBe(HOURS_PER_YEAR + 1);
    expect(projection.year).toBe(world.year);
    expect(projection.year).toBe(START_YEAR + 1);
  });

  it('tells the screen where the year stands without making it derive a date', () => {
    // Arrange: the first hour of the first year.
    const projection = projectWorld(createWorld(SEED), 'brigue', START);

    // Act and assert
    expect(projection.calendar).toEqual({
      hoursPerYear: HOURS_PER_YEAR,
      hourOfYear: 1,
      nextScrutinyHour: HOURS_PER_YEAR,
      nextScrutinyAt: new Date(START.getTime() + HOURS_PER_YEAR * HOUR).toISOString(),
    });
  });

  it('counts the partial year down to the end of the scrutiny hour', () => {
    // Arrange: the fifth hour of the first year.
    const world = play(createWorld(SEED), 4);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert: twenty hours in progress plus the scrutiny hour itself.
    expect(projection.calendar.hourOfYear).toBe(5);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (HOURS_PER_YEAR - 5 + 1) * HOUR).toISOString(),
    );
  });

  it('ends the scrutiny hour with the hour it closes', () => {
    // Arrange: the town is playing the last hour of its first year.
    const world = play(createWorld(SEED), HOURS_PER_YEAR - 1);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert: the scrutiny happens when this hour ends, like the next tick.
    expect(projection.calendar.hourOfYear).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(projection.nextBellAt);
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
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        wagesCentsPerHour: 240,
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
      outputUnitsPerHour: 4,
      inputUnitsPerHour: 0,
      wagesCentsPerHour: 120,
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
      outputUnitsPerHour: 6,
      inputUnitsPerHour: 6,
      wagesCentsPerHour: 120,
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

  it('carries the year of prices and their references', () => {
    // Arrange
    const world = createWorld(SEED, 'baker');

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    for (const good of GOODS) {
      expect(projection.town.marketHistory[good]).toEqual([RULES.market[good].referenceCents]);
      expect(projection.town.marketReferences[good]).toBe(RULES.market[good].referenceCents);
    }
  });

  it('projects a field-less world with an empty history', () => {
    // Arrange: a world stored before the history field existed.
    const world = createWorld(SEED);
    delete world.marketHistory;

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.town.marketHistory).toEqual({});
    expect(Object.keys(projection.town.marketReferences).sort()).toEqual([...GOODS].sort());
  });

  it('points at the next year once a scrutiny has closed the last one', () => {
    // Arrange: the first hour of the second year.
    const world = play(createWorld(SEED), HOURS_PER_YEAR);

    // Act
    const projection = projectWorld(world, 'brigue', START);

    // Assert
    expect(projection.calendar.hourOfYear).toBe(1);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR * 2);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (HOURS_PER_YEAR * 2 - world.hour + 1) * HOUR).toISOString(),
    );
  });
});
