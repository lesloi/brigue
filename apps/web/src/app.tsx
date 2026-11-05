import type { GoodId, Trade } from '@brigue/core';
import { useEffect, useRef, useState } from 'preact/hooks';

import {
  ApiError,
  advanceWeek,
  cancelAction,
  hasSession,
  joinTown,
  readPending,
  readWorld,
  resumeTown,
  sendAction,
  type PendingActionView,
  type TradeIntent,
  type WorldResponse,
} from './api.ts';
import { actionErrorText, goodQuantity, readErrorText } from './format.ts';
import { navigationFor, stateOf, tabFromHash, type Tab } from './tabs.ts';
import { Create } from './views/create.tsx';
import { Failure, LostHouse, TokenDialog } from './views/gate.tsx';
import { Marche } from './views/marche.tsx';
import { Nav } from './views/nav.tsx';
import { Ville } from './views/ville.tsx';

type View =
  | { kind: 'loading' }
  | { kind: 'create' }
  | { kind: 'world'; data: WorldResponse }
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
      if (!(await hasSession())) {
        setView({ kind: 'create' });
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
      pendingToken.current = joined.token;
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'no_free_house') {
        // A half-completed join already set the cookie, or a fast second tap
        // raced the first: recover the session before asking for a token.
        try {
          if (await hasSession()) {
            await load();
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
      if (error instanceof ApiError && error.status === 401) {
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
      const sent = await sendAction(view.data.world.week, intent);
      await readPending().then(setPending, () => setPending([]));
      const quantity = goodQuantity(units, good);
      showToast(
        kind === 'buy'
          ? `Achat de ${quantity} envoyé pour la semaine ${sent.week}. Il apparaîtra à la prochaine lecture.`
          : `Vente de ${quantity} envoyée pour la semaine ${sent.week}. Elle apparaîtra à la prochaine lecture.`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_week') {
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
      if (error instanceof ApiError && (error.code === 'stale_week' || error.code === 'unknown_action')) {
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

  async function advanceOneWeek(): Promise<void> {
    // A repaint replaces the town, and the token dialog lives above it: same
    // guard as a refresh.
    if (token !== null) {
      return;
    }

    setAdvancing(true);
    try {
      const data = await advanceWeek();
      setNow(Date.now());
      setView({ kind: 'world', data });
      await readPending().then(setPending, () => setPending([]));
      showToast(`Semaine ${data.world.week}, comme si une heure était passée.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
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
      await resumeTown(candidate);
      await load();
    } catch (error) {
      setLostError(
        error instanceof ApiError && error.status === 401 ? "Ce jeton n'est pas reconnu." : readMessageFor(error),
      );
    } finally {
      setResuming(false);
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
        <Create joining={joining} error={joinError} onChoose={(trade) => void createHouse(trade)} />
      ) : view.kind === 'world' ? (
        <div class="app">
          {tab === 'ville' ? (
            <Ville
              data={view.data}
              now={now}
              advancing={advancing}
              pending={pending}
              cancelling={cancelling}
              onCancel={(id) => void cancel(id)}
              onRefresh={() => void refresh()}
              onGoMarket={() => selectTab('marche')}
              onAdvance={() => void advanceOneWeek()}
            />
          ) : (
            <Marche data={view.data} trading={trading} onTrade={(kind, good, units) => void trade(kind, good, units)} />
          )}
          <div class="fade" aria-hidden="true"></div>
          <Nav tab={tab} onSelect={selectTab} />
        </div>
      ) : view.kind === 'lost' ? (
        <LostHouse busy={resuming} error={lostError} onResume={(candidate) => void resume(candidate)} />
      ) : (
        <Failure title={view.title} message={view.message} onRetry={() => void boot()} />
      )}

      {token !== null ? (
        <TokenDialog
          token={token}
          onClose={() => setToken(null)}
          onCopied={() => showToast('Jeton copié.')}
          onCopyError={() => showToast('Impossible de copier : sélectionnez le jeton à la main.', true)}
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
