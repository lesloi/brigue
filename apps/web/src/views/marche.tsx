import { GOODS, type GoodId } from '@brigue/core/world';

import type { WorldResponse } from '../api.ts';
import { formatCents, formatCount, goodName } from '../format.ts';
import { Seal, WorkshopThumb } from '../icons.tsx';

interface MarcheProps {
  data: WorldResponse;
  selling: GoodId | null;
  onSell(good: GoodId, units: number): void;
}

/**
 * The Marché screen: six prices, the house's stock, and the one action the
 * market offers today — sell the whole stock of a good at the week's price.
 */
export function Marche({ data, selling, onSell }: MarcheProps) {
  const { world } = data;
  const house = world.house;

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
                      disabled={units === 0 || selling !== null}
                      onClick={() => onSell(good, units)}
                    >
                      Tout vendre
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p class="note">
            Le prix de la semaine prochaine suit ce que la ville a vendu et acheté cette semaine. L'entrepôt ne se vide
            pas tout seul : vendez avant qu'il ne soit plein.
          </p>
        </section>
      </div>
    </main>
  );
}
