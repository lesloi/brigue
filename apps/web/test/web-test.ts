import type { Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { eventLine } from '../src/events.ts';
import {
  actionErrorText,
  goodName,
  goodQuantity,
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
