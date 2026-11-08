import { describe, expect, it } from 'vitest';

import { RULES, visibleTo, type Action, type Event, type World } from '../src/index.ts';
import { tick, town } from './helpers.ts';

const SEED = 20261029;
const YEAR = 24;

function play(
  world: World,
  hours: number,
  at: (hour: number) => Action[] = () => [],
  dormant: ReadonlySet<string> = new Set(),
): { world: World; events: Event[] } {
  let current = world;
  const events: Event[] = [];

  for (let hour = 0; hour < hours; hour += 1) {
    const result = tick(current, at(hour), dormant);
    current = result.world;
    events.push(...result.events);
  }

  return { world: current, events };
}

/** The AI still buys and sells, but it does not take a seat unless it holds one. */
function withoutAiCampaigns(world: World): World {
  for (const dynasty of Object.values(world.dynasties)) {
    if (dynasty.controller === 'ai') {
      dynasty.favour = 0;
    }
  }

  return world;
}

describe('the election', () => {
  it('puts only the applicant and the active incumbent on the ballot', () => {
    // Arrange: caron holds the mayoralty, no AI can campaign, leclerc stands.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: 'person-caron' };
    const result = play(world, YEAR, (hour) =>
      hour === 7 ? [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' }] : [],
    );

    // Assert: the mayoralty has two candidates, and no other dynasty appears.
    const results = result.events.filter(
      (event): event is Extract<Event, { type: 'council.election_result' }> =>
        event.type === 'council.election_result' && event.seatId === 'maire',
    );
    expect(results.map((event) => event.dynastyId).sort()).toEqual(['caron', 'leclerc']);
    expect(results.every((event) => Object.keys(event.votes).sort().join(',') === 'caron,leclerc')).toBe(true);

    // The candidacy and the result are private; another dynasty sees neither.
    for (const event of result.events) {
      if (event.type === 'council.campaigned' || event.type === 'council.election_result') {
        expect(visibleTo([event], 'fournier')).toEqual([]);
      }
    }
  });

  it('does not announce a re-elected incumbent', () => {
    // Arrange: caron holds the seat and outruns the only challenger.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: 'person-caron' };
    world.campaigns.maire = { leclerc: 0, caron: 100 };

    // Act
    const result = play(world, YEAR);

    // Assert: the incumbent keeps it, the town hears nothing, the candidates do.
    expect(
      result.events.find((event) => event.type === 'council.election_held' && event.seatId === 'maire'),
    ).toBeUndefined();
    expect(
      result.events.find(
        (event): event is Extract<Event, { type: 'council.election_result' }> =>
          event.type === 'council.election_result' && event.seatId === 'maire' && event.won,
      )?.winnerDynastyId,
    ).toBe('caron');
  });

  it('announces a new winner', () => {
    // Arrange: caron holds the seat and loses it to the challenger.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: 'person-caron' };
    world.campaigns.maire = { leclerc: 100, caron: 0 };

    // Act
    const result = play(world, YEAR);

    // Assert
    expect(
      result.events.find(
        (event): event is Extract<Event, { type: 'council.election_held' }> =>
          event.type === 'council.election_held' && event.seatId === 'maire',
      )?.winnerDynastyId,
    ).toBe('leclerc');
  });

  it('refuses a second open candidacy before it can spend favour', () => {
    // Arrange
    const world = withoutAiCampaigns(town(SEED));
    const before = world.dynasties.leclerc.favour;

    // Act: two seats lodged in the same hour.
    const result = tick(world, [
      { type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' },
      { type: 'council.campaign', dynastyId: 'leclerc', seatId: 'tresorier' },
    ]);

    // Assert: the first stands, the second is refused, and only one cost is paid.
    expect(result.world.campaigns.maire?.leclerc).toBe(RULES.campaignVoteBonus);
    expect(result.world.campaigns.tresorier).toBeUndefined();
    expect(result.world.dynasties.leclerc.favour).toBe(before - RULES.campaignFavourCost);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'action.refused', reason: 'already_candidate', dynastyId: 'leclerc' }),
    );
  });

  it('leaves the seat a climbing winner gives up publicly vacant', () => {
    // Arrange: leclerc holds the provostship and stands for the mayoralty.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.prevot = { personId: 'person-leclerc' };
    const result = play(world, YEAR, (hour) =>
      hour === 7 ? [{ type: 'council.campaign', dynastyId: 'leclerc', seatId: 'maire' }] : [],
    );

    // Assert: leclerc takes the mayoralty and the provostship falls vacant with
    // a public line of its own.
    expect(result.world.seats.maire.personId).toBe('person-leclerc');
    expect(result.world.seats.prevot.personId).toBeNull();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'council.election_held',
        seatId: 'prevot',
        winnerDynastyId: null,
        votes: {},
      }),
    );
  });

  it('leaves a dormant incumbent’s seat vacant when nobody stands', () => {
    // Arrange: caron holds the mayoralty and goes dormant; no AI can campaign.
    const world = withoutAiCampaigns(town(SEED));
    world.seats.maire = { personId: 'person-caron' };

    // Act
    const result = play(world, YEAR, undefined, new Set(['caron']));

    // Assert: the seat is cleared and announced as vacant.
    expect(result.world.seats.maire.personId).toBeNull();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'council.election_held',
        seatId: 'maire',
        winnerDynastyId: null,
        votes: {},
      }),
    );
  });
});
