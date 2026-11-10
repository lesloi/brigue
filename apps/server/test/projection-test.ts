import { describe, expect, it } from 'vitest';

import {
  GOODS,
  HOURS_PER_YEAR,
  NAME_PRICE,
  RULES,
  stockCapacityUnits,
  stockUnits,
  yearOf,
  type World,
} from '@brigue/core';

import { projectWorld } from '../src/town/projection.ts';
import { LECLERC, TEST_TOWN, tick, town } from './helpers.ts';

const SEED = 20261105;
const START = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** The founding instant that puts the world's current hour where `START` was. */
function foundedAt(world: World): Date {
  return new Date(START.getTime() - (world.hour - 1) * HOUR);
}

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
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.hour).toBe(world.hour);
    expect(projection.hour).toBe(HOURS_PER_YEAR + 1);
    expect(projection.year).toBe(yearOf(world.hour));
    expect(projection.year).toBe(1402);
  });

  it('names the town it was read from', () => {
    // Act
    const projection = projectWorld(TEST_TOWN, town(SEED), LECLERC, START);

    // Assert: the screen shows the town's name, and the hash covers it.
    expect(projection.town.id).toBe(TEST_TOWN.id);
    expect(projection.town.name).toBe(TEST_TOWN.name);
  });

  it('tells the screen where the year stands without making it derive a date', () => {
    // Arrange: the first hour of the first year.
    const projection = projectWorld(TEST_TOWN, town(SEED), LECLERC, START);

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
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

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
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert: the scrutiny happens when this hour ends, like the next tick.
    expect(projection.calendar.hourOfYear).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR);
    expect(projection.calendar.nextScrutinyAt).toBe(projection.nextBellAt);
  });

  it('carries the family name when the account has one, and the display name too', () => {
    // Act
    const projection = projectWorld(TEST_TOWN, town(SEED), LECLERC, START, 'Leclerc');

    // Assert
    expect(projection.person.name).toBe('Leclerc');
    expect(projection.person.personName).toBe('Colin Leclerc');
  });

  it('falls back to the person name when the account has no family name', () => {
    // Act
    const projection = projectWorld(TEST_TOWN, town(SEED), LECLERC, START, null);

    // Assert
    expect(projection.person.name).toBe('Colin Leclerc');
    expect(projection.person.personName).toBe('Colin Leclerc');
  });

  it('carries the workshop chain and weekly figures so the client derives no rule', () => {
    // Arrange
    const world = town(SEED, 'baker');

    // Act
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.person.workshops).toEqual([
      {
        id: 4,
        trade: 'baker',
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

  it('scales the hourly figures with the level', () => {
    // Arrange
    const world = town(SEED);
    world.people[LECLERC].workshops = [{ id: 4, trade: 'weaver', level: 3 }];

    // Act
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.person.workshops[0]).toEqual({
      id: 4,
      trade: 'weaver',
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
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert: the client sums nothing and derives no capacity.
    expect(Object.keys(projection.town.market).sort()).toEqual([...GOODS].sort());
    expect(projection.person.stockUnits).toBe(stockUnits(world.people[LECLERC]));
    expect(projection.person.stockUnits).toBe(8);
    expect(projection.person.stockCapacityUnits).toBe(stockCapacityUnits(world.people[LECLERC]));
  });

  it('carries the ladder in its three shares, its names and the doors', () => {
    // Arrange: a fait, bourgeois, whose level 2 opens the residence 2.
    const world = town(SEED);
    world.people[LECLERC].title = 'bourgeois';
    world.people[LECLERC].prestige = 10_000;
    world.engagements = [{ id: 1, kind: 'site', personId: LECLERC, dueAt: world.hour + 6, work: 'title' }];

    // Act
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.person.title).toBe('bourgeois');
    expect(projection.person.residenceLevel).toBe(1);
    expect(projection.person.ladder).toEqual({
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
    expect(projection.person.prestige).toBe(80 + 0 + 200);
    expect(projection.person.build).toEqual({
      priceCents: RULES.buildCents,
      hours: RULES.siteHours,
      level: RULES.builtWorkshopLevel,
      room: 0,
      cap: 1,
    });
    expect(projection.person.sites).toEqual([
      { id: 1, dueAt: world.hour + 6, work: 'title', trade: null, workshopId: null },
    ]);
    expect(projection.person.rename).toEqual({ priceCents: NAME_PRICE.renameCents });
    expect(projection.town.people.find((person) => person.id === LECLERC)?.prestige).toBe(280);
  });

  it('carries the year of prices and their references', () => {
    // Arrange
    const world = town(SEED, 'baker');

    // Act
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

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
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.town.marketHistory).toEqual({});
    expect(Object.keys(projection.town.marketReferences).sort()).toEqual([...GOODS].sort());
  });

  it('points at the next year once a scrutiny has closed the last one', () => {
    // Arrange: the first hour of the second year.
    const world = play(town(SEED), HOURS_PER_YEAR);

    // Act
    const projection = projectWorld(TEST_TOWN, world, LECLERC, foundedAt(world));

    // Assert
    expect(projection.calendar.hourOfYear).toBe(1);
    expect(projection.calendar.nextScrutinyHour).toBe(HOURS_PER_YEAR * 2);
    expect(projection.calendar.nextScrutinyAt).toBe(
      new Date(START.getTime() + (HOURS_PER_YEAR * 2 - world.hour + 1) * HOUR).toISOString(),
    );
  });
});
