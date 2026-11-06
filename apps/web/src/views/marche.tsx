import type { GoodId } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import type { PendingActionView, TradeIntent, WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName, pendingActionText, pendingHourText } from '../format.ts';
import {
  buyMax,
  FINISHED_GOODS,
  netPendingFor,
  pendingCashCents,
  pendingUnits,
  priceSignal,
  RAW_GOODS,
  sellMax,
} from '../trade.ts';
import { ResourceIcon, Seal, WorkshopThumb } from '../icons.tsx';

interface MarcheProps {
  data: WorldResponse;
  trading: TradeIntent | null;
  pending: PendingActionView[];
  cancelling: string | null;
  onTrade(kind: 'buy' | 'sell', good: GoodId, units: number): void;
  onCancel(id: string): void;
}

/**
 * The Marché screen: the queued actions, six prices, and a row that opens its
 * own buy/sell panel. The panel's Max uses the projected stock, the purse and
 * the already queued trades, not a fresh server call.
 */
export function Marche({ data, trading, pending, cancelling, onTrade, onCancel }: MarcheProps) {
  const { world } = data;
  const house = world.house;
  const [open, setOpen] = useState<GoodId | null>(null);

  // Only this hour's queued trades change what this hour's action can do.
  const currentPending = pending.filter((action) => action.hour === world.hour);
  const queuedCashCents = pendingCashCents(currentPending, world.town.market);
  const queuedUnits = pendingUnits(currentPending);

  const renderGood = (good: GoodId) => {
    const priceCents = world.town.market[good];
    const stock = house.stock[good] ?? 0;
    // The Max accounts for the queued trades: a sell can use what a pending
    // buy will bring, a buy cannot spend the same coin twice.
    const buyLimit = buyMax({
      treasuryCents: house.treasuryCents,
      pendingCashCents: queuedCashCents,
      stockUnits: house.stockUnits,
      pendingUnits: queuedUnits,
      capacityUnits: house.stockCapacityUnits,
      priceCents,
    });
    const sellLimit = sellMax(stock, netPendingFor(good, currentPending));
    const isOpen = open === good;
    const signal = priceSignal(priceCents, world.town.marketReferences[good]);

    return (
      <div key={good}>
        <div
          class="row market-row"
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          aria-controls={`market-${good}`}
          onClick={() => setOpen(isOpen ? null : good)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(isOpen ? null : good);
            }
          }}
        >
          <div class="th">
            <WorkshopThumb good={good} />
          </div>
          <div class="nm">
            <b>{goodName(good)}</b>
            <p>
              {formatCents(priceCents)} écus l'unité{' '}
              {signal === 'normal' ? null : (
                <span class={signal === 'cheap' ? 'chip cheap' : 'chip dear'}>
                  {signal === 'cheap' ? 'bon marché' : 'cher'}
                </span>
              )}
            </p>
          </div>
          <div class="act">
            <span class="price">
              <b>{formatCount(stock)}</b> en stock
            </span>
            <span class={isOpen ? 'chev on' : 'chev'} aria-hidden="true">
              ›
            </span>
          </div>
        </div>
        {isOpen ? (
          <TradePanel
            key={good}
            good={good}
            priceCents={priceCents}
            buyMax={buyLimit}
            sellMax={sellLimit}
            busy={trading !== null}
            onTrade={(kind, units) => onTrade(kind, good, units)}
          />
        ) : null}
      </div>
    );
  };

  return (
    <main class="screen">
      <header class="mhead">
        <Seal />
        <div>
          <div class="eyebrow">
            {world.town.name} &middot; an {world.year}
          </div>
          <h1>Le marché</h1>
        </div>
        <div class="wk">
          h. {world.calendar.hourOfYear}/{world.calendar.hoursPerYear}
        </div>
      </header>

      <section class="mstats" aria-label="Ta maison">
        <div>
          <ResourceIcon kind="coins" />
          <span class="v">{formatCents(house.treasuryCents)}</span>
          <span class="l">écus</span>
        </div>
        <div>
          <ResourceIcon kind="warehouse" />
          <span class="v">
            {formatCount(house.stockUnits)} / {formatCount(house.stockCapacityUnits)}
          </span>
          <span class="l">entrepôt</span>
        </div>
      </section>

      <div class="body">
        {pending.length > 0 ? (
          <section class="sec" aria-labelledby="pending-title">
            <div class="h">
              <b id="pending-title">En attente</b>
              <span>
                {pending.length} action{pending.length > 1 ? 's' : ''}
              </span>
            </div>
            <div class="card">
              {pending.map((action) => (
                <div class="wait" key={action.id}>
                  <div class="nm">
                    <b>{pendingActionText(action)}</b>
                    <p>{pendingHourText(action, world.hour)}</p>
                  </div>
                  <button
                    class="btn outline"
                    type="button"
                    disabled={cancelling === action.id}
                    onClick={() => onCancel(action.id)}
                  >
                    Annuler
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section class="sec" aria-label="Les denrées">
          <p class="note">
            Le marché achète et vend au prix courant, réglé aux deux cloches. La pastille signale une denrée nettement
            plus chère ou moins chère que son prix de référence. Touche une denrée pour ouvrir sa fiche.
          </p>
          <div class="market-group">
            <div class="h">
              <b>Matières premières</b>
            </div>
            <div class="card">{RAW_GOODS.map(renderGood)}</div>
          </div>
          <div class="market-group">
            <div class="h">
              <b>Produits finis</b>
            </div>
            <div class="card">{FINISHED_GOODS.map(renderGood)}</div>
          </div>
        </section>
      </div>
    </main>
  );
}

interface TradePanelProps {
  good: GoodId;
  priceCents: number;
  buyMax: number;
  sellMax: number;
  busy: boolean;
  onTrade(kind: 'buy' | 'sell', units: number): void;
}

/** The row's own buy/sell panel: mode, quantity with a Max, cost, one action. */
function TradePanel({ good, priceCents, buyMax, sellMax, busy, onTrade }: TradePanelProps) {
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState(() => Math.min(10, buyMax));
  // What the field shows while it has the focus: typing "1" then "0" must not be
  // rewritten under the cursor, and an empty field is not a zero yet.
  const [draft, setDraft] = useState<string | null>(null);
  const max = mode === 'buy' ? buyMax : sellMax;
  const units = Math.min(quantity, max);
  const setUnits = (next: number) => {
    setDraft(null);
    setQuantity(Math.max(0, Math.min(max, next)));
  };
  const typeUnits = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits === '') {
      setDraft('');
      setQuantity(0);

      return;
    }
    const next = Math.min(max, Number(digits));
    setDraft(String(next));
    setQuantity(next);
  };
  const field = `quantity-${good}`;
  const switchMode = (next: 'buy' | 'sell') => {
    const nextMax = next === 'buy' ? buyMax : sellMax;
    // Opening on an empty side (no room to buy, stock to sell) should not make
    // the other side start at zero; seed it with a usable quantity.
    if (Math.min(quantity, nextMax) === 0 && nextMax > 0) {
      setQuantity(Math.min(10, nextMax));
    }
    setDraft(null);
    setMode(next);
  };

  return (
    <div class="trade-panel" id={`market-${good}`}>
      <div class="segmented" role="group" aria-label="Acheter ou vendre">
        <button
          type="button"
          class={mode === 'buy' ? 'on' : ''}
          aria-pressed={mode === 'buy'}
          onClick={() => switchMode('buy')}
        >
          Acheter
        </button>
        <button
          type="button"
          class={mode === 'sell' ? 'on' : ''}
          aria-pressed={mode === 'sell'}
          onClick={() => switchMode('sell')}
        >
          Vendre
        </button>
      </div>
      <div class="qtyline">
        <label class="qty-label" for={field}>
          Quantité
        </label>
        <div class="stepper">
          <button type="button" disabled={units <= 0} onClick={() => setUnits(units - 1)}>
            −
          </button>
          <input
            id={field}
            class="qty-field"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            aria-label="Quantité"
            value={draft ?? String(units)}
            onInput={(event) => typeUnits(event.currentTarget.value)}
            onBlur={() => setDraft(null)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
          />
          <button type="button" disabled={units >= max} onClick={() => setUnits(units + 1)}>
            +
          </button>
        </div>
        <button class="max" type="button" disabled={max === 0} onClick={() => setUnits(max)}>
          Max {max}
        </button>
      </div>
      <p class="cost">
        {units} &times; {formatCents(priceCents)} = {formatCents(units * priceCents)} écus
      </p>
      <button class="btn wide" type="button" disabled={busy || units === 0} onClick={() => onTrade(mode, units)}>
        {mode === 'buy' ? 'Acheter' : 'Vendre'} {units}
      </button>
    </div>
  );
}
