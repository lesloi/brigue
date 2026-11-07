import type { Action, Event, RefusalReason } from '@brigue/core';

import {
  formatCents,
  formatCount,
  goodName,
  goodQuantity,
  refusalText,
  seatName,
  titleName,
  tradeName,
} from './format.ts';

/** The three cuts of the journal: the house's own story, everything, the prices. */
export type LedgerFilter = 'house' | 'all' | 'prices';

/**
 * The default is the house's own story plus the town's politics; the AI's
 * market noise and the price lines stay behind the other cuts. `prices` is
 * where chapter I's lesson lives; `all` is the whole page.
 */
export function ledgerEvents(events: readonly Event[], houseId: string, filter: LedgerFilter): Event[] {
  switch (filter) {
    case 'all':
      return [...events];
    case 'prices':
      return events.filter((event) => event.type === 'market.price_changed');
    case 'house':
      return events.filter(
        (event) =>
          ('houseId' in event && event.houseId === houseId) ||
          event.type.startsWith('council.') ||
          event.type.startsWith('engagement.'),
      );
  }
}

export type Tone = 'gain' | 'loss' | 'warning' | 'refusal' | 'council' | 'neutral';

/** What one counted type is called in a tally, in both numbers. */
const COUNT_NAMES: Record<Event['type'], [string, string]> = {
  'action.refused': ['refus', 'refus'],
  'market.bought': ['achat', 'achats'],
  'market.sold': ['vente', 'ventes'],
  'market.price_changed': ['prix changé', 'prix changés'],
  'workshop.produced': ['production', 'productions'],
  'workshop.overflow': ['débordement', 'débordements'],
  'workshop.idle': ['atelier à l’arrêt', 'ateliers à l’arrêt'],
  'workshop.built': ['atelier construit', 'ateliers construits'],
  'workshop.destroyed': ['atelier détruit', 'ateliers détruits'],
  'workshop.upgraded': ['atelier agrandi', 'ateliers agrandis'],
  'workshop.build_lost': ['chantier perdu', 'chantiers perdus'],
  'house.title_bought': ['titre acheté', 'titres achetés'],
  'house.title_received': ['titre obtenu', 'titres obtenus'],
  'house.residence_received': ['résidence élevée', 'résidences élevées'],
  'house.renamed': ['maison renommée', 'maisons renommées'],
  'house.upkeep_paid': ['entretien payé', 'entretiens payés'],
  'house.penniless': ['entretien impayé', 'entretiens impayés'],
  'house.debt_repaid': ['remboursement', 'remboursements'],
  'council.campaigned': ['candidature', 'candidatures'],
  'engagement.opened': ['chantier ouvert', 'chantiers ouverts'],
  'engagement.resolved': ['engagement résolu', 'engagements résolus'],
  'council.scrutiny_held': ['scrutin', 'scrutins'],
  'council.election_held': ['élection', 'élections'],
};

/**
 * The entries a page left behind, said as a tally. A refusal is carried by the
 * refusal clause alone, so it is not listed twice.
 */
export function journalCountsText(
  counts: Partial<Record<Event['type'], number>>,
  refusals: Partial<Record<string, number>>,
): string | null {
  const parts: Array<{ count: number; text: string }> = [];

  for (const [type, raw] of Object.entries(counts)) {
    const count = raw ?? 0;
    if (count <= 0 || type === 'action.refused') {
      continue;
    }
    parts.push({ count, text: `${formatCount(count)} ${countName(type as Event['type'], count)}` });
  }

  let refused = 0;
  const reasons: Array<{ count: number; text: string }> = [];
  for (const [reason, raw] of Object.entries(refusals)) {
    const count = raw ?? 0;
    if (count <= 0) {
      continue;
    }
    refused += count;
    reasons.push({ count, text: `${formatCount(count)} ${refusalText(reason as RefusalReason)}` });
  }
  if (refused > 0) {
    const detail = reasons
      .sort((left, right) => right.count - left.count)
      .map((reason) => reason.text)
      .join(', ');
    parts.push({ count: refused, text: `${formatCount(refused)} refus (${detail})` });
  }

  if (parts.length === 0) {
    return null;
  }

  return parts
    .sort((left, right) => right.count - left.count)
    .map((part) => part.text)
    .join(', ');
}

function countName(type: Event['type'], count: number): string {
  const [one, many] = COUNT_NAMES[type];

  return count > 1 ? many : one;
}

export interface EventLine {
  tone: Tone;
  text: string;
}

/**
 * Turns one event into a sentence. It decides no rule: every number comes from
 * the event, never from the projection.
 */
export function eventLine(event: Event, ownHouseId: string, nameOf: (houseId: string) => string): EventLine {
  const own = (houseId: string) => houseId === ownHouseId;
  const subject = (houseId: string) => (own(houseId) ? 'Vous' : nameOf(houseId));
  const verb = (houseId: string, mine: string, theirs: string) => (own(houseId) ? mine : theirs);

  switch (event.type) {
    case 'action.refused':
      return {
        tone: 'refusal',
        text: `${subject(event.houseId)} : ${actionName(event.action)} refusé — ${refusalText(event.reason)}.`,
      };

    case 'market.bought':
      return {
        tone: 'loss',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez acheté', 'a acheté')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.totalCents)} écus.`,
      };

    case 'market.sold':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez vendu', 'a vendu')} ${goodQuantity(event.units, event.good)} à ${formatCents(event.priceCents)} écus, soit ${formatCents(event.revenueCents)} écus.`,
      };

    case 'market.price_changed':
      return {
        tone: event.after > event.before ? 'warning' : 'neutral',
        text: `${capitalize(goodName(event.good))} : ${formatCents(event.before)} → ${formatCents(event.after)} écus l'unité.`,
      };

    case 'workshop.produced':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez produit', 'a produit')} ${goodQuantity(event.units, event.good)}.`,
      };

    case 'workshop.overflow':
      return {
        tone: 'warning',
        text: `${subject(event.houseId)} : entrepôt plein, ${goodQuantity(event.refusedUnits, event.good)} en trop.`,
      };

    case 'workshop.idle':
      return {
        tone: 'warning',
        text: `${subject(event.houseId)} : atelier de ${goodName(event.good)} à l'arrêt, il manque ${goodQuantity(event.missingUnits, event.input)}.`,
      };

    case 'workshop.built':
      return {
        tone: 'gain',
        text: `L'atelier de ${tradeName(event.trade)} de ${subject(event.houseId)} est bâti.`,
      };

    case 'workshop.destroyed':
      return {
        tone: 'loss',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez fait abattre', 'a fait abattre')} un atelier de ${goodName(event.good)}.`,
      };

    case 'workshop.upgraded':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} : un atelier passe au niveau ${formatCount(event.level)}.`,
      };

    case 'workshop.build_lost':
      return {
        tone: 'refusal',
        text: `Le chantier de ${tradeName(event.trade)} de ${subject(event.houseId)} échoue : ${formatCents(event.paidCents)} écus perdus.`,
      };

    case 'house.title_bought':
      return {
        tone: 'council',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez acheté', 'a acheté')} le titre de ${titleName(event.title)} ; il ${verb(event.houseId, 'vous sera remis', 'sera remis')} au prochain midi ou minuit.`,
      };

    case 'house.title_received':
      return {
        tone: 'council',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'êtes', 'est')} désormais ${titleName(event.title)}.`,
      };

    case 'house.residence_received':
      return {
        tone: 'gain',
        text: `${subject(event.houseId)} : la résidence atteint le niveau ${formatCount(event.level)}.`,
      };

    case 'house.renamed':
      return {
        tone: 'council',
        text: `La maison ${event.before} prend le nom de ${event.after}.`,
      };

    case 'house.upkeep_paid':
      return {
        tone: 'loss',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez payé', 'a payé')} ${formatCents(event.amountCents)} écus d'entretien.`,
      };

    case 'house.penniless':
      return {
        tone: 'refusal',
        text: `${subject(event.houseId)} n'${verb(event.houseId, 'avez', 'a')} pas pu payer ${formatCents(event.shortfallCents)} écus d'entretien.`,
      };

    case 'house.debt_repaid':
      return {
        tone: 'neutral',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez remboursé', 'a remboursé')} ${formatCents(event.amountCents)} écus de dette.`,
      };

    case 'council.campaigned':
      return {
        tone: 'council',
        text: `${subject(event.houseId)} ${verb(event.houseId, 'avez déposé', 'a déposé')} une candidature à la ${seatName(event.seatId)} avec ${formatCount(event.favourSpent)} de faveur ; le scrutin qui la compte est dans ${formatCount(event.countsAt - event.at)} heures.`,
      };

    case 'engagement.resolved': {
      const late =
        event.resolvedAt === event.dueAt
          ? ''
          : ` (${formatCount(event.resolvedAt - event.dueAt)} heure${event.resolvedAt - event.dueAt > 1 ? 's' : ''} de retard)`;

      if (event.kind === 'hearing') {
        return {
          tone: 'council',
          text: `L'audience de ${subject(event.houseId)} est tenue${late}.`,
        };
      }

      return {
        tone: 'neutral',
        text: `Le chantier de ${subject(event.houseId)} est achevé${late}.`,
      };
    }

    case 'engagement.opened':
      return {
        tone: 'neutral',
        text:
          event.kind === 'hearing'
            ? `L'audience de ${subject(event.houseId)} est fixée à l'heure ${formatCount(event.dueAt)}.`
            : `${subject(event.houseId)} : un chantier est ouvert, il sera clos à l'heure ${formatCount(event.dueAt)}.`,
      };

    case 'council.scrutiny_held':
      return {
        tone: 'council',
        text: `Scrutin de l'an ${event.year} : les ${formatCount(event.seats.length)} charges sont remises en jeu.`,
      };

    case 'council.election_held': {
      const votes = Object.entries(event.votes)
        .map(([houseId, count]) => `${nameOf(houseId)} ${formatCount(count)}`)
        .join(', ');
      return {
        tone: 'council',
        text: `Élection : la ${seatName(event.seatId)} revient à ${nameOf(event.winnerHouseId)}. Voix : ${votes}.`,
      };
    }
  }
}

function actionName(action: Action['type'] | 'unknown'): string {
  switch (action) {
    case 'market.buy':
      return 'achat';
    case 'market.sell':
      return 'vente';
    case 'council.campaign':
      return 'candidature';
    case 'workshop.build':
      return 'construction';
    case 'workshop.destroy':
      return 'démolition';
    case 'workshop.upgrade':
      return 'agrandissement';
    case 'house.buy_title':
      return 'achat de titre';
    case 'house.upgrade_residence':
      return 'élévation de la résidence';
    case 'house.rename':
      return 'renommage';
    case 'unknown':
      return 'action';
    default:
      return 'action';
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
