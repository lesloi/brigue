import { describe, expect, it } from 'vitest';

import { countEvent, emptyTally, foldGrouped } from '../src/journal.ts';

describe('the journal tally', () => {
  it('counts a refusal by type and by reason', () => {
    // Arrange
    const tally = emptyTally();

    // Act
    countEvent(tally, {
      type: 'action.refused',
      audience: { houseId: 'brigue' },
      at: 1,
      houseId: 'brigue',
      action: 'market.buy',
      reason: 'insufficient_funds',
    });

    // Assert
    expect(tally.counts).toEqual({ 'action.refused': 1 });
    expect(tally.refusals).toEqual({ insufficient_funds: 1 });
  });

  it('folds grouped rows and keeps a stray reason out of the refusals', () => {
    // Arrange: only a refusal's reason belongs in the refusal tally.
    const tally = emptyTally();

    // Act
    foldGrouped(tally, [
      { type: 'market.bought', reason: null, count: 3 },
      { type: 'action.refused', reason: 'stock_full', count: 2 },
      { type: 'market.sold', reason: 'stray', count: 1 },
    ]);

    // Assert
    expect(tally.counts).toEqual({ 'market.bought': 3, 'action.refused': 2, 'market.sold': 1 });
    expect(tally.refusals).toEqual({ stock_full: 2 });
  });

  it('adds up rows of the same type across reasons', () => {
    // Arrange
    const tally = emptyTally();

    // Act
    foldGrouped(tally, [
      { type: 'action.refused', reason: 'stock_full', count: 2 },
      { type: 'action.refused', reason: 'insufficient_funds', count: 1 },
    ]);

    // Assert
    expect(tally.counts).toEqual({ 'action.refused': 3 });
    expect(tally.refusals).toEqual({ stock_full: 2, insufficient_funds: 1 });
  });
});
