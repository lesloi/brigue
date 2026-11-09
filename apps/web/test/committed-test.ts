import { describe, expect, it } from 'vitest';

import { committedCents } from '../src/committed.ts';

describe('money set aside', () => {
  it('counts what the queued purchases and builds will take', () => {
    // Arrange: a title, a residence level and a workshop, all queued.
    const queued = [
      { id: 1, hour: 12, type: 'person.buy_title' as const },
      { id: 2, hour: 12, type: 'person.upgrade_residence' as const },
      { id: 3, hour: 12, type: 'workshop.build' as const, trade: 'baker' as const },
      { id: 4, hour: 12, type: 'market.buy' as const, good: 'wool' as const, units: 4 },
    ];

    // Act
    const committed = committedCents(queued, { titleCents: 60_000, residenceCents: 80_000, buildCents: 50_000 });

    // Assert: the market is priced by the hour it plays, so it is not counted here.
    expect(committed).toBe(60_000 + 80_000 + 50_000);
  });

  it('counts nothing when the queue is empty', () => {
    expect(committedCents([], { titleCents: 60_000, residenceCents: 80_000, buildCents: 50_000 })).toBe(0);
  });
});
