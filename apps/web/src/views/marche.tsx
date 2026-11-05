import { GOODS, type GoodId } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import type { TradeIntent, WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName } from '../format.ts';
import { Seal, WorkshopThumb } from '../icons.tsx';

const QUANTITIES = [1, 5, 10, 25] as const;

interface MarcheProps {
  data: WorldResponse;
  trading: TradeIntent | null;
  onTrade(kind: 'buy' | 'sell', good: GoodId, units: number): void;
}

/**
 * The Marché screen: six prices, the house's stock, and the two market
 * gestures — buy the chosen quantity, or sell the whole stock of a good.
 */
export function Marche({ data, trading, onTrade }: MarcheProps) {
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
        <section class="sec" aria-labelledby="market-title">
          <div class="h">
            <b id="market-title">Les six denrées</b>
            <span>prix de la semaine</span>
          </div>
          <div class="mquantity">
            <span>Quantité d'achat</span>
            <div class="segmented" role="group" aria-label="Quantité d'achat">
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
          <div class="card">
            {GOODS.map((good) => {
              const units = house.stock[good] ?? 0;

              return (
                <div class="row" key={good}>
                  <div class="th">
                    <WorkshopThumb good={good} />
                  </div>
                  <div class="nm">
                    <b>{goodName(good)}</b>
                    <p>{formatCents(world.town.market[good])} écus l'unité</p>
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
                      onClick={() => onTrade('sell', good, units)}
                    >
                      Tout vendre
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p class="note">
            Le marché achète et vend au prix de la semaine. Le prix de la semaine prochaine suit ce que la ville a vendu
            et acheté. L'entrepôt ne se vide pas tout seul : vendez avant qu'il ne soit plein.
          </p>
        </section>
      </div>
    </main>
  );
}
