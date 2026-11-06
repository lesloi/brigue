import type { GoodId, Trade } from '@brigue/core';
import { useEffect, useRef, useState } from 'preact/hooks';

import {
  ApiError,
  advanceHour,
  cancelAction,
  cancelDeletion,
  joinTown,
  readPending,
  readSession,
  readWorld,
  requestDeletion,
  resumeTown,
  sendAction,
  type PendingActionView,
  type TradeIntent,
  type WorldResponse,
} from './api.ts';
import { actionErrorText, goodQuantity, readErrorText } from './format.ts';
import { navigationFor, stateOf, tabFromHash, type Tab } from './tabs.ts';
import { ClosingHouse, DeleteAccountDialog } from './views/account.tsx';
import { Create } from './views/create.tsx';
import { Failure, LostHouse, TokenDialog } from './views/gate.tsx';
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
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
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
        return;
      }
      // The deletion check comes first: a house-less account can be closing
      // too, and the closing screen is the only move left.
      if (session.deletionAfter !== null) {
        setView({ kind: 'closing', after: session.deletionAfter });
        return;
      }
      // The token survived the reset, the house did not: the trade gives it
      // one back.
      if (session.houseId === null) {
        setView({ kind: 'create', lost: true });
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

  async function createHouse(trade: Trade): Promise<void> {
    setJoining(true);
    setJoinError(null);

    try {
      const joined = await joinTown(trade);
      // A returning account keeps its token: there is nothing new to show.
      if (joined.token !== undefined) {
        pendingToken.current = joined.token;
      }
      await load();
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'deletion_pending' || error.code === 'house_lost')) {
        // The account moved while the screen was open: the session knows
        // which screen it belongs to now.
        await boot();
        return;
      }
      if (error instanceof ApiError && error.code === 'no_free_house') {
        // A half-completed join already set the cookie, or a fast second tap
        // raced the first: recover the session before asking for a token.
        try {
          const session = await readSession();

          if (session !== null) {
            if (session.deletionAfter !== null) {
              setView({ kind: 'closing', after: session.deletionAfter });
            } else if (session.houseId === null) {
              setView({ kind: 'create', lost: true });
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

  async function refresh(): Promise<void> {
    // A refresh replaces the town, and the token dialog lives above it: never
    // wipe a token the player has not had time to note.
    if (token !== null) {
      return;
    }

    try {
      await load();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'house_lost')) {
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

  async function cancel(id: string): Promise<void> {
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
      if (error instanceof ApiError && (error.status === 401 || error.code === 'house_lost')) {
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
      // A token a reset left without a house: the trade gives it one back.
      if (session.houseId === null) {
        setView({ kind: 'create', lost: true });
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
          resuming={resuming}
          resumeError={lostError}
          onChoose={(trade) => void createHouse(trade)}
          onResume={(candidate) => void resume(candidate)}
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
          <Nav tab={tab} onSelect={selectTab} />
        </div>
      ) : view.kind === 'closing' ? (
        <ClosingHouse after={view.after} busy={restoring} error={restoreError} onRestore={() => void restore()} />
      ) : view.kind === 'lost' ? (
        <LostHouse busy={resuming} error={lostError} onResume={(candidate) => void resume(candidate)} />
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

/** The URL of a tab. Ville keeps the path; Marché marks itself in the hash. */
function urlFor(tab: Tab): string {
  return tab === 'marche' ? '#marche' : window.location.pathname;
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
