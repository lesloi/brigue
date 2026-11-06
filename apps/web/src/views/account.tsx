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
 * The one destructive action of the game: it schedules the erasure of the
 * identity, so it asks by name and says what goes with it and when it can be
 * called off.
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
        <b>Maison {house}</b> quitte {town} : la suppression est programmée. Vous pourrez revenir sur votre décision
        avant l'échéance ; ensuite, le jeton, la maison, sa cassette et ses actions en attente disparaissent, et la
        ville part avec son dernier habitant.
      </p>
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
        <h1>Votre maison est en sursis</h1>
        <p>
          La suppression est programmée pour le <b>{deadline}</b>. D'ici là, la ville ne vous répond plus. Revenez sur
          votre décision pour reprendre la partie ; sinon, le jeton, la maison et sa file seront effacés à l'échéance.
        </p>
        <button class="btn wide" type="button" disabled={busy} onClick={onRestore}>
          {busy ? 'Retour…' : 'Revenir sur ma décision'}
        </button>
        {error !== null ? <p class="gate-error">{error}</p> : null}
        <p class="gate-note">Le jeton reste valable jusqu'à l'échéance : c'est lui qui vous permet de revenir.</p>
      </div>
    </div>
  );
}
