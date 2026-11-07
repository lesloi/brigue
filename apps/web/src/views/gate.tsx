import { useEffect, useRef, useState } from 'preact/hooks';

import { Seal } from '../icons.tsx';
import { Modal } from './modal.tsx';

interface LostDynastyProps {
  busy: boolean;
  error: string | null;
  onResume(token: string): void;
}

export function LostDynasty({ busy, error, onResume }: LostDynastyProps) {
  const [candidate, setCandidate] = useState('');

  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>Cette ville a déjà son joueur</h1>
        <p>Votre dynastie est liée à un compte joueur. Collez-le pour reprendre la partie.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = candidate.trim();
            if (trimmed !== '') {
              onResume(trimmed);
            }
          }}
        >
          <label for="token-input">Votre compte joueur</label>
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
        <p class="gate-note">
          Le compte joueur est la seule clé de cette dynastie : sans lui, elle ne peut pas être retrouvée.
        </p>
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

  useEffect(() => {
    // Focus once, when the dialog opens. Depending on onClose here would run
    // this again on every tick of the town's clock and steal focus back.
    copyButton.current?.focus();
  }, []);

  return (
    <Modal titleId="token-title" onClose={onClose}>
      <Seal size={34} />
      <h2 id="token-title">Votre compte joueur</h2>
      <p>
        Il ne sera plus affiché. Notez-le : c'est la seule façon de retrouver cette dynastie depuis un autre appareil.
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
    </Modal>
  );
}
