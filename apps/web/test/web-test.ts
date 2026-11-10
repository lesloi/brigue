import type { Event, PersonId } from '@brigue/core';
import { GOODS } from '@brigue/core/world';
import { describe, expect, it } from 'vitest';

import type { PendingActionView } from '../src/api.ts';
import { eventLine } from '../src/events.ts';
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
  readErrorText,
  refusalText,
  seatName,
  tradeChainText,
  tradeName,
} from '../src/format.ts';
import { navigationFor, stateOf, tabFromHash } from '../src/tabs.ts';
import { catchUpText } from '../src/views/greffe.tsx';
import { countdownText } from '../src/views/ville.tsx';

const NAMES: Record<PersonId, string> = {
  4: 'Leclerc',
  1: 'Caron',
  9: 'de Herse',
};

const nameOf = (personId: PersonId): string => NAMES[personId] ?? 'une personne inconnue';

describe('refusalText', () => {
  it('speaks of dynasties, not of dynasties', () => {
    // Arrange
    const refusals = ['unknown_person', 'dormant_person'] as const;

    // Act
    const said = refusals.map((reason) => refusalText(reason));

    // Assert
    expect(said).toEqual(['personne inconnue', 'personne dormante']);
  });

  it('names the account when its deletion is due, and the dynasty when it is gone', () => {
    // Arrange
    const action = ['deletion_pending', 'person_lost', 'no_free_person'] as const;
    const read = ['person_lost'] as const;

    // Act
    const said = action.map((code) => actionErrorText(code));
    const readSaid = read.map((code) => readErrorText(code));

    // Assert
    expect(said).toEqual([
      'Ce compte est en cours de suppression.',
      "Ta dynastie n'existe plus : choisis un métier pour revenir.",
      "Cette ville n'a plus de dynastie libre.",
    ]);
    expect(readSaid).toEqual(["Ta dynastie n'existe plus : choisis un métier pour revenir."]);
  });
});

describe('eventLine', () => {
  it('says "Vous" for the player and pluralises the goods', () => {
    // Arrange
    const event: Event = {
      type: 'market.bought',
      audience: 'town',

      at: 0,
      personId: 4,
      good: 'wool',
      units: 10,
      priceCents: 380,
      totalCents: 3800,
    };

    // Act
    const line = eventLine(event, 4, nameOf);

    // Assert
    expect(line.tone).toBe('loss');
    expect(line.text).toContain('Vous avez acheté 10 laines');
    expect(line.text).toContain('soit 38 écus');
  });

  it('names another dynasty and keeps the singular for one unit', () => {
    // Arrange
    const event: Event = {
      type: 'market.bought',
      audience: 'town',

      at: 0,
      personId: 1,
      good: 'wool',
      units: 1,
      priceCents: 380,
      totalCents: 380,
    };

    // Act
    const line = eventLine(event, 4, nameOf);

    // Assert
    expect(line.text).toContain('Caron a acheté 1 laine');
  });

  it('announces a vacant seat and a private election result', () => {
    // Arrange
    const vacant: Event = {
      type: 'council.election_held',
      audience: 'town',
      at: 0,
      seatId: 'maire',
      winnerPersonId: null,
      votes: {},
    };
    const won: Event = {
      type: 'council.election_result',
      audience: { personId: 4 },
      at: 0,
      personId: 4,
      seatId: 'maire',
      won: true,
      winnerPersonId: 4,
      votes: { 4: 4, 1: 2 },
    };
    const lost: Event = { ...won, won: false, winnerPersonId: 1 };

    // Act
    const vacantLine = eventLine(vacant, 4, nameOf);
    const wonLine = eventLine(won, 4, nameOf);
    const lostLine = eventLine(lost, 4, nameOf);

    // Assert
    expect(vacantLine.text).toContain('reste vacante');
    expect(wonLine.text).toContain('Vous êtes élu à la mairie');
    expect(lostLine.text).toContain('Vous avez perdu la mairie');
    expect(lostLine.text).toContain('Caron');
  });

  it('reads a refusal as a refusal, not as money moving', () => {
    // Arrange
    const event: Event = {
      type: 'action.refused',
      audience: { personId: 4 },

      at: 0,
      action: 'market.buy',
      personId: 4,
      reason: 'insufficient_funds',
    };

    // Act
    const line = eventLine(event, 4, nameOf);

    // Assert
    expect(line.tone).toBe('refusal');
    expect(line.text).toBe('Vous : achat refusé — fonds insuffisants.');
  });

  it('keeps the dynasty grammar for a missed upkeep payment', () => {
    // Arrange
    const own: Event = {
      type: 'person.penniless',
      audience: { personId: 4 },

      at: 0,
      personId: 4,
      shortfallCents: 240,
    };
    const other: Event = {
      type: 'person.penniless',
      audience: { personId: 1 },

      at: 0,
      personId: 1,
      shortfallCents: 240,
    };

    // Act
    const ownLine = eventLine(own, 4, nameOf);
    const otherLine = eventLine(other, 4, nameOf);

    // Assert
    expect(ownLine.text).toBe("Vous n'avez pas pu payer 2,4 écus d'entretien.");
    expect(otherLine.text).toBe("Caron n'a pas pu payer 2,4 écus d'entretien.");
  });

  it('reads production as goods entering the warehouse', () => {
    // Arrange
    const event: Event = {
      type: 'workshop.produced',
      audience: { personId: 4 },

      at: 0,
      personId: 4,
      good: 'cloth',
      units: 4,
    };

    // Act
    const line = eventLine(event, 4, nameOf);

    // Assert
    expect(line.tone).toBe('gain');
    expect(line.text).toBe('Vous avez produit 4 draps.');
  });

  it('says when the scrutiny that counts a candidacy is held', () => {
    // Arrange: a candidacy carries the scrutiny it counts at, not a duration.
    const event: Event = {
      type: 'council.campaigned',
      audience: { personId: 4 },
      at: 12,
      personId: 4,
      seatId: 'maire',
      favourSpent: 3,
      countsAt: 48,
    };

    // Act
    const line = eventLine(event, 4, nameOf);

    // Assert: the screen does not claim the coming scrutiny when the noon bell
    // has already closed this year's.
    expect(line.tone).toBe('council');
    expect(line.text).toContain('candidature à la mairie');
    expect(line.text).toContain("à l'heure 48");
  });

  it('counts a late engagement in hours', () => {
    // Arrange: heard three hours after it fell due.
    const event: Event = {
      type: 'engagement.resolved',
      audience: { personId: 4 },
      at: 8,
      engagementId: 1,
      kind: 'hearing',
      personId: 4,
      dueAt: 5,
      resolvedAt: 8,
    };

    // Act
    const line = eventLine(event, 4, nameOf);

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
    expect(refusalText('already_candidate')).toBe('vous avez déjà une candidature en cours');
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

describe('catchUpText', () => {
  it('agrees with a single hour', () => {
    expect(catchUpText({ hours: 1 })).toBe('1 heure vécue depuis votre dernière visite.');
  });

  it('pluralises above one', () => {
    expect(catchUpText({ hours: 2 })).toBe('2 heures vécues depuis votre dernière visite.');
  });

  it('says nothing when the visit owes nothing', () => {
    expect(catchUpText({ hours: 0 })).toBeNull();
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
    expect(tabFromHash('#maison')).toBe('maison');
    expect(tabFromHash('#courrier')).toBe('courrier');
    expect(tabFromHash('#greffe')).toBe('greffe');
    expect(tabFromHash('#conseil')).toBe('ville');
    expect(tabFromHash('')).toBe('ville');
    expect(stateOf(null)).toBeNull();
    expect(stateOf({ tab: 'marche', pushed: true })).toEqual({ tab: 'marche', pushed: true });
  });
});

describe('pending actions', () => {
  const pending: PendingActionView[] = [
    { id: 1, hour: 3, type: 'market.buy', good: 'grain', units: 5 },
    { id: 2, hour: 3, type: 'market.buy', good: 'grain', units: 10 },
    { id: 3, hour: 3, type: 'market.sell', good: 'grain', units: 4 },
    { id: 4, hour: 3, type: 'market.buy', good: 'wool', units: 2 },
    { id: 5, hour: 3, type: 'council.campaign', seatId: 'maire' },
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

  it("values the queued actions at the town's prices", () => {
    // Arrange
    const prices = { wool: 380, cloth: 1240, grain: 260, bread: 520, wood: 300, planks: 980 };
    const queued: PendingActionView[] = [
      { id: 1, hour: 3, type: 'market.buy', good: 'grain', units: 5 },
      { id: 2, hour: 3, type: 'market.sell', good: 'bread', units: 3 },
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
