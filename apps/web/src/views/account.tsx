import { useEffect, useRef } from 'preact/hooks';

import { Seal } from '../icons.tsx';
import { Modal } from './modal.tsx';

interface DeleteAccountDialogProps {
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * The one destructive action of the game: it schedules the erasure of the
 * identity, so the safe choice is focused and the copy stays short.
 */
export function DeleteAccountDialog({ busy, error, onCancel, onConfirm }: DeleteAccountDialogProps) {
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
      <p>Le compte et la maison seront supprimés. Vous pourrez revenir avant l'échéance.</p>
      {error !== null ? <p class="warn">{error}</p> : null}
      <div class="dialog-actions">
        <button class="btn outline" type="button" ref={cancelButton} disabled={busy} onClick={onCancel}>
          Annuler
        </button>
        <button class="btn" type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Programmation…' : 'Programmer'}
        </button>
      </div>
    </Modal>
  );
}

interface ClosingHouseProps {
  after: string;
  busy: boolean;
  error: string | null;
  onRestore(): void;
}

/** The identity is scheduled for erasure: the only move left is coming back. */
export function ClosingHouse({ after, busy, error, onRestore }: ClosingHouseProps) {
  const deadline = new Date(after).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div class="gate">
      <div class="gate-card">
        <Seal size={38} />
        <h1>Votre compte est en sursis</h1>
        <p>
          Suppression le <b>{deadline}</b>. D'ici là, la ville ne répond plus.
        </p>
        <button class="btn wide" type="button" disabled={busy} onClick={onRestore}>
          {busy ? 'Revenir…' : 'Revenir'}
        </button>
        {error !== null ? <p class="gate-error">{error}</p> : null}
      </div>
    </div>
  );
}
