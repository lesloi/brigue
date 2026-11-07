import type { CommittedCents, PendingActionView } from './api.ts';

/**
 * What the queued actions will take from the purse. The market and the
 * campaigns are left out: their price is settled by the hour they play, so the
 * screen cannot promise a figure for them.
 */
export function committedCents(actions: readonly PendingActionView[], prices: CommittedCents): number {
  let total = 0;

  for (const action of actions) {
    if (action.type === 'dynasty.buy_title') {
      total += prices.titleCents;
    } else if (action.type === 'dynasty.upgrade_residence') {
      total += prices.residenceCents;
    } else if (action.type === 'workshop.build') {
      total += prices.buildCents;
    }
  }

  return total;
}
