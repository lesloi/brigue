import type { Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import type { PendingActionView } from '../src/api.ts';
import { eventLine, ledgerEvents } from '../src/events.ts';
import { buyMax, netPendingFor, pendingCashCents, pendingUnits, sellMax } from '../src/trade.ts';
import {
  actionErrorText,
  goodName,
  goodQuantity,
  pendingActionText,
  readErrorText,
  refusalText,
  seatName,
  tradeChainText,
  tradeName,
} from '../src/format.ts';
import { navigationFor, stateOf, tabFromHash } from '../src/tabs.ts';
import { countdownText, scrutinyText } from '../src/views/ville.tsx';

const NAMES: Record<string, string> = {
  brigue: 'Brigue',
  caron: 'Caron',
  herse: 'de Herse',
};

const nameOf = (houseId: string): string => NAMES[houseId] ?? 'une maison inconnue';

describe('eventLine', () => {
  it('says "Vous" for the player and pluralises the goods', () => {
    // Arrange
    const event: Event = {
      type: 'market.bought',
      audience: 'town',
      houseId: 'brigue',
      good: 'wool',
      units: 10,
      priceCents: 380,
      totalCents: 3800,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.tone).toBe('loss');
    expect(line.text).toContain('Vous avez acheté 10 laines');
    expect(line.text).toContain('soit 38 écus');
  });

  it('names another house and keeps the singular for one unit', () => {
    // Arrange
    const event: Event = {
      type: 'market.bought',
      audience: 'town',
      houseId: 'caron',
      good: 'wool',
      units: 1,
      priceCents: 380,
      totalCents: 380,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.text).toContain('Caron a acheté 1 laine');
  });

  it('reads a refusal as a refusal, not as money moving', () => {
    // Arrange
    const event: Event = {
      type: 'action.refused',
      audience: { houseId: 'brigue' },
      action: 'market.buy',
      houseId: 'brigue',
      reason: 'insufficient_funds',
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.tone).toBe('refusal');
    expect(line.text).toBe('Vous : achat refusé — fonds insuffisants.');
  });

  it('keeps the house grammar for a missed wage payment', () => {
    // Arrange
    const own: Event = {
      type: 'house.penniless',
      audience: { houseId: 'brigue' },
      houseId: 'brigue',
      shortfallCents: 240,
    };
    const other: Event = {
      type: 'house.penniless',
      audience: { houseId: 'caron' },
      houseId: 'caron',
      shortfallCents: 240,
    };

    // Act
    const ownLine = eventLine(own, 'brigue', nameOf);
    const otherLine = eventLine(other, 'brigue', nameOf);

    // Assert
    expect(ownLine.text).toBe("Vous n'avez pas pu payer 2,4 écus de gages.");
    expect(otherLine.text).toBe("Caron n'a pas pu payer 2,4 écus de gages.");
  });

  it('reads production as goods entering the warehouse', () => {
    // Arrange
    const event: Event = {
      type: 'workshop.produced',
      audience: { houseId: 'brigue' },
      houseId: 'brigue',
      good: 'cloth',
      units: 4,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.tone).toBe('gain');
    expect(line.text).toBe('Vous avez produit 4 draps.');
  });

  it('reads an overflow as goods left out of a full warehouse', () => {
    // Arrange
    const event: Event = {
      type: 'workshop.overflow',
      audience: { houseId: 'brigue' },
      houseId: 'brigue',
      good: 'wool',
      refusedUnits: 3,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.text).toBe('Vous : entrepôt plein, 3 laines en trop.');
  });
});

describe('format helpers', () => {
  it('pluralises goods only above one unit', () => {
    expect(goodQuantity(0, 'grain')).toBe('0 blé');
    expect(goodQuantity(1, 'wool')).toBe('1 laine');
    expect(goodQuantity(3, 'cloth')).toBe('3 draps');
    expect(goodQuantity(2, 'bread')).toBe('2 pains');
    expect(goodQuantity(2, 'wood')).toBe('2 bois');
    expect(goodQuantity(2, 'planks')).toBe('2 planches');
  });

  it('names the six goods', () => {
    expect(goodName('bread')).toBe('pain');
    expect(goodName('wood')).toBe('bois');
    expect(goodName('planks')).toBe('planche');
  });

  it('names the three trades and what each chain does', () => {
    expect(tradeName('weaver')).toBe('Tisserand');
    expect(tradeName('baker')).toBe('Boulanger');
    expect(tradeName('carpenter')).toBe('Charpentier');
    expect(tradeChainText('baker')).toBe('achète le blé, fait du pain');
  });

  it('names seats and refusals in French', () => {
    expect(seatName('echevin-north')).toBe('échevinage nord');
    expect(refusalText('insufficient_favour')).toBe('faveur insuffisante');
    expect(refusalText('unknown_good')).toBe('denrée inconnue');
    expect(refusalText('insufficient_stock')).toBe('stock insuffisant');
    expect(refusalText('stock_full')).toBe('entrepôt plein');
    expect(readErrorText('invalid_trade')).toBe('Métier inconnu.');
  });

  it('separates action failures from read failures', () => {
    expect(actionErrorText('stale_week')).toContain('déjà passée');
    expect(actionErrorText(null)).toBe("L'action n'a pas pu être envoyée.");
    expect(readErrorText('world_version')).toContain('plus compatible');
    expect(readErrorText(null)).toBe("La ville n'a pas pu être relue.");
  });
});

describe('countdownText', () => {
  const start = Date.parse('2026-01-01T00:00:00.000Z');

  it('shows minutes and seconds under an hour', () => {
    expect(countdownText(new Date(start + 90_000).toISOString(), start)).toBe('semaine dans 1:30');
  });

  it('switches to hours and minutes above an hour', () => {
    expect(countdownText(new Date(start + 2 * 3_600_000 + 5 * 60_000).toISOString(), start)).toBe(
      'semaine dans 2 h 05',
    );
  });

  it('does not go negative', () => {
    expect(countdownText(new Date(start - 1_000).toISOString(), start)).toBe('semaine imminente');
  });
});

describe('scrutinyText', () => {
  const start = Date.parse('2026-01-01T00:00:00.000Z');

  it('counts down to the instant the projection dates', () => {
    expect(scrutinyText(new Date(start + 2 * 3_600_000 + 5 * 60_000).toISOString(), start)).toBe('scrutin dans 2 h 05');
  });

  it('never goes negative', () => {
    expect(scrutinyText(new Date(start - 1_000).toISOString(), start)).toBe('scrutin imminent');
  });
});

describe('tab history', () => {
  it('pushes Marché from the home tab', () => {
    expect(navigationFor('ville', { tab: 'ville', pushed: false }, 'marche')).toBe('push');
  });

  it('walks back to the tab it came from', () => {
    expect(navigationFor('marche', { tab: 'marche', pushed: true }, 'ville')).toBe('back');
  });

  it('replaces a deep-linked Marché instead of leaving the PWA', () => {
    expect(navigationFor('marche', { tab: 'marche', pushed: false }, 'ville')).toBe('replace');
  });

  it('does nothing on the current tab', () => {
    expect(navigationFor('ville', null, 'ville')).toBe('none');
  });

  it('seeds the tab from the hash and validates history state', () => {
    expect(tabFromHash('#marche')).toBe('marche');
    expect(tabFromHash('')).toBe('ville');
    expect(stateOf(null)).toBeNull();
    expect(stateOf({ tab: 'marche', pushed: true })).toEqual({ tab: 'marche', pushed: true });
  });
});

describe('the ledger filter', () => {
  const events: Event[] = [
    {
      type: 'market.sold',
      audience: 'town',
      houseId: 'brigue',
      good: 'cloth',
      units: 2,
      priceCents: 1240,
      revenueCents: 2480,
    },
    {
      type: 'market.bought',
      audience: 'town',
      houseId: 'caron',
      good: 'wool',
      units: 6,
      priceCents: 380,
      totalCents: 2280,
    },
    { type: 'council.election_held', audience: 'town', seatId: 'maire', winnerHouseId: 'caron', votes: {} },
    { type: 'market.price_changed', audience: 'town', good: 'cloth', before: 1240, after: 1250 },
    { type: 'house.wages_paid', audience: { houseId: 'brigue' }, houseId: 'brigue', amountCents: 240 },
  ];

  it('keeps the house and the town politics by default', () => {
    // Act
    const filtered = ledgerEvents(events, 'brigue', 'house');

    // Assert
    expect(filtered.map((event) => event.type)).toEqual(['market.sold', 'council.election_held', 'house.wages_paid']);
  });

  it('keeps only the prices in the prices cut', () => {
    expect(ledgerEvents(events, 'brigue', 'prices').map((event) => event.type)).toEqual(['market.price_changed']);
  });

  it('keeps everything in the full cut', () => {
    expect(ledgerEvents(events, 'brigue', 'all')).toEqual(events);
  });
});

describe('pending actions', () => {
  const pending: PendingActionView[] = [
    { id: 'a', week: 3, type: 'market.buy', good: 'grain', units: 5 },
    { id: 'b', week: 3, type: 'market.buy', good: 'grain', units: 10 },
    { id: 'c', week: 3, type: 'market.sell', good: 'grain', units: 4 },
    { id: 'd', week: 3, type: 'market.buy', good: 'wool', units: 2 },
    { id: 'e', week: 3, type: 'council.campaign', seatId: 'maire' },
  ];

  it('nets the market actions of one good', () => {
    // Act and assert: a campaign is not a trade and never enters the net.
    expect(netPendingFor('grain', pending)).toBe(11);
    expect(netPendingFor('wool', pending)).toBe(2);
    expect(netPendingFor('cloth', pending)).toBe(0);
  });

  it('says a queued action in words', () => {
    expect(pendingActionText(pending[0] as PendingActionView)).toBe('Achat de 5 blés');
    expect(pendingActionText(pending[2] as PendingActionView)).toBe('Vente de 4 blés');
    expect(pendingActionText(pending[4] as PendingActionView)).toBe('Candidature à la mairie');
  });

  it("values the queued actions at the week's prices", () => {
    // Arrange
    const prices = { wool: 380, cloth: 1240, grain: 260, bread: 520, wood: 300, planks: 980 };
    const queued: PendingActionView[] = [
      { id: 'a', week: 3, type: 'market.buy', good: 'grain', units: 5 },
      { id: 'b', week: 3, type: 'market.sell', good: 'bread', units: 3 },
    ];

    // Act and assert: -5 × 260 + 3 × 520, and 5 − 3 units net.
    expect(pendingCashCents(queued, prices)).toBe(260);
    expect(pendingUnits(queued)).toBe(2);
  });

  it('caps the buy at the purse and the warehouse, and the sell at the stock', () => {
    // Arrange
    const base = {
      treasuryCents: 1000,
      pendingCashCents: 0,
      stockUnits: 8,
      pendingUnits: 0,
      capacityUnits: 10,
      priceCents: 100,
    };

    // Act and assert
    expect(buyMax(base)).toBe(2);
    expect(buyMax({ ...base, pendingCashCents: -200 })).toBe(2);
    expect(buyMax({ ...base, pendingUnits: 2 })).toBe(0);
    expect(sellMax(8, -3)).toBe(5);
    expect(sellMax(0, 5)).toBe(5);
    expect(sellMax(2, -5)).toBe(0);
  });
});
