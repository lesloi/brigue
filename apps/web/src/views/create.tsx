import { TRADES, type Trade } from '@brigue/core/world';
import { useState } from 'preact/hooks';

import { tradeChainText, tradeName } from '../format.ts';
import { Seal } from '../icons.tsx';

interface CreateProps {
  joining: boolean;
  error: string | null;
  resuming: boolean;
  resumeError: string | null;
  onChoose(trade: Trade): void;
  onResume(token: string): void;
}

/** The choices in the order a player reads them, not the order of the chains. */
const TRADE_CHOICES = [...TRADES].sort((left, right) => tradeName(left).localeCompare(tradeName(right), 'fr'));

/**
 * The first screen of a new player: the trade is the first decision, before
 * the town is read. The prices are the town's lesson, not the choice's.
 */
export function Create({ joining, error, resuming, resumeError, onChoose, onResume }: CreateProps) {
  const [candidate, setCandidate] = useState('');

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
        <details class="resume">
          <summary>J'ai déjà un compte joueur</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = candidate.trim();
              if (trimmed !== '') {
                onResume(trimmed);
              }
            }}
          >
            <label for="resume-token">Votre compte joueur</label>
            <input
              id="resume-token"
              name="token"
              autocomplete="off"
              spellcheck={false}
              required
              value={candidate}
              onInput={(event) => setCandidate(event.currentTarget.value)}
            />
            <button class="btn outline wide" type="submit" disabled={resuming}>
              Reprendre
            </button>
          </form>
          {resumeError !== null ? <p class="gate-error">{resumeError}</p> : null}
        </details>
      </div>
    </div>
  );
}
