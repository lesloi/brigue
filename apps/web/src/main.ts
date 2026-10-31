import { ApiError, hasSession, joinTown, readWorld, resumeTown, sendAction, type WorldResponse } from './api.ts';
import { actionErrorText } from './format.ts';
import './styles.css';
import { failureTemplate, lostHouseTemplate, tokenDialogTemplate } from './views/gate.ts';
import { countdownText, villeTemplate } from './views/ville.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('missing #app');
}
const root = app;

let current: WorldResponse | null = null;
let pendingToken: string | null = null;
let countdownTimer: number | undefined;
let toastTimer: number | undefined;

void boot();

async function boot(): Promise<void> {
  try {
    if (!(await hasSession())) {
      try {
        const joined = await joinTown();
        pendingToken = joined.token;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'no_free_house') {
          showLostHouse();
          return;
        }
        throw error;
      }
    }

    await load();
  } catch (error) {
    showFailure(error);
  }
}

async function load(): Promise<void> {
  stopCountdown();
  const data = await readWorld();
  current = data;
  paint(data);

  if (pendingToken !== null) {
    const token = pendingToken;
    pendingToken = null;
    showToken(token);
  }
}

function paint(data: WorldResponse): void {
  root.innerHTML = villeTemplate(data);

  document.querySelector('#refresh')?.addEventListener('click', () => void refresh());
  document.querySelector('#buy-wool')?.addEventListener('click', () => void buyWool());
  startCountdown(data.world.nextTickAt);
}

async function refresh(): Promise<void> {
  try {
    await load();
  } catch (error) {
    showToast(messageFor(error), true);
  }
}

async function buyWool(): Promise<void> {
  if (current === null) {
    return;
  }

  const button = document.querySelector<HTMLButtonElement>('#buy-wool');
  if (button) {
    button.disabled = true;
  }

  try {
    const sent = await sendAction(current.world.week, { type: 'market.buy', good: 'wool', units: 10 });
    showToast(`Achat de 10 laines envoyé pour la semaine ${sent.week}. Il apparaîtra à la prochaine lecture.`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'stale_week') {
      showToast(actionErrorText(error.code), true);
      await refresh();
    } else {
      showToast(messageFor(error), true);
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function showLostHouse(): void {
  stopCountdown();
  root.innerHTML = lostHouseTemplate();

  const form = document.querySelector<HTMLFormElement>('#resume-form');
  const input = document.querySelector<HTMLInputElement>('#token-input');
  const error = document.querySelector<HTMLParagraphElement>('#gate-error');
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const token = input?.value.trim() ?? '';
    if (token === '') {
      return;
    }

    if (button) {
      button.disabled = true;
    }
    void resumeTown(token)
      .then(() => load())
      .catch((failure: unknown) => {
        if (error) {
          error.hidden = false;
          error.textContent =
            failure instanceof ApiError && failure.status === 401 ? "Ce jeton n'est pas reconnu." : messageFor(failure);
        }
      })
      .finally(() => {
        if (button) {
          button.disabled = false;
        }
      });
  });
}

function showFailure(error: unknown): void {
  stopCountdown();
  const offline = error instanceof TypeError;
  root.innerHTML = failureTemplate(
    offline ? 'Hors ligne' : 'La ville ne répond pas',
    offline
      ? "Le shell de l'application est là, mais la ville n'est pas joignable. Réessayez quand la connexion revient."
      : 'Le serveur a refusé la lecture. Réessayez dans un instant.',
  );
  document.querySelector('#retry')?.addEventListener('click', () => void boot());
}

function showToken(token: string): void {
  root.insertAdjacentHTML('beforeend', tokenDialogTemplate(token));

  const overlay = document.querySelector<HTMLDivElement>('#token-overlay');
  const close = () => overlay?.remove();

  document.querySelector('#close-token')?.addEventListener('click', close);
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.querySelector('#copy-token')?.addEventListener('click', () => {
    void navigator.clipboard.writeText(token).then(
      () => showToast('Jeton copié.'),
      () => showToast('Impossible de copier : sélectionnez le jeton à la main.', true),
    );
  });
}

function startCountdown(nextTickAt: string): void {
  const target = document.querySelector<HTMLSpanElement>('#tick-countdown');
  if (!target) {
    return;
  }

  const update = () => {
    target.textContent = countdownText(nextTickAt, Date.now());
  };
  update();
  countdownTimer = window.setInterval(update, 1000);
}

function stopCountdown(): void {
  if (countdownTimer !== undefined) {
    window.clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

function showToast(message: string, error = false): void {
  const toast = document.querySelector<HTMLDivElement>('#toast');
  if (!toast) {
    return;
  }

  toast.hidden = false;
  toast.textContent = message;
  toast.classList.toggle('error', error);

  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 6500);
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return actionErrorText(error.code);
  }
  if (error instanceof TypeError) {
    return 'La ville ne répond pas. Vérifiez la connexion.';
  }

  return 'Une erreur inattendue est survenue.';
}
