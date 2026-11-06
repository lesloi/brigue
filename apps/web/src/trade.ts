import { TRADE_CHAINS, TRADES, type GoodId } from '@brigue/core/world';

import type { PendingActionView } from './api.ts';

/** The three inputs first, then the three finished goods, in chain order. */
export const RAW_GOODS: readonly GoodId[] = TRADES.map((trade) => TRADE_CHAINS[trade].input);
export const FINISHED_GOODS: readonly GoodId[] = TRADES.map((trade) => TRADE_CHAINS[trade].output);

/** The net signed units queued for a good; campaign actions never count. */
export function netPendingFor(good: GoodId, pending: readonly PendingActionView[]): number {
  let total = 0;
  for (const action of pending) {
    if (action.good !== good) {
      continue;
    }
    if (action.type === 'market.buy') {
      total += action.units ?? 0;
    }
    if (action.type === 'market.sell') {
      total -= action.units ?? 0;
    }
  }

  return total;
}

/** The net cash the queued market actions will move at the town's prices. */
export function pendingCashCents(pending: readonly PendingActionView[], prices: Record<GoodId, number>): number {
  let total = 0;
  for (const action of pending) {
    if (action.good === undefined || action.units === undefined) {
      continue;
    }
    const value = action.units * prices[action.good];
    if (action.type === 'market.buy') {
      total -= value;
    }
    if (action.type === 'market.sell') {
      total += value;
    }
  }

  return total;
}

/** The net units every queued market action adds or removes, all goods together. */
export function pendingUnits(pending: readonly PendingActionView[]): number {
  let total = 0;
  for (const action of pending) {
    if (action.units === undefined) {
      continue;
    }
    if (action.type === 'market.buy') {
      total += action.units;
    }
    if (action.type === 'market.sell') {
      total -= action.units;
    }
  }

  return total;
}

export interface BuyMaxInput {
  treasuryCents: number;
  pendingCashCents: number;
  stockUnits: number;
  pendingUnits: number;
  capacityUnits: number;
  priceCents: number;
}

/**
 * A price is "cheap" or "dear" only outside the band around the reference the
 * town pulls it back to; inside, it is simply the price. Integer arithmetic on
 * cents keeps the band's edges exact.
 */
export type PriceSignal = 'cheap' | 'normal' | 'dear';

export const PRICE_SIGNAL_PERCENT = 10;

export function priceSignal(priceCents: number, referenceCents: number): PriceSignal {
  if (referenceCents <= 0) {
    return 'normal';
  }
  if (priceCents * 100 <= referenceCents * (100 - PRICE_SIGNAL_PERCENT)) {
    return 'cheap';
  }
  if (priceCents * 100 >= referenceCents * (100 + PRICE_SIGNAL_PERCENT)) {
    return 'dear';
  }

  return 'normal';
}

/** How many units a buy can add, after the queued cash and the warehouse cap. */
export function buyMax(input: BuyMaxInput): number {
  const cashCents = Math.max(0, input.treasuryCents + input.pendingCashCents);
  const room = Math.max(0, input.capacityUnits - input.stockUnits - input.pendingUnits);
  const affordable = Math.floor(cashCents / Math.max(1, input.priceCents));

  return Math.min(affordable, room);
}

/** How many units can still be sold, including what a queued buy will bring. */
export function sellMax(stock: number, pendingForGood: number): number {
  return Math.max(0, stock + pendingForGood);
}
