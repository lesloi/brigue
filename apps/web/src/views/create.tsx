import { TRADES, type Trade } from '@brigue/core/world';

import { tradeChainText, tradeName } from '../format.ts';
import { Seal } from '../icons.tsx';

interface CreateProps {
  joining: boolean;
  error: string | null;
  onChoose(trade: Trade): void;
}

/** The choices in the order a player reads them, not the order of the chains. */
const TRADE_CHOICES = [...TRADES].sort((left, right) => tradeName(left).localeCompare(tradeName(right), 'fr'));

/**
 * The first screen of a new player: the trade is the first decision, before
 * the town is read. The prices are the town's lesson, not the choice's.
 */
export function Create({ joining, error, onChoose }: CreateProps) {
  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>Choisis ton métier</h1>
        <p>Ton premier atelier est celui de ton métier.</p>
        <div class="trade-list">
          {TRADE_CHOICES.map((trade) => (
            <button class="trade-choice" type="button" key={trade} disabled={joining} onClick={() => onChoose(trade)}>
              <span class="trade-name">{tradeName(trade)}</span>
              <span class="trade-chain">{tradeChainText(trade)}</span>
            </button>
          ))}
        </div>
        {error !== null ? <p class="gate-error">{error}</p> : null}
      </div>
    </div>
  );
}
