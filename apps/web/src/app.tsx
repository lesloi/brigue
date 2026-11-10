import type { GoodId, Trade } from '@brigue/core';
import { useEffect, useRef, useState } from 'preact/hooks';

import {
  ApiError,
  advanceHour,
  cancelAction,
  cancelDeletion,
  deleteMessage,
  joinTown,
  markMessageRead,
  readCandidate,
  readPending,
  readSession,
  readWorld,
  renameFamily,
  requestDeletion,
  resumeTown,
  sendAction,
  type ActionIntent,
  type PersonCandidate,
  type PendingActionView,
  type TradeIntent,
  type WorldResponse,
} from './api.ts';
import { actionErrorText, formatCount, goodQuantity, readErrorText } from './format.ts';
import { navigationFor, stateOf, tabFromHash, type Tab } from './tabs.ts';
import { ClosingPerson, DeleteAccountDialog } from './views/account.tsx';
import { Courrier } from './views/courrier.tsx';
import { Create } from './views/create.tsx';
import { Failure, LostPerson, TokenDialog } from './views/gate.tsx';
import { Greffe } from './views/greffe.tsx';
import { Maison } from './views/maison.tsx';
import { Marche } from './views/marche.tsx';
import { Nav } from './views/nav.tsx';
import { Ville } from './views/ville.tsx';

type View =
  | { kind: 'loading' }
  | { kind: 'create'; lost: boolean }
  | { kind: 'world'; data: WorldResponse }
  | { kind: 'closing'; after: string }
  | { kind: 'lost' }
  | { kind: 'failure'; title: string; message: string };

interface Toast {
  text: string;
  error: boolean;
}

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>(() => stateOf(window.history.state)?.tab ?? tabFromHash(window.location.hash));
  const [token, setToken] = useState<string | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [trading, setTrading] = useState<TradeIntent | null>(null);
  // The server's list, not a local guess: a reload keeps the queued actions.
  const [pending, setPending] = useState<PendingActionView[]>([]);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinTaken, setJoinTaken] = useState(false);
  // The identity the creation screen prefills: drawn by the server, written
  // nowhere until the join.
  const [candidate, setCandidate] = useState<PersonCandidate | null>(null);
  const [candidateError, setCandidateError] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [personBusy, setPersonBusy] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pendingToken = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  // A back() is asynchronous: a second tap before popstate would walk twice.
  // Every pushed entry has an in-app predecessor, so the popstate that clears
  // this guard always arrives.
  const tabBusy = useRef(false);

  useEffect(() => {
    // The town is read once when the shell opens; later reads are explicit.
    void boot();
  }, []);

  useEffect(() => {
    // The first entry of a visit has no in-app predecessor: back leaves the
    // PWA from here. A tab opened later is a pushed entry, so back returns to
    // the tab it came from. A reload keeps the pushed flag of its entry.
    const stored = stateOf(window.history.state);
    const initial = stored?.tab ?? tabFromHash(window.location.hash);
    window.history.replaceState({ tab: initial, pushed: stored?.pushed ?? false }, '', urlFor(initial));

    const onPop = (event: PopStateEvent) => {
      tabBusy.current = false;
      setTab(stateOf(event.state)?.tab ?? 'ville');
    };
    window.addEventListener('popstate', onPop);

    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (view.kind !== 'world') {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [view.kind]);

  useEffect(
    () => () => {
      if (toastTimer.current !== undefined) {
        window.clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  async function boot(): Promise<void> {
    setView({ kind: 'loading' });
    setLostError(null);

    try {
      const session = await readSession();

      if (session === null) {
        setView({ kind: 'create', lost: false });
        void readSuggestedCandidate();
        return;
      }
      // The deletion check comes first: a dynasty-less account can be closing
      // too, and the closing screen is the only move left.
      if (session.deletionAfter !== null) {
        setView({ kind: 'closing', after: session.deletionAfter });
        return;
      }
      // The token survived the reset, the dynasty did not: the trade gives it
      // one back.
      if (session.personId === null) {
        setView({ kind: 'create', lost: true });
        void readSuggestedCandidate();
        return;
      }

      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setView({ kind: 'lost' });
        return;
      }
      showFailure(error);
    }
  }

  async function createPerson(trade: Trade, name: string): Promise<void> {
    setJoining(true);
    setJoinError(null);
    setJoinTaken(false);

    try {
      // The server mints the person and names it with the family name the
      // player kept.
      const joined = await joinTown(trade, name);
      // A returning account keeps its token: there is nothing new to show.
      if (joined.token !== undefined) {
        pendingToken.current = joined.token;
      }
      await load();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'deletion_pending' || error.code === 'dynasty_lost' || error.code === 'person_lost')
      ) {
        // The account moved while the screen was open: the session knows
        // which screen it belongs to now.
        await boot();
        return;
      }
      if (error instanceof ApiError && error.code === 'name_taken') {
        // The name is what the field is for: the screen keeps it and says so.
        setJoinTaken(true);
        setJoinError(null);
        return;
      }
      if (error instanceof ApiError && (error.code === 'no_free_dynasty' || error.code === 'no_free_person')) {
        // A half-completed join already set the cookie, or a fast second tap
        // raced the first: recover the session before asking for a token.
        try {
          const session = await readSession();

          if (session !== null) {
            if (session.deletionAfter !== null) {
              setView({ kind: 'closing', after: session.deletionAfter });
            } else if (session.personId === null) {
              setView({ kind: 'create', lost: true });
              void readSuggestedCandidate();
            } else {
              await load();
            }
            return;
          }
          setView({ kind: 'lost' });
        } catch (recoverError) {
          if (recoverError instanceof ApiError && recoverError.status === 401) {
            setView({ kind: 'lost' });
            return;
          }
          setJoinError('La ville ne répond pas. Vérifiez la connexion.');
        }
        return;
      }
      setJoinError(
        error instanceof ApiError ? readErrorText(error.code) : 'La ville ne répond pas. Vérifiez la connexion.',
      );
    } finally {
      setJoining(false);
    }
  }

  /** The prefill of the creation screen: a free name, and the id the join will keep. */
  async function readSuggestedCandidate(): Promise<void> {
    setCandidateError(false);
    setJoinTaken(false);
    try {
      setCandidate(await readCandidate());
    } catch {
      // The player may write their own name, which is what the rule allows.
      setCandidate(null);
      setCandidateError(true);
    }
  }

  async function load(): Promise<void> {
    const data = await readWorld();
    // A load replaces the screen, as a paint used to: an old toast does not
    // outlive the town it described.
    setToast(null);
    setNow(Date.now());
    setView({ kind: 'world', data });
    try {
      setPending(await readPending());
    } catch {
      setPending([]);
    }

    if (pendingToken.current !== null) {
      const fresh = pendingToken.current;
      pendingToken.current = null;
      setToken(fresh);
    }
  }

  async function removeMessage(id: number): Promise<void> {
    try {
      const { unreadMessages } = await deleteMessage(id);
      setView((current) =>
        current.kind === 'world'
          ? {
              kind: 'world',
              data: {
                ...current.data,
                messages: current.data.messages.filter((message) => message.id !== id),
                unreadMessages,
              },
            }
          : current,
      );
    } catch {
      showToast("Le message n'a pas pu être supprimé.", true);
    }
  }

  async function readMessage(id: number): Promise<void> {
    // The badge is cosmetic: a failed call leaves the message unread, and
    // opening it again retries.
    try {
      const { read, unreadMessages } = await markMessageRead(id);

      if (!read) {
        return;
      }
      setView((current) =>
        current.kind === 'world'
          ? {
              kind: 'world',
              data: {
                ...current.data,
                unreadMessages,
                messages: current.data.messages.map((message) =>
                  message.id === id ? { ...message, read: true } : message,
                ),
              },
            }
          : current,
      );
    } catch {
      // Nothing to say: the line is on screen anyway.
    }
  }

  async function refresh(): Promise<void> {
    // A refresh replaces the town, and the token dialog lives above it: never
    // wipe a token the player has not had time to note.
    if (token !== null) {
      return;
    }

    try {
      await load();
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'dynasty_lost' || error.code === 'person_lost')
      ) {
        void boot();
        return;
      }
      showToast(readMessageFor(error), true);
    }
  }

  async function trade(kind: 'buy' | 'sell', good: GoodId, units: number): Promise<void> {
    if (view.kind !== 'world' || units <= 0) {
      return;
    }

    setTrading({ kind, good });
    try {
      const intent =
        kind === 'buy'
          ? ({ type: 'market.buy', good, units } as const)
          : ({ type: 'market.sell', good, units } as const);
      await sendAction(view.data.world.hour, intent);
      await readPending().then(setPending, () => setPending([]));
      const quantity = goodQuantity(units, good);
      showToast(
        kind === 'buy'
          ? `Achat de ${quantity} envoyé. Il apparaîtra à la prochaine lecture.`
          : `Vente de ${quantity} envoyée. Elle apparaîtra à la prochaine lecture.`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_hour') {
        showToast(actionErrorText(error.code), true);
        await refresh();
      } else {
        showToast(actionMessageFor(error), true);
      }
    } finally {
      setTrading(null);
    }
  }

  /** The ladder's actions share one queue with the market: same hour, same read. */
  async function personAction(busy: string, intent: ActionIntent, said: string): Promise<void> {
    if (view.kind !== 'world') {
      return;
    }

    setPersonBusy(busy);
    try {
      const stored = await sendAction(view.data.world.hour, intent);
      await readPending().then(setPending, () => setPending([]));
      showToast(
        stored.hour > view.data.world.hour
          ? `${said}. Les travaux finiront à l'heure ${formatCount(stored.hour)}.`
          : `${said}. Il apparaîtra à la prochaine lecture.`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_hour') {
        showToast(actionErrorText(error.code), true);
        await refresh();
      } else {
        showToast(actionMessageFor(error), true);
      }
    } finally {
      setPersonBusy(null);
    }
  }

  /** The name is identity, not a trade: it applies at once, and re-reads the town. */
  async function rename(name: string): Promise<void> {
    setPersonBusy('rename');
    setRenameError(null);

    try {
      await renameFamily(name);
      await load();
      showToast(`La dynastie s'appelle désormais ${name}.`);
    } catch (error) {
      setRenameError(
        error instanceof ApiError && error.code === 'name_taken'
          ? 'Ce nom est déjà porté dans la ville.'
          : readMessageFor(error),
      );
    } finally {
      setPersonBusy(null);
    }
  }

  async function cancel(id: number): Promise<void> {
    setCancelling(id);
    try {
      await cancelAction(id);
      setPending((current) => current.filter((action) => action.id !== id));
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'stale_hour' || error.code === 'unknown_action')) {
        showToast(actionErrorText(error.code), true);
        await refresh();
      } else {
        showToast(actionMessageFor(error), true);
      }
    } finally {
      setCancelling(null);
    }
  }

  function selectTab(next: Tab): void {
    if (tabBusy.current) {
      return;
    }

    // The history entry is the source of truth: a fast second tap sees the
    // tab the first one already pushed, not the stale render.
    const current = stateOf(window.history.state)?.tab ?? tab;
    const action = navigationFor(current, window.history.state, next);
    if (action === 'none') {
      return;
    }
    if (action === 'back') {
      tabBusy.current = true;
      window.history.back();
      return;
    }

    const state = { tab: next, pushed: action === 'push' };
    if (action === 'push') {
      window.history.pushState(state, '', urlFor(next));
    } else {
      window.history.replaceState(state, '', urlFor(next));
    }
    setTab(next);
  }

  async function advanceOneHour(): Promise<void> {
    // A repaint replaces the town, and the token dialog lives above it: same
    // guard as a refresh.
    if (token !== null) {
      return;
    }

    setAdvancing(true);
    try {
      const data = await advanceHour();
      setNow(Date.now());
      setView({ kind: 'world', data });
      await readPending().then(setPending, () => setPending([]));
      showToast(`Heure ${data.world.hour}, comme si une heure était passée.`);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'dynasty_lost' || error.code === 'person_lost')
      ) {
        void boot();
        return;
      }
      showToast(readMessageFor(error), true);
    } finally {
      setAdvancing(false);
    }
  }

  async function resume(candidate: string): Promise<void> {
    setResuming(true);
    setLostError(null);

    try {
      const session = await resumeTown(candidate);

      if (session.deletionAfter !== null) {
        setView({ kind: 'closing', after: session.deletionAfter });
        return;
      }
      // A token a reset left without a dynasty: the trade gives it one back.
      if (session.personId === null) {
        setView({ kind: 'create', lost: true });
        void readSuggestedCandidate();
        return;
      }

      await load();
    } catch (error) {
      setLostError(
        error instanceof ApiError && error.status === 401 ? "Ce compte n'est pas reconnu." : readMessageFor(error),
      );
    } finally {
      setResuming(false);
    }
  }

  function askDelete(): void {
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function deleteAccount(): Promise<void> {
    setDeleting(true);
    setDeleteError(null);

    try {
      const { deleteAfter } = await requestDeletion();
      setDeleteOpen(false);
      setView({ kind: 'closing', after: deleteAfter });
    } catch (error) {
      setDeleteError(readMessageFor(error));
    } finally {
      setDeleting(false);
    }
  }

  async function restore(): Promise<void> {
    setRestoring(true);
    setRestoreError(null);

    try {
      await cancelDeletion();
      await boot();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await boot();
        return;
      }
      setRestoreError(readMessageFor(error));
    } finally {
      setRestoring(false);
    }
  }

  function showFailure(error: unknown): void {
    const offline = error instanceof TypeError;
    setView({
      kind: 'failure',
      title: offline ? 'Hors ligne' : 'La ville ne répond pas',
      message: offline
        ? "Le shell de l'application est là, mais la ville n'est pas joignable. Réessayez quand la connexion revient."
        : 'Le serveur a refusé la lecture. Réessayez dans un instant.',
    });
  }

  function showToast(text: string, error = false): void {
    setToast({ text, error });

    if (toastTimer.current !== undefined) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
    }, 6500);
  }

  return (
    <>
      {view.kind === 'loading' ? null : view.kind === 'create' ? (
        <Create
          lost={view.lost}
          joining={joining}
          error={joinError}
          taken={joinTaken}
          candidate={candidate}
          candidateError={candidateError}
          resuming={resuming}
          resumeError={lostError}
          onChoose={(trade, name) => void createPerson(trade, name)}
          onResume={(token) => void resume(token)}
          onReread={() => void readSuggestedCandidate()}
        />
      ) : view.kind === 'world' ? (
        <div class="app">
          {tab === 'ville' ? (
            <Ville
              data={view.data}
              now={now}
              advancing={advancing}
              pending={pending}
              onRefresh={() => void refresh()}
              onGoMarket={() => selectTab('marche')}
              onAdvance={() => void advanceOneHour()}
              onDeleteAccount={askDelete}
            />
          ) : tab === 'courrier' ? (
            <Courrier
              data={view.data}
              onRead={(id) => void readMessage(id)}
              onDelete={(id) => void removeMessage(id)}
            />
          ) : tab === 'greffe' ? (
            <Greffe data={view.data} />
          ) : tab === 'maison' ? (
            <Maison
              data={view.data}
              advancing={advancing}
              pending={pending}
              cancelling={cancelling}
              busy={personBusy}
              renameError={renameError}
              onBuild={(trade) =>
                void personAction('build', { type: 'workshop.build', trade }, `Construction d'un atelier de ${trade}`)
              }
              onDestroy={(workshopId) =>
                void personAction(
                  `destroy-${workshopId}`,
                  { type: 'workshop.destroy', workshopId },
                  "Démolition d'un atelier",
                )
              }
              onUpgrade={(workshopId) =>
                void personAction(
                  `upgrade-${workshopId}`,
                  { type: 'workshop.upgrade', workshopId },
                  "Agrandissement d'un atelier",
                )
              }
              onBuyTitle={() => void personAction('title', { type: 'person.buy_title' }, "Achat d'un titre")}
              onUpgradeResidence={() =>
                void personAction('residence', { type: 'person.upgrade_residence' }, 'Élévation de la résidence')
              }
              onRename={(name) => void rename(name)}
              onCancel={(id) => void cancel(id)}
              onAdvance={() => void advanceOneHour()}
            />
          ) : (
            <Marche
              data={view.data}
              trading={trading}
              pending={pending}
              cancelling={cancelling}
              onTrade={(kind, good, units) => void trade(kind, good, units)}
              onCancel={(id) => void cancel(id)}
            />
          )}
          <div class="fade" aria-hidden="true"></div>
          <Nav tab={tab} unread={view.data.unreadMessages} onSelect={selectTab} />
        </div>
      ) : view.kind === 'closing' ? (
        <ClosingPerson after={view.after} busy={restoring} error={restoreError} onRestore={() => void restore()} />
      ) : view.kind === 'lost' ? (
        <LostPerson busy={resuming} error={lostError} onResume={(candidate) => void resume(candidate)} />
      ) : (
        <Failure title={view.title} message={view.message} onRetry={() => void boot()} />
      )}

      {deleteOpen && view.kind === 'world' ? (
        <DeleteAccountDialog
          graceDays={view.data.deletionGraceDays}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) {
              setDeleteOpen(false);
            }
          }}
          onConfirm={() => void deleteAccount()}
        />
      ) : null}

      {token !== null ? (
        <TokenDialog
          token={token}
          onClose={() => setToken(null)}
          onCopied={() => showToast('Compte copié.')}
          onCopyError={() => showToast('Impossible de copier : sélectionnez le compte à la main.', true)}
        />
      ) : null}

      {toast !== null ? (
        <div class={`toast${toast.error ? ' error' : ''}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      ) : null}
    </>
  );
}

/** The URL of a tab. Ville keeps the path; the others mark themselves in the hash. */
function urlFor(tab: Tab): string {
  return tab === 'ville' ? window.location.pathname : `#${tab}`;
}

function actionMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return actionErrorText(error.code);
  }
  if (error instanceof TypeError) {
    return 'La ville ne répond pas. Vérifiez la connexion.';
  }

  return 'Une erreur inattendue est survenue.';
}

function readMessageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return readErrorText(error.code);
  }
  if (error instanceof TypeError) {
    return 'La ville ne répond pas. Vérifiez la connexion.';
  }

  return 'Une erreur inattendue est survenue.';
}
