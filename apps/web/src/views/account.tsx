import { useEffect, useRef } from 'preact/hooks';

import { Seal } from '../icons.tsx';
import { Modal } from './modal.tsx';

interface DeleteAccountDialogProps {
  graceDays: number;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * The one destructive action of the game: it schedules the erasure of the
 * identity, so the safe choice is focused and the copy stays short.
 */
export function DeleteAccountDialog({ graceDays, busy, error, onCancel, onConfirm }: DeleteAccountDialogProps) {
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
      <h2 id="delete-title">Supprimer votre compte</h2>
      <p>
        Toutes les données du compte seront supprimées dans {graceDays === 1 ? 'un jour' : `${graceDays} jours`}. Vous
        pourrez restaurer votre compte avant l'échéance.
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

interface ClosingPersonProps {
  after: string;
  busy: boolean;
  error: string | null;
  onRestore(): void;
}

/** The identity is scheduled for erasure: the only move left is coming back. */
export function ClosingPerson({ after, busy, error, onRestore }: ClosingPersonProps) {
  const deadline = new Date(after).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>Votre compte est en sursis</h1>
        <p>
          La suppression est programmée pour le <b>{deadline}</b>. D'ici là, vous ne pouvez plus accéder à votre compte.
          Sans action de votre part, votre compte sera effacé à l'échéance.
        </p>
        <button class="btn wide" type="button" disabled={busy} onClick={onRestore}>
          {busy ? 'Restauration…' : 'Restaurer'}
        </button>
        {error !== null ? <p class="gate-error">{error}</p> : null}
      </div>
    </div>
  );
}
