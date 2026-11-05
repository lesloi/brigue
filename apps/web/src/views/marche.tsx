import { GOODS, type GoodId } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import type { PendingActionView, TradeIntent, WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName, pendingActionText } from '../format.ts';
import { Seal, WorkshopThumb } from '../icons.tsx';

const QUANTITIES = [1, 5, 10, 25] as const;

interface MarcheProps {
  data: WorldResponse;
  trading: TradeIntent | null;
  pending: PendingActionView[];
  cancelling: string | null;
  onTrade(kind: 'buy' | 'sell', good: GoodId, units: number): void;
  onCancel(id: string): void;
}

/**
 * The Marché screen: the queued actions, six prices, the house's stock, and
 * the two market gestures — buy or sell the chosen quantity.
 */
export function Marche({ data, trading, pending, cancelling, onTrade, onCancel }: MarcheProps) {
  const { world } = data;
  const house = world.house;
  // Per visit: switching tabs resets it to ten, the short-visit default.
  const [quantity, setQuantity] = useState(10);

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
            <span>prix de la semaine</span>
          </div>
          <div class="mquantity">
            <span>Quantité</span>
            <div class="quantity-controls">
              <input
                class="qty-input"
                type="number"
                min="1"
                step="1"
                value={quantity}
                aria-label="Quantité"
                onInput={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (Number.isInteger(value) && value > 0) {
                    setQuantity(value);
                  }
                }}
              />
              <div class="segmented" role="group" aria-label="Quantités rapides">
                {QUANTITIES.map((value) => (
                  <button
                    type="button"
                    class={value === quantity ? 'on' : ''}
                    aria-pressed={value === quantity}
                    onClick={() => setQuantity(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div class="card">
            {GOODS.map((good) => {
              const units = house.stock[good] ?? 0;
              const sellUnits = Math.min(quantity, units);

              return (
                <div class="row" key={good}>
                  <div class="th">
                    <WorkshopThumb good={good} />
                  </div>
                  <div class="nm">
                    <b>{goodName(good)}</b>
                    <p>{formatCents(world.town.market[good])} écus l'unité</p>
                    <PriceSparkline
                      values={world.town.marketHistory[good] ?? []}
                      referenceCents={world.town.marketReferences[good]}
                    />
                  </div>
                  <div class="act">
                    <span class="price">
                      <b>{formatCount(units)}</b> en stock
                    </span>
                    <button
                      class="btn outline"
                      type="button"
                      disabled={trading !== null}
                      onClick={() => onTrade('buy', good, quantity)}
                    >
                      Acheter {quantity}
                    </button>
                    <button
                      class="btn"
                      type="button"
                      disabled={trading !== null || units === 0}
                      onClick={() => onTrade('sell', good, sellUnits)}
                    >
                      Vendre {sellUnits}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p class="note">
            Le marché achète et vend au prix de la semaine. La courbe suit les dernières semaines ; le trait doré est le
            prix de référence. L'entrepôt ne se vide pas tout seul : vendez avant qu'il ne soit plein.
          </p>
        </section>
      </div>
    </main>
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
