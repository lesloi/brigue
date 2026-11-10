import { describe, expect, it } from 'vitest';

import { RULES, visibleTo, type Action, type Event, type World } from '../src/index.ts';
import { CARON, LECLERC, FOURNIER, tick, town } from './helpers.ts';

const SEED = 20261029;
const YEAR = 24;

function play(
  world: World,
  hours: number,
  at: (hour: number) => Action[] = () => [],
  dormant: ReadonlySet<number> = new Set(),
  random: () => number = () => 0.5,
): { world: World; events: Event[] } {
  let current = world;
  const events: Event[] = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const result = tick(current, at(hour), dormant, random);
    current = result.world;
    events.push(...result.events);
  }

  return { world: current, events };
}

/** Rolls one value per candidate, in the order their ids are sorted. */
function rolls(...values: number[]): () => number {
  let index = 0;

  return () => values[index++] ?? 0;
}

/** The AI still buys and sells, but it does not take a seat unless it holds one. */
function withoutAiCampaigns(world: World): World {
  for (const person of Object.values(world.people)) {
    if (person.ia) {
      person.favour = 0;
    }
  }

  return world;
}

describe('the election', () => {
  it('puts only the applicant and the active incumbent on the ballot', () => {
    // Arrange: caron holds the mayoralty, no AI can campaign, leclerc stands.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: CARON };
    const result = play(world, YEAR, (hour) =>
      hour === 7 ? [{ type: 'council.campaign', personId: LECLERC, seatId: 'maire' }] : [],
    );

    // Assert: the mayoralty has two candidates, and no other person appears.
    const results = result.events.filter(
      (event): event is Extract<Event, { type: 'council.election_result' }> =>
        event.type === 'council.election_result' && event.seatId === 'maire',
    );
    expect(results.map((event) => event.personId).sort((left, right) => left - right)).toEqual([CARON, LECLERC]);
    expect(results.every((event) => Object.keys(event.votes).sort().join(',') === `${CARON},${LECLERC}`)).toBe(true);

    // The candidacy and the result are private; another person sees neither.
    for (const event of result.events) {
      if (event.type === 'council.campaigned' || event.type === 'council.election_result') {
        expect(visibleTo([event], FOURNIER)).toEqual([]);
      }
    }
  });

  it('does not announce a re-elected incumbent', () => {
    // Arrange: caron holds the seat and the roll favours him.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: CARON };
    world.campaigns.maire = [LECLERC];
    const dice = rolls(0.99, 0);

    // Act
    const result = play(world, YEAR, undefined, new Set(), dice);

    // Assert: the incumbent keeps it, the town hears nothing, the candidates do.
    expect(
      result.events.find((event) => event.type === 'council.election_held' && event.seatId === 'maire'),
    ).toBeUndefined();
    expect(
      result.events.find(
        (event): event is Extract<Event, { type: 'council.election_result' }> =>
          event.type === 'council.election_result' && event.seatId === 'maire' && event.won,
      )?.winnerPersonId,
    ).toBe(CARON);
  });

  it('announces a new winner', () => {
    // Arrange: caron holds the seat and the roll goes to the challenger.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: CARON };
    world.campaigns.maire = [LECLERC];
    const dice = rolls(0, 0.99);

    // Act
    const result = play(world, YEAR, undefined, new Set(), dice);

    // Assert
    expect(
      result.events.find(
        (event): event is Extract<Event, { type: 'council.election_held' }> =>
          event.type === 'council.election_held' && event.seatId === 'maire',
      )?.winnerPersonId,
    ).toBe(LECLERC);
  });

  it('refuses a second open candidacy before it can spend favour', () => {
    // Arrange
    const world = withoutAiCampaigns(town(SEED));
    const before = world.people[LECLERC].favour;

    // Act: two seats lodged in the same hour.
    const result = tick(world, [
      { type: 'council.campaign', personId: LECLERC, seatId: 'maire' },
      { type: 'council.campaign', personId: LECLERC, seatId: 'tresorier' },
    ]);

    // Assert: the first stands, the second is refused, and only one cost is paid.
    expect(result.world.campaigns.maire).toEqual([LECLERC]);
    expect(result.world.campaigns.tresorier).toBeUndefined();
    expect(result.world.people[LECLERC].favour).toBe(before - RULES.campaignFavourCost);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'action.refused', reason: 'already_candidate', personId: LECLERC }),
    );
  });

  it('gives a tie to the lowest id, never to the order of the object', () => {
    // Arrange: caron holds the seat and the roll gives every candidate the same
    // vote; caron's id is the lowest of the two.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: CARON };
    world.campaigns.maire = [LECLERC];

    // Act
    const result = play(world, YEAR, undefined, new Set(), rolls(0, 0));

    // Assert: a tie keeps the incumbent, whose vote is the first of the sorted
    // candidate ids.
    expect(
      result.events.find(
        (event): event is Extract<Event, { type: 'council.election_result' }> =>
          event.type === 'council.election_result' && event.seatId === 'maire' && event.won,
      )?.winnerPersonId,
    ).toBe(CARON);
  });

  it('leaves the seat a climbing winner gives up publicly vacant', () => {
    // Arrange: leclerc holds the provostship and stands for the mayoralty, and
    // the roll gives it to him.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.prevot = { personId: LECLERC };
    const result = play(
      world,
      YEAR,
      (hour) => (hour === 7 ? [{ type: 'council.campaign', personId: LECLERC, seatId: 'maire' }] : []),
      new Set(),
      rolls(0.99),
    );

    // Assert: leclerc takes the mayoralty and the provostship falls vacant with
    // a public line of its own.
    expect(result.world.seats.maire.personId).toBe(LECLERC);
    expect(result.world.seats.prevot.personId).toBeNull();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'council.election_held',
        seatId: 'prevot',
        winnerPersonId: null,
        votes: {},
      }),
    );
  });

  it('leaves a dormant incumbent’s seat vacant when nobody stands', () => {
    // Arrange: caron holds the mayoralty and goes dormant; no AI can campaign.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: CARON };

    // Act
    const result = play(world, YEAR, undefined, new Set([CARON]));

    // Assert: the seat is cleared and announced as vacant.
    expect(result.world.seats.maire.personId).toBeNull();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'council.election_held',
        seatId: 'maire',
        winnerPersonId: null,
        votes: {},
      }),
    );
  });
});
