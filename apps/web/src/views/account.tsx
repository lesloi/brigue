import { useEffect, useRef } from 'preact/hooks';

import { Seal } from '../icons.tsx';
import { Modal } from './modal.tsx';

interface DeleteAccountDialogProps {
  town: string;
  house: string;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * The one destructive action of the game: it kills the token and takes the
 * house, so it asks by name and says what goes with it.
 */
export function DeleteAccountDialog({ town, house, busy, error, onCancel, onConfirm }: DeleteAccountDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus once, when the dialog opens: the safe choice, never the destructive
    // one, is what a stray Enter lands on.
    cancelButton.current?.focus();
  }, []);

  return (
    <Modal
      titleId="delete-title"
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
    >
      <Seal size={34} />
      <h2 id="delete-title">Supprimer votre maison ?</h2>
      <p>
        <b>Maison {house}</b> quitte {town}. Le jeton, la maison, sa cassette et ses actions en attente disparaissent.
        Si vous êtes le dernier habitant, la ville part avec vous. Cette action est définitive : rien ne sera conservé.
      </p>
      {error !== null ? <p class="warn">{error}</p> : null}
      <div class="dialog-actions">
        <button class="btn outline" type="button" ref={cancelButton} disabled={busy} onClick={onCancel}>
          Annuler
        </button>
        <button class="btn" type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Suppression…' : 'Supprimer'}
        </button>
      </div>
    </Modal>
  );
}
