import type { Event } from '@brigue/core';
import { describe, expect, it } from 'vitest';

import { eventLine } from '../src/events.ts';
import { actionErrorText, goodQuantity, readErrorText, refusalText, seatName } from '../src/format.ts';
import { countdownText } from '../src/views/ville.ts';

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
    const own: Event = { type: 'house.penniless', houseId: 'brigue', shortfallCents: 240 };
    const other: Event = { type: 'house.penniless', houseId: 'caron', shortfallCents: 240 };

    // Act
    const ownLine = eventLine(own, 'brigue', nameOf);
    const otherLine = eventLine(other, 'brigue', nameOf);

    // Assert
    expect(ownLine.text).toBe("Vous n'avez pas pu payer 2,4 écus de gages.");
    expect(otherLine.text).toBe("Caron n'a pas pu payer 2,4 écus de gages.");
  });
});

describe('format helpers', () => {
  it('pluralises goods only above one unit', () => {
    expect(goodQuantity(0, 'grain')).toBe('0 blé');
    expect(goodQuantity(1, 'wool')).toBe('1 laine');
    expect(goodQuantity(3, 'cloth')).toBe('3 draps');
  });

  it('names seats and refusals in French', () => {
    expect(seatName('echevin-north')).toBe('échevinage nord');
    expect(refusalText('insufficient_favour')).toBe('faveur insuffisante');
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
    expect(countdownText(new Date(start + 90_000).toISOString(), start)).toBe('tick 1:30');
  });

  it('switches to hours and minutes above an hour', () => {
    expect(countdownText(new Date(start + 2 * 3_600_000 + 5 * 60_000).toISOString(), start)).toBe('tick 2 h 05');
  });

  it('does not go negative', () => {
    expect(countdownText(new Date(start - 1_000).toISOString(), start)).toBe('à l’instant');
  });
});
