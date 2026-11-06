import type { Event } from '@brigue/core';
import { GOODS } from '@brigue/core/world';
import { describe, expect, it } from 'vitest';

import type { PendingActionView } from '../src/api.ts';
import { eventLine, ledgerEvents } from '../src/events.ts';
import {
  buyMax,
  FINISHED_GOODS,
  netPendingFor,
  pendingCashCents,
  pendingUnits,
  priceSignal,
  RAW_GOODS,
  sellMax,
} from '../src/trade.ts';
import {
  actionErrorText,
  goodName,
  goodQuantity,
  pendingActionText,
  pendingHourText,
  readErrorText,
  refusalText,
  seatName,
  tradeChainText,
  tradeName,
} from '../src/format.ts';
import { navigationFor, stateOf, tabFromHash } from '../src/tabs.ts';
import { catchUpText, countdownText, lawAgeText, scrutinyText } from '../src/views/ville.tsx';

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

      at: 0,
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

      at: 0,
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

      at: 0,
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

      at: 0,
      houseId: 'brigue',
      shortfallCents: 240,
    };
    const other: Event = {
      type: 'house.penniless',
      audience: { houseId: 'caron' },

      at: 0,
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

      at: 0,
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

      at: 0,
      houseId: 'brigue',
      good: 'wool',
      refusedUnits: 3,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.text).toBe('Vous : entrepôt plein, 3 laines en trop.');
  });

  it('reads a candidacy as counting at the next scrutiny', () => {
    // Arrange: a candidacy carries the scrutiny it counts at, not a duration.
    const event: Event = {
      type: 'council.campaigned',
      audience: { houseId: 'brigue' },
      at: 0,
      houseId: 'brigue',
      seatId: 'maire',
      favourSpent: 3,
      countsAt: 24,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.tone).toBe('council');
    expect(line.text).toContain('candidature à la mairie');
    expect(line.text).toContain('prochain scrutin');
  });

  it('counts a late engagement in hours', () => {
    // Arrange: heard three hours after it fell due.
    const event: Event = {
      type: 'engagement.resolved',
      audience: { houseId: 'brigue' },
      at: 8,
      engagementId: 'e1',
      kind: 'hearing',
      houseId: 'brigue',
      dueAt: 5,
      resolvedAt: 8,
    };

    // Act
    const line = eventLine(event, 'brigue', nameOf);

    // Assert
    expect(line.text).toContain("L'audience de Vous est tenue");
    expect(line.text).toContain('3 heures de retard');
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
    expect(tradeChainText('baker')).toBe('cuit le blé pour faire du pain');
    expect(tradeChainText('weaver')).toBe('tisse la laine pour faire des draps');
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
    expect(actionErrorText('stale_hour')).toContain('déjà passée');
    expect(actionErrorText(null)).toBe("L'action n'a pas pu être envoyée.");
    expect(readErrorText('world_version')).toContain('plus compatible');
    expect(readErrorText(null)).toBe("La ville n'a pas pu être relue.");
  });
});

describe('countdownText', () => {
  const start = Date.parse('2026-01-01T00:00:00.000Z');

  it('shows minutes and seconds under an hour', () => {
    expect(countdownText(new Date(start + 90_000).toISOString(), start)).toBe('cloche dans 1:30');
  });

  it('switches to hours and minutes above an hour', () => {
    expect(countdownText(new Date(start + 2 * 3_600_000 + 5 * 60_000).toISOString(), start)).toBe('cloche dans 2 h 05');
  });

  it('does not go negative', () => {
    expect(countdownText(new Date(start - 1_000).toISOString(), start)).toBe('cloche imminente');
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

describe('lawAgeText', () => {
  it('says a law in hours from the town clock', () => {
    expect(lawAgeText(12, 12)).toBe('cette heure');
    expect(lawAgeText(12, 13)).toBe('il y a 1 heure');
    expect(lawAgeText(9, 12)).toBe('il y a 3 heures');
  });
});

describe('catchUpText', () => {
  const nothing = { counts: {}, refusals: {} };

  it('agrees with a single hour', () => {
    expect(catchUpText({ hours: 1, skipped: 0, ...nothing })).toBe('1 heure vécue depuis votre dernière visite.');
    expect(catchUpText({ hours: 1, skipped: 1, ...nothing })).toContain('1 heure sautée');
  });

  it('pluralises above one', () => {
    expect(catchUpText({ hours: 2, skipped: 0, ...nothing })).toBe('2 heures vécues depuis votre dernière visite.');
    expect(catchUpText({ hours: 0, skipped: 2, ...nothing })).toContain('2 heures sautées');
  });

  it('counts what the page left behind, refusals by reason', () => {
    // Act
    const text = catchUpText({
      hours: 30,
      skipped: 0,
      counts: { 'market.bought': 312, 'market.sold': 40, 'action.refused': 12 },
      refusals: { insufficient_funds: 5, stock_full: 7 },
    });

    // Assert: the refusal is not also listed as a type.
    expect(text).toContain('30 heures vécues');
    expect(text).toContain('312 achats');
    expect(text).toContain('40 ventes');
    expect(text).toContain('12 refus (7 entrepôt plein, 5 fonds insuffisants)');
    expect(text).not.toContain('12 refus,');
  });

  it('says nothing when the visit owes nothing', () => {
    expect(catchUpText({ hours: 0, skipped: 0, ...nothing })).toBeNull();
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

      at: 0,
      houseId: 'brigue',
      good: 'cloth',
      units: 2,
      priceCents: 1240,
      revenueCents: 2480,
    },
    {
      type: 'market.bought',
      audience: 'town',

      at: 0,
      houseId: 'caron',
      good: 'wool',
      units: 6,
      priceCents: 380,
      totalCents: 2280,
    },
    { type: 'council.election_held', audience: 'town', at: 0, seatId: 'maire', winnerHouseId: 'caron', votes: {} },
    { type: 'market.price_changed', audience: 'town', at: 0, good: 'cloth', before: 1240, after: 1250 },
    { type: 'house.wages_paid', audience: { houseId: 'brigue' }, at: 0, houseId: 'brigue', amountCents: 240 },
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
    { id: 'a', hour: 3, type: 'market.buy', good: 'grain', units: 5 },
    { id: 'b', hour: 3, type: 'market.buy', good: 'grain', units: 10 },
    { id: 'c', hour: 3, type: 'market.sell', good: 'grain', units: 4 },
    { id: 'd', hour: 3, type: 'market.buy', good: 'wool', units: 2 },
    { id: 'e', hour: 3, type: 'council.campaign', seatId: 'maire' },
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

  it('says where a queued action lands against the clock', () => {
    expect(pendingHourText(pending[0] as PendingActionView, 3)).toBe('cette heure');
    expect(pendingHourText({ ...pending[0], hour: 4 } as PendingActionView, 3)).toBe("l'heure suivante");
  });

  it("values the queued actions at the town's prices", () => {
    // Arrange
    const prices = { wool: 380, cloth: 1240, grain: 260, bread: 520, wood: 300, planks: 980 };
    const queued: PendingActionView[] = [
      { id: 'a', hour: 3, type: 'market.buy', good: 'grain', units: 5 },
      { id: 'b', hour: 3, type: 'market.sell', good: 'bread', units: 3 },
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

  it('calls a price dear or cheap only outside the band around its reference', () => {
    // Arrange: grain's reference is 260 cents, so the band runs from 234 to 286.
    // Act and assert: the edges belong to the signal, a cent inside does not.
    expect(priceSignal(234, 260)).toBe('cheap');
    expect(priceSignal(233, 260)).toBe('cheap');
    expect(priceSignal(235, 260)).toBe('normal');
    expect(priceSignal(260, 260)).toBe('normal');
    expect(priceSignal(285, 260)).toBe('normal');
    expect(priceSignal(286, 260)).toBe('dear');
    expect(priceSignal(287, 260)).toBe('dear');
    expect(priceSignal(300, 0)).toBe('normal');
  });

  it('splits every good into one raw or one finished block', () => {
    // Assert: the two Marché blocks cover the whole catalogue exactly once.
    expect(RAW_GOODS).toEqual(['wool', 'grain', 'wood']);
    expect(FINISHED_GOODS).toEqual(['cloth', 'bread', 'planks']);
    expect([...RAW_GOODS, ...FINISHED_GOODS].sort()).toEqual([...GOODS].sort());
  });
});
