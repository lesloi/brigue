import { describe, expect, it } from 'vitest';

import {
  GOODS,
  HOURS_PER_YEAR,
  NAME_PRICE,
  RULES,
  START_YEAR,
  stockCapacityUnits,
  stockUnits,
  type World,
} from '@brigue/core';

import { projectWorld } from '../src/town/projection.ts';
import { TEST_TOWN, tick, town } from './helpers.ts';

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
    const world = play(town(SEED), HOURS_PER_YEAR);

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.hour).toBe(world.hour);
    expect(projection.hour).toBe(HOURS_PER_YEAR + 1);
    expect(projection.year).toBe(world.year);
    expect(projection.year).toBe(START_YEAR + 1);
  });

  it('names the town it was read from', () => {
    // Act
    const projection = projectWorld(TEST_TOWN, town(SEED), 'leclerc', START);

    // Assert: the screen shows the town's name, and the hash covers it.
    expect(projection.town.id).toBe(TEST_TOWN.id);
    expect(projection.town.name).toBe(TEST_TOWN.name);
  });

  it('tells the screen where the year stands without making it derive a date', () => {
    // Arrange: the first hour of the first year.
    const projection = projectWorld(TEST_TOWN, town(SEED), 'leclerc', START);

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
    const world = play(town(SEED), 4);

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert: twenty hours in progress plus the scrutiny hour itself.
    expect(projection.calendar.hourOfYear).toBe(5);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (HOURS_PER_YEAR - 5 + 1) * HOUR).toISOString(),
    );
  });

  it('ends the scrutiny hour with the hour it closes', () => {
    // Arrange: the town is playing the last hour of its first year.
    const world = play(town(SEED), HOURS_PER_YEAR - 1);

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert: the scrutiny happens when this hour ends, like the next tick.
    expect(projection.calendar.hourOfYear).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(projection.nextBellAt);
  });

  it('carries the workshop chain and weekly figures so the client derives no rule', () => {
    // Arrange
    const world = town(SEED, 'baker');

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.dynasty.workshops).toEqual([
      {
        id: 'workshop-1',
        good: 'bread',
        level: 2,
        input: 'grain',
        outputUnitsPerHour: 4,
        inputUnitsPerHour: 4,
        upkeepCentsPerHour: 240,
        capacityUnits: 200,
        canUpgrade: false,
        upgradeHours: 3,
      },
    ]);
  });

  it('carries zero input for a raw workshop', () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'wool', level: 2 }];

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.dynasty.workshops[0]).toEqual({
      id: 'workshop-1',
      good: 'wool',
      level: 2,
      input: null,
      outputUnitsPerHour: 4,
      inputUnitsPerHour: 0,
      upkeepCentsPerHour: 240,
      capacityUnits: 200,
      canUpgrade: false,
      upgradeHours: 3,
    });
  });

  it('scales the hourly figures with the level', () => {
    // Arrange
    const world = town(SEED);
    world.dynasties.leclerc.workshops = [{ id: 'workshop-1', good: 'cloth', level: 3 }];

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.dynasty.workshops[0]).toEqual({
      id: 'workshop-1',
      good: 'cloth',
      level: 3,
      input: 'wool',
      outputUnitsPerHour: 6,
      inputUnitsPerHour: 6,
      upkeepCentsPerHour: 360,
      capacityUnits: 350,
      canUpgrade: false,
      upgradeHours: 6,
    });
  });

  it('carries six prices, the stock and the warehouse capacity', () => {
    // Arrange
    const world = town(SEED);

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert: the client sums nothing and derives no capacity.
    expect(Object.keys(projection.town.market).sort()).toEqual([...GOODS].sort());
    expect(projection.dynasty.stockUnits).toBe(stockUnits(world.dynasties.leclerc));
    expect(projection.dynasty.stockUnits).toBe(8);
    expect(projection.dynasty.stockCapacityUnits).toBe(stockCapacityUnits(world.dynasties.leclerc));
  });

  it('carries the ladder in its three shares, its names and the doors', () => {
    // Arrange: a fait, bourgeois, whose level 2 opens the residence 2.
    const world = town(SEED);
    world.people['person-leclerc'].title = 'bourgeois';
    world.dynasties.leclerc.prestige = 10_000;
    world.engagements = [
      { id: 'engagement-1', kind: 'site', dynastyId: 'leclerc', dueAt: world.hour + 6, work: 'title' },
    ];

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.dynasty.title).toBe('bourgeois');
    expect(projection.dynasty.residenceLevel).toBe(1);
    expect(projection.dynasty.ladder).toEqual({
      title: 'bourgeois',
      residence: 'Masure',
      titlePrestige: 80,
      residencePrestige: 0,
      servicePrestige: 200,
      prestigeCap: 200,
      workshops: 1,
      stockDefence: 10,
      workshopLevelCap: 3,
      nextTitle: { title: 'notable', priceCents: 120_000 },
      nextResidence: { level: 2, name: 'Masure', priceCents: 80_000, opened: true, hours: 1 },
    });
    expect(projection.dynasty.prestige).toBe(80 + 0 + 200);
    expect(projection.dynasty.build).toEqual({
      priceCents: RULES.buildCents,
      hours: RULES.siteHours,
      level: RULES.builtWorkshopLevel,
      room: 0,
      cap: 1,
    });
    expect(projection.dynasty.sites).toEqual([
      { id: 'engagement-1', dueAt: world.hour + 6, work: 'title', trade: null, workshopId: null },
    ]);
    expect(projection.dynasty.rename).toEqual({ priceCents: NAME_PRICE.renameCents });
    expect(projection.town.dynasties.find((dynasty) => dynasty.id === 'leclerc')?.prestige).toBe(280);
  });

  it('carries the year of prices and their references', () => {
    // Arrange
    const world = town(SEED, 'baker');

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    for (const good of GOODS) {
      expect(projection.town.marketHistory[good]).toEqual([RULES.market[good].referenceCents]);
      expect(projection.town.marketReferences[good]).toBe(RULES.market[good].referenceCents);
    }
  });

  it('projects a field-less world with an empty history', () => {
    // Arrange: a world stored before the history field existed.
    const world = town(SEED);
    delete world.marketHistory;

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.town.marketHistory).toEqual({});
    expect(Object.keys(projection.town.marketReferences).sort()).toEqual([...GOODS].sort());
  });

  it('points at the next year once a scrutiny has closed the last one', () => {
    // Arrange: the first hour of the second year.
    const world = play(town(SEED), HOURS_PER_YEAR);

    // Act
    const projection = projectWorld(TEST_TOWN, world, 'leclerc', START);

    // Assert
    expect(projection.calendar.hourOfYear).toBe(1);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR * 2);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (HOURS_PER_YEAR * 2 - world.hour + 1) * HOUR).toISOString(),
    );
  });
});
