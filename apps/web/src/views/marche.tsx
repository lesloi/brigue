import { GOODS, type GoodId } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import type { PendingActionView, TradeIntent, WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName, pendingActionText } from '../format.ts';
import { buyMax, netPendingFor, pendingCashCents, pendingUnits, sellMax } from '../trade.ts';
import { Seal, WorkshopThumb } from '../icons.tsx';

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

  // Only this week's queued trades change what this week's action can do.
  const currentPending = pending.filter((action) => action.week === world.week);
  const queuedCashCents = pendingCashCents(currentPending, world.town.market);
  const queuedUnits = pendingUnits(currentPending);

  return (
    <main class="screen">
      <header class="mhead">
        <Seal />
        <div>
          <div class="eyebrow">Saint-Aubin &middot; an {world.year}</div>
          <h1>Le marché</h1>
        </div>
        <div class="wk">
          sem. {world.calendar.weekOfYear}/{world.calendar.weeksPerYear}
        </div>
      </header>

      <section class="mstats" aria-label="Ta maison">
        <div>
          <span class="v">{formatCents(house.treasuryCents)}</span>
          <span class="l">écus</span>
        </div>
        <div>
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
                    <p>semaine {action.week}</p>
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

        <section class="sec" aria-labelledby="market-title">
          <div class="h">
            <b id="market-title">Les six denrées</b>
            <span>touche une denrée</span>
          </div>
          <div class="card">
            {GOODS.map((good) => {
              const priceCents = world.town.market[good];
              const stock = house.stock[good] ?? 0;
              // The Max accounts for the queued trades: a sell can use what a
              // pending buy will bring, a buy cannot spend the same coin twice.
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
                      <p>{formatCents(priceCents)} écus l'unité</p>
                      <PriceSparkline
                        values={world.town.marketHistory[good] ?? []}
                        referenceCents={world.town.marketReferences[good]}
                      />
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
            })}
          </div>
          <p class="note">
            Le marché achète et vend au prix de la semaine. La courbe suit les dernières semaines ; le trait doré est le
            prix de référence. Touche une denrée pour ouvrir sa fiche.
          </p>
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
  const max = mode === 'buy' ? buyMax : sellMax;
  const units = Math.min(quantity, max);
  const setUnits = (next: number) => setQuantity(Math.max(0, Math.min(max, next)));
  const switchMode = (next: 'buy' | 'sell') => {
    const nextMax = next === 'buy' ? buyMax : sellMax;
    // Opening on an empty side (no room to buy, stock to sell) should not make
    // the other side start at zero; seed it with a usable quantity.
    if (Math.min(quantity, nextMax) === 0 && nextMax > 0) {
      setQuantity(Math.min(10, nextMax));
    }
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
        <span class="qty-label">Quantité</span>
        <div class="stepper">
          <button type="button" disabled={units <= 0} onClick={() => setUnits(units - 1)}>
            −
          </button>
          <span>{units}</span>
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

/** The last year of a good's price, with the reference it is pulled back to. */
function PriceSparkline({ values, referenceCents }: { values: number[]; referenceCents: number }) {
  if (values.length < 2) {
    return null;
  }

  const width = 100;
  const height = 24;
  const min = Math.min(...values, referenceCents);
  const max = Math.max(...values, referenceCents);
  // A flat line sits in the middle of its box, not on the top edge.
  const low = min === max ? min - 1 : min;
  const high = min === max ? max + 1 : max;
  const span = high - low;
  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - 2 - ((value - low) / span) * (height - 4);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const referenceY = y(referenceCents).toFixed(1);

  return (
    <svg class="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line class="spark-ref" x1="0" x2={width} y1={referenceY} y2={referenceY} vector-effect="non-scaling-stroke" />
      <polyline class="spark-line" points={points} vector-effect="non-scaling-stroke" />
    </svg>
  );
}
