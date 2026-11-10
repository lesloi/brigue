import { describe, expect, it } from 'vitest';

import {
  AUDIENCE_KINDS,
  audienceCode,
  audienceOfCode,
  GOODS,
  TITLES,
  TRADES,
  goodCode,
  goodOfCode,
  titleCode,
  titleOfCode,
  tradeCode,
  tradeOfCode,
} from '../src/index.ts';

/**
 * The code of a word is a place in a list, one based, and the rows of the
 * database carry it. A list may gain an entry, but a place once written is never
 * renumbered: this test is that contract, written out, so reordering a list
 * fails here instead of silently rewriting what a stored world means.
 */
describe('the codes a row carries', () => {
  it('pins the twelve degrees, in the order a person buys them', () => {
    expect(TITLES).toEqual([
      'roturier',
      'bourgeois',
      'notable',
      'patricien',
      'ecuyer',
      'chevalier',
      'baron',
      'vicomte',
      'comte',
      'marquis',
      'duc',
      'prince',
    ]);
    expect(TITLES.map(titleCode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect([12, 1, 4].map(titleOfCode)).toEqual(['prince', 'roturier', 'patricien']);
  });

  it('pins the six goods, raw and finished together', () => {
    expect(GOODS).toEqual(['wool', 'cloth', 'grain', 'bread', 'wood', 'planks']);
    expect(GOODS.map(goodCode)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([1, 6, 4].map(goodOfCode)).toEqual(['wool', 'planks', 'bread']);
  });

  it('pins the three trades', () => {
    expect(TRADES).toEqual(['weaver', 'baker', 'carpenter']);
    expect(TRADES.map(tradeCode)).toEqual([1, 2, 3]);
    expect([3, 1].map(tradeOfCode)).toEqual(['carpenter', 'weaver']);
  });

  it('pins the two audiences a chronicle row may carry', () => {
    expect(AUDIENCE_KINDS).toEqual(['town', 'court']);
    expect(AUDIENCE_KINDS.map(audienceCode)).toEqual([1, 2]);
    expect([2, 1].map(audienceOfCode)).toEqual(['court', 'town']);
  });

  it('leaves a code the list does not know undefined, so the store can refuse the row', () => {
    expect(titleOfCode(0)).toBeUndefined();
    expect(titleOfCode(13)).toBeUndefined();
    expect(goodOfCode(7)).toBeUndefined();
    expect(tradeOfCode(4)).toBeUndefined();
    expect(audienceOfCode(3)).toBeUndefined();
  });
});
