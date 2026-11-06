import { useEffect, useRef, useState } from 'preact/hooks';

import { Seal } from '../icons.tsx';

interface LostHouseProps {
  busy: boolean;
  error: string | null;
  onResume(token: string): void;
}

export function LostHouse({ busy, error, onResume }: LostHouseProps) {
  const [candidate, setCandidate] = useState('');

  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>Cette ville a déjà son joueur</h1>
        <p>Votre maison est liée à un jeton. Collez-le pour reprendre la partie.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = candidate.trim();
            if (trimmed !== '') {
              onResume(trimmed);
            }
          }}
        >
          <label for="token-input">Votre jeton</label>
          <input
            id="token-input"
            name="token"
            autocomplete="off"
            spellcheck={false}
            required
            value={candidate}
            onInput={(event) => setCandidate(event.currentTarget.value)}
          />
          <button class="btn wide" type="submit" disabled={busy}>
            Reprendre
          </button>
        </form>
        {error !== null ? <p class="gate-error">{error}</p> : null}
        <p class="gate-note">Le jeton est la seule clé de cette maison : sans lui, elle ne peut pas être retrouvée.</p>
      </div>
    </div>
  );
}

interface FailureProps {
  title: string;
  message: string;
  onRetry(): void;
}

export function Failure({ title, message, onRetry }: FailureProps) {
  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>{title}</h1>
        <p>{message}</p>
        <button class="btn wide" type="button" onClick={onRetry}>
          Réessayer
        </button>
        <p class="gate-note">La ville vit sur le serveur. Le shell de l'application reste disponible hors ligne.</p>
      </div>
    </div>
  );
}

interface TokenDialogProps {
  token: string;
  onClose(): void;
  onCopied(): void;
  onCopyError(): void;
}

export function TokenDialog({ token, onClose, onCopied, onCopyError }: TokenDialogProps) {
  const copyButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus once, when the dialog opens. Depending on onClose here would run
    // this again on every tick of the town's clock and steal focus back.
    copyButton.current?.focus();
  }, []);

  return (
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== 'Tab') {
          return;
        }

        const focusables = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [],
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (first === undefined || last === undefined) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div class="dialog" ref={dialog}>
        <Seal size={34} />
        <h2 id="token-title">Votre jeton</h2>
        <p>
          Il ne sera plus affiché. Notez-le : c'est la seule façon de retrouver cette maison depuis un autre appareil.
        </p>
        <code id="token-value">{token}</code>
        <div class="dialog-actions">
          <button
            class="btn"
            id="copy-token"
            type="button"
            ref={copyButton}
            onClick={() => {
              void navigator.clipboard.writeText(token).then(onCopied, onCopyError);
            }}
          >
            Copier
          </button>
          <button class="btn outline" id="close-token" type="button" onClick={onClose}>
            J'ai noté
          </button>
        </div>
      </div>
    </div>
  );
}
