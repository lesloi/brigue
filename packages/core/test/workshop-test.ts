import { describe, expect, it } from 'vitest';

import {
  createWorld,
  leadHoursOf,
  displayedPrestige,
  nextTitle,
  RULES,
  stockCapacityUnits,
  stockUnits,
  TITLES,
  titleOf,
  workshopCap,
  workshopLevelCap,
  withFirstPerson,
  type Event,
  type World,
} from '../src/index.ts';
import { CARON, LECLERC, TEST_FIRST_DYNASTY, tick, town } from './helpers.ts';

const SEED = 20261107;

function leased(world: World) {
  return world.people[LECLERC];
}

function refusal(events: Event[], reason: string) {
  return events.find((event) => event.type === 'action.refused' && event.reason === reason);
}

describe('workshops, trades and the ladder', () => {
  it('sums the warehouse from what each workshop level holds', () => {
    // Arrange: the kit's level 2 loom, and a second one after a build.
    const world = town(SEED);

    // Assert
    expect(stockCapacityUnits(world.people[LECLERC])).toBe(200);
    expect(stockCapacityUnits(createWorld().people[CARON])).toBe(350);
  });

  it("builds a workshop at once, on the action's hour, and charges for it", () => {
    // Arrange: a purse that pays the build.
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 1_000_000;
    const treasury = world.people[LECLERC].treasuryCents;

    // A second building needs a residence that holds two: the level 1 holds one.
    world.people[LECLERC].title = 'bourgeois';
    world.people[LECLERC].residenceLevel = 3;

    // Act
    const { world: after, events } = tick(world, [{ type: 'workshop.build', personId: LECLERC, trade: 'baker' }]);

    // Assert: the workshop is there the same hour, at the built level.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'workshop.built', audience: { personId: LECLERC }, trade: 'baker' }),
    );
    expect(leased(after).workshops).toHaveLength(2);
    expect(leased(after).workshops[1]?.trade).toBe('baker');
    expect(leased(after).workshops[1]?.level).toBe(RULES.builtWorkshopLevel);
    expect(treasury - after.people[LECLERC].treasuryCents).toBeGreaterThanOrEqual(RULES.buildCents);
  });

  it('gives each act its wait: hours for a build, a degree and an improvement, none for a trade', () => {
    // Arrange
    const world = town(SEED);
    const workshopId = leased(world).workshops[0]!.id;

    // Assert: the server writes the order at the hour it will play.
    expect(leadHoursOf(world, { type: 'market.buy', personId: LECLERC, good: 'wool', units: 1 })).toBe(0);
    expect(leadHoursOf(world, { type: 'workshop.build', personId: LECLERC, trade: 'baker' })).toBe(RULES.buildHours);
    expect(leadHoursOf(world, { type: 'person.buy_title', personId: LECLERC })).toBe(RULES.titleHours);
    expect(leadHoursOf(world, { type: 'workshop.upgrade', personId: LECLERC, workshopId })).toBe(
      RULES.improvementHours[3],
    );
    expect(leadHoursOf(world, { type: 'person.upgrade_residence', personId: LECLERC })).toBe(RULES.improvementHours[2]);
  });

  it('refuses a build past the residence cap', () => {
    // Arrange: a dynasty at residence 1, which holds one workshop it already has.
    const world = town(SEED);

    // Act
    const { world: after, events } = tick(world, [{ type: 'workshop.build', personId: LECLERC, trade: 'baker' }]);

    // Assert
    expect(refusal(events, 'workshop_cap')).toBeDefined();
    expect(leased(after).workshops).toHaveLength(1);
  });

  it('builds two workshops in one hour when the residence holds three', () => {
    // Arrange: a knight's residence, which holds three workshops.
    const world = town(SEED);
    world.people[LECLERC].title = 'chevalier';
    world.people[LECLERC].residenceLevel = 6;
    world.people[LECLERC].treasuryCents = 1_000_000;

    // Act: one build opens a place, the next fills it.
    const { world: after, events } = tick(world, [
      { type: 'workshop.build', personId: LECLERC, trade: 'baker' },
      { type: 'workshop.build', personId: LECLERC, trade: 'carpenter' },
    ]);

    // Assert
    expect(leased(after).workshops).toHaveLength(3);
    expect(events.filter((event) => event.type === 'workshop.built')).toHaveLength(2);
  });

  it('refuses to destroy the last workshop', () => {
    // Arrange
    const world = town(SEED);
    const workshopId = leased(world).workshops[0]!.id;

    // Act
    const { world: after, events } = tick(world, [{ type: 'workshop.destroy', personId: LECLERC, workshopId }]);

    // Assert
    expect(refusal(events, 'last_workshop')).toBeDefined();
    expect(leased(after).workshops).toHaveLength(1);
  });

  it('destroys a workshop with no refund, and keeps the stock it cannot hold', () => {
    // Arrange: two workshops and a warehouse above what one level 2 holds.
    const world = town(SEED);
    const [first, second] = [leased(world).workshops[0]!, { id: 2, trade: 'baker' as const, level: 2 }];
    leased(world).workshops = [first, second];
    leased(world).stock = { wool: 300 };
    const treasury = world.people[LECLERC].treasuryCents;

    // Act
    const { world: after } = tick(world, [{ type: 'workshop.destroy', personId: LECLERC, workshopId: second.id }]);

    // Assert: nothing is credited, nothing is confiscated, and the cap fell.
    expect(leased(after).workshops).toHaveLength(1);
    expect(stockUnits(leased(after))).toBeGreaterThanOrEqual(300);
    expect(after.people[LECLERC].treasuryCents).toBeLessThanOrEqual(treasury);
    expect(stockCapacityUnits(leased(after))).toBe(200);
  });

  it('raises a workshop one level at a time, for hours and no money, up to the title cap', () => {
    // Arrange: a roturier, whose cap is 2, and its level 2 loom.
    const world = town(SEED);
    const workshopId = leased(world).workshops[0]!.id;

    // Act: the upgrade is refused at the cap, then allowed once the title opens it.
    const { events } = tick(world, [{ type: 'workshop.upgrade', personId: LECLERC, workshopId }]);
    const promoted = town(SEED);
    promoted.people[LECLERC].title = 'bourgeois';
    const run = tick(promoted, [{ type: 'workshop.upgrade', personId: LECLERC, workshopId }]);

    // Assert: the level is raised at once, and the warehouse grows with it.
    expect(refusal(events, 'level_cap')).toBeDefined();
    expect(run.events).toContainEqual(
      expect.objectContaining({ type: 'workshop.upgraded', personId: LECLERC, level: 3 }),
    );
    expect(leased(run.world).workshops[0]?.level).toBe(3);
    expect(stockCapacityUnits(leased(run.world))).toBe(350);
  });

  it('upgrades at once, and the hour produces at the new level', () => {
    // Arrange: a loom with wool, before the action.
    const world = town(SEED);
    world.people[LECLERC].title = 'bourgeois';
    world.people[LECLERC].stock = { wool: 60 };
    const workshopId = leased(world).workshops[0]!.id;

    // Act: the action and the production happen in the same hour.
    const started = tick(world, [{ type: 'workshop.upgrade', personId: LECLERC, workshopId }]);

    // Assert: the higher level wove six cloth, not four.
    expect(started.world.people[LECLERC].stock.cloth).toBe(6);
  });

  it("obtains a title at once, on the action's hour", () => {
    // Arrange
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 1_000_000;
    const price = 60_000;

    // Act
    const { world: after, events } = tick(world, [{ type: 'person.buy_title', personId: LECLERC }]);

    // Assert: the degree is there the same hour, and the price was paid.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'person.title_bought', personId: LECLERC, title: 'bourgeois' }),
    );
    expect(titleOf(after.people[LECLERC]!)).toBe('bourgeois');
    expect(world.people[LECLERC].treasuryCents - after.people[LECLERC].treasuryCents).toBeGreaterThanOrEqual(price);
  });

  it('refuses a title the dynasty cannot pay for, and names the missing money', () => {
    // Arrange
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 10;

    // Act
    const { world: after, events } = tick(world, [{ type: 'person.buy_title', personId: LECLERC }]);

    // Assert: nothing is bought and the degree does not move.
    expect(refusal(events, 'insufficient_funds')).toBeDefined();
    expect(titleOf(after.people[LECLERC]!)).toBe('roturier');
  });

  it('opens the residence only as far as the title did', () => {
    // Arrange: a roturier, whose degree opens level 1.
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 1_000_000;

    // Act
    const { world: after, events } = tick(world, [{ type: 'person.upgrade_residence', personId: LECLERC }]);

    // Assert
    expect(refusal(events, 'title_open')).toBeDefined();
    expect(after.people[LECLERC]?.residenceLevel).toBe(1);
  });

  it('climbs two degrees in one hour, paying each one', () => {
    // Arrange: an order placed twice before the hour plays.
    const world = town(SEED);
    world.people[LECLERC].treasuryCents = 1_000_000;
    const spent = (next: World, before: World) =>
      before.people[LECLERC].treasuryCents - (next.people[LECLERC]?.treasuryCents ?? 0);

    // Act: the first degree applies before the second is read.
    const { world: after, events } = tick(world, [
      { type: 'person.buy_title', personId: LECLERC },
      { type: 'person.buy_title', personId: LECLERC },
    ]);

    // Assert: bourgeois then notable, one price each.
    expect(events.filter((event) => event.type === 'person.title_bought')).toHaveLength(2);
    expect(titleOf(after.people[LECLERC]!)).toBe('notable');
    expect(spent(after, world)).toBeGreaterThanOrEqual(60_000 + 120_000);
  });

  it('pays for a residence level the title opened, and the level caps prestige and workshops', () => {
    // Arrange: a bourgeois has opened level 2; level 1 holds one workshop.
    const world = town(SEED);
    world.people[LECLERC].title = 'bourgeois';
    world.people[LECLERC].treasuryCents = 1_000_000;
    expect(workshopCap(1)).toBe(1);

    // Act
    const run = tick(world, [{ type: 'person.upgrade_residence', personId: LECLERC }]);

    // Assert
    const person = run.world.people[LECLERC];
    expect(person?.residenceLevel).toBe(2);
    // Level 2 holds one workshop as well: the second service arrives at level 3.
    expect(workshopCap(2)).toBe(1);
    expect(displayedPrestige(person?.prestige ?? 0, 'bourgeois', 2)).toBe(
      80 + 50 + Math.min(person?.prestige ?? 0, 300),
    );
  });

  it('shows the prestige of the title and of the residence, and caps only the service', () => {
    // Arrange: a patrician at residence 4, with more service than the cap allows.
    const world = town(SEED);
    world.people[LECLERC].title = 'patricien';
    world.people[LECLERC].residenceLevel = 4;
    world.people[LECLERC].prestige = 10_000;

    // Assert: the title adds its 140 and the residence 90, the service stops at 500.
    expect(displayedPrestige(world.people[LECLERC].prestige, 'patricien', 4)).toBe(140 + 90 + 500);
    expect(workshopLevelCap('patricien')).toBe(4);
  });

  it('walks the twelve degrees in order and stops at the prince', () => {
    expect(TITLES).toHaveLength(12);
    for (let index = 0; index < TITLES.length - 1; index += 1) {
      expect(nextTitle(TITLES[index]!)).toBe(TITLES[index + 1]);
    }
    expect(nextTitle('prince')).toBeUndefined();
  });

  it('names the first dynasty from what it is given, with an id that is not its name', () => {
    // Arrange
    const identity = { ...TEST_FIRST_DYNASTY, personName: 'Colin Moreau' };

    // Act
    const world = withFirstPerson(createWorld(), 'weaver', identity);

    // Assert
    expect(world.people[LECLERC]?.name).toBe('Colin Moreau');
  });
});
