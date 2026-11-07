import { TRADES, type Trade } from '@brigue/core/world';
import { useEffect, useState } from 'preact/hooks';

import type { HouseCandidate } from '../api.ts';
import { tradeChainText, tradeName } from '../format.ts';
import { Seal } from '../icons.tsx';

interface CreateProps {
  /** The account kept its token but lost its house to a reset. */
  lost: boolean;
  joining: boolean;
  error: string | null;
  /** The name the route refused as taken: the field says so where it is. */
  taken: boolean;
  /** The identity the server prefills: the name the join will keep. */
  candidate: HouseCandidate | null;
  candidateError: boolean;
  resuming: boolean;
  resumeError: string | null;
  onChoose(trade: Trade, name: string): void;
  onResume(token: string): void;
  onReread(): void;
}

/** The choices in the order a player reads them, not the order of the chains. */
const TRADE_CHOICES = [...TRADES].sort((left, right) => tradeName(left).localeCompare(tradeName(right), 'fr'));

/**
 * The first screen of a new player: the name of the house and the trade, before
 * the town is read. The name is suggested and prefilled — it is an identity the
 * player is allowed to keep — and the trade is the town's lesson, not a rule.
 *
 * A returning account sees the same choice with the loss named: the reset took
 * the house, the token stayed, and the trade is what gives a house back.
 */
export function Create({
  lost,
  joining,
  error,
  taken,
  candidate,
  candidateError,
  resuming,
  resumeError,
  onChoose,
  onResume,
  onReread,
}: CreateProps) {
  const [name, setName] = useState('');
  const [resume, setResume] = useState('');
  // The prefill arrives after the screen: a name the player has already typed
  // is theirs, and the suggestion never overwrites it.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (candidate !== null && !touched) {
      setName(candidate.houseName);
    }
  }, [candidate, touched]);

  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>{lost ? 'Ta dynastie est perdue' : 'Fonde ta dynastie'}</h1>
        <p>
          {lost
            ? 'La ville a été remise à zéro : ta dynastie, ses ateliers et sa bourse ont disparu. Ton compte joueur, lui, est conservé. Donne un nom à ta dynastie et choisis un métier pour revenir.'
            : 'Le nom de ta dynastie est son identité dans la ville : lettres et chiffres, sans accent ni espace, et deux dynasties ne portent jamais le même nom.'}
        </p>
        <form
          class="house-name"
          onSubmit={(event) => {
            // The trade buttons are the only way to join: this form holds the
            // name, and Enter must not weave for a player who has not chosen.
            event.preventDefault();
          }}
        >
          <label for="create-name">Nom de la dynastie</label>
          <input
            id="create-name"
            name="name"
            autocomplete="off"
            spellcheck={false}
            maxLength={24}
            required
            placeholder={candidateError ? 'Le nom est à toi' : 'Le nom de ta dynastie'}
            value={name}
            onInput={(event) => {
              setTouched(true);
              setName(event.currentTarget.value);
            }}
          />
          {taken ? (
            <p class="gate-error">
              Ce nom est déjà porté dans le royaume, ou dans cette ville.{' '}
              <button
                class="link"
                type="button"
                onClick={() => {
                  setTouched(false);
                  onReread();
                }}
              >
                En choisir un autre
              </button>
            </p>
          ) : candidateError ? (
            <p class="gate-error">
              Le nom n'a pas pu être suggéré.{' '}
              <button class="link" type="button" onClick={onReread}>
                Réessayer
              </button>
            </p>
          ) : null}
        </form>
        <p class="gate-note">Puis ton métier, qui ouvre ton premier atelier.</p>
        <div class="trade-list">
          {TRADE_CHOICES.map((trade) => (
            <button
              class="trade-choice"
              type="button"
              key={trade}
              disabled={joining || name.trim() === ''}
              onClick={() => onChoose(trade, name.trim())}
            >
              <span class="trade-name">{tradeName(trade)}</span>
              <span class="trade-chain">{tradeChainText(trade)}</span>
            </button>
          ))}
        </div>
        {error !== null ? <p class="gate-error">{error}</p> : null}
        {lost ? null : (
          <details class="resume">
            <summary>J'ai déjà un compte joueur</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = resume.trim();
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
                value={resume}
                onInput={(event) => setResume(event.currentTarget.value)}
              />
              <button class="btn outline wide" type="submit" disabled={resuming}>
                Reprendre
              </button>
            </form>
            {resumeError !== null ? <p class="gate-error">{resumeError}</p> : null}
          </details>
        )}
      </div>
    </div>
  );
}
