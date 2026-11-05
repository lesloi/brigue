import { useEffect, useRef, useState } from 'preact/hooks';

import {
  ApiError,
  advanceWeek,
  hasSession,
  joinTown,
  readWorld,
  resumeTown,
  sendAction,
  type WorldResponse,
} from './api.ts';
import { actionErrorText, readErrorText } from './format.ts';
import { Failure, LostHouse, TokenDialog } from './views/gate.tsx';
import { Ville } from './views/ville.tsx';

type View =
  | { kind: 'loading' }
  | { kind: 'world'; data: WorldResponse }
  | { kind: 'lost' }
  | { kind: 'failure'; title: string; message: string };

interface Toast {
  text: string;
  error: boolean;
}

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [token, setToken] = useState<string | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pendingToken = useRef<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // The town is read once when the shell opens; later reads are explicit.
    void boot();
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
        try {
          const joined = await joinTown();
          pendingToken.current = joined.token;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'no_free_house') {
            setView({ kind: 'lost' });
            return;
          }
          throw error;
        }
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

  async function load(): Promise<void> {
    const data = await readWorld();
    // A load replaces the screen, as a paint used to: an old toast does not
    // outlive the town it described.
    setToast(null);
    setNow(Date.now());
    setView({ kind: 'world', data });

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

  async function buyWool(): Promise<void> {
    if (view.kind !== 'world') {
      return;
    }

    setBuying(true);
    try {
      const sent = await sendAction(view.data.world.week, { type: 'market.buy', good: 'wool', units: 10 });
      showToast(`Achat de 10 laines envoyé pour la semaine ${sent.week}. Il apparaîtra à la prochaine lecture.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stale_week') {
        showToast(actionErrorText(error.code), true);
        await refresh();
      } else {
        showToast(actionMessageFor(error), true);
      }
    } finally {
      setBuying(false);
    }
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
      {view.kind === 'loading' ? null : view.kind === 'world' ? (
        <Ville
          data={view.data}
          now={now}
          buying={buying}
          advancing={advancing}
          onRefresh={() => void refresh()}
          onBuyWool={() => void buyWool()}
          onAdvance={() => void advanceOneWeek()}
        />
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
