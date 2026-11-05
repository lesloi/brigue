import type { GoodId } from '@brigue/core';

export function Seal({ size = 30 }: { size?: number }) {
  return (
    <svg class="seal" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.6" fill="#b23a2e" />
      <circle cx="16" cy="16" r="12.2" fill="none" stroke="#ffe6c9" stroke-width=".7" opacity=".55" />
      <path d="M9 20.5h14M12 20.5v-4a4 4 0 0 1 8 0v4" fill="none" stroke="#ffe6c9" stroke-width="1.5" />
    </svg>
  );
}

export function ResourceIcon({ kind }: { kind: GoodId | 'coins' | 'favour' }) {
  switch (kind) {
    case 'coins':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" fill="#c79338" />
          <circle cx="12" cy="12" r="6" fill="none" stroke="#8a5c14" stroke-width="1.4" />
        </svg>
      );
    case 'cloth':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="7" width="18" height="10" rx="2" fill="#b8714f" />
          <path d="M3 11h18M3 14h18" stroke="#8f4b2d" stroke-width="1" />
        </svg>
      );
    case 'wool':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="11" r="4.6" fill="#ddd5c4" />
          <circle cx="14.5" cy="10" r="5" fill="#cfc6b3" />
          <circle cx="12" cy="15" r="4.2" fill="#e8e1d2" />
        </svg>
      );
    case 'grain':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 21V6" stroke="#a9855a" stroke-width="1.6" stroke-linecap="round" />
          <path
            d="M12 8c-3 0-4-2-4-4 3 0 4 2 4 4zm0 0c3 0 4-2 4-4-3 0-4 2-4 4zm0 5c-3 0-4-2-4-4 3 0 4 2 4 4zm0 0c3 0 4-2 4-4-3 0-4 2-4 4z"
            fill="#d8b978"
          />
        </svg>
      );
    case 'bread':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 15c0-5 3-8 8-8s8 3 8 8v1c0 1-1 2-2 2H6c-1 0-2-1-2-2z" fill="#c58a4a" />
          <path d="M8 10l2 5M12 9v6M16 10l-2 5" stroke="#8f5f2d" stroke-width="1.1" stroke-linecap="round" />
        </svg>
      );
    case 'wood':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="9" cy="15" rx="5" ry="3" fill="#a77a52" />
          <path d="M4 15v-4c0-2 2-3 5-3s5 1 5 3v4" fill="#c09a6b" />
          <ellipse cx="9" cy="11" rx="5" ry="3" fill="#d8b98c" />
          <ellipse cx="15" cy="18" rx="4" ry="2.5" fill="#a77a52" />
          <path d="M11 18v-3c0-1 2-2 4-2s4 1 4 2v3" fill="#b98d5f" />
        </svg>
      );
    case 'planks':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="4" rx="1" fill="#c09a6b" />
          <rect x="3" y="11" width="18" height="4" rx="1" fill="#b98d5f" />
          <rect x="3" y="16" width="18" height="4" rx="1" fill="#c09a6b" />
        </svg>
      );
    case 'favour':
      return (
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.8z" fill="#b23a2e" />
        </svg>
      );
  }
}

export function WorkshopThumb({ good }: { good: GoodId }) {
  switch (good) {
    case 'cloth':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#eef0e6" />
          <rect x="12" y="26" width="24" height="14" fill="#f4e8ce" />
          <path d="M8 27L24 14l16 13z" fill="#c0663d" />
          <rect x="29" y="12" width="5" height="11" fill="#a77a52" />
          <rect x="21" y="31" width="7" height="9" fill="#8a6d47" />
          <rect x="14" y="29" width="4" height="4" fill="#a8c8d8" />
        </svg>
      );
    case 'wool':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f0ebe0" />
          <circle cx="18" cy="27" r="8" fill="#ddd5c4" />
          <circle cx="28" cy="24" r="9" fill="#cfc6b3" />
          <circle cx="26" cy="33" r="7" fill="#e8e1d2" />
          <path d="M12 39h24" stroke="#b9ad97" stroke-width="2" stroke-linecap="round" />
        </svg>
      );
    case 'grain':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f3eedf" />
          <path d="M15 18h18l-2 21H17z" fill="#d8b978" />
          <path d="M15 18c0-5 4-9 9-9s9 4 9 9" fill="none" stroke="#a9855a" stroke-width="2" />
          <path d="M24 13v6" stroke="#a9855a" stroke-width="2" />
        </svg>
      );
    case 'bread':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f4ecdc" />
          <path d="M10 30c0-9 6-15 14-15s14 6 14 15v2c0 2-2 4-4 4H14c-2 0-4-2-4-4z" fill="#c58a4a" />
          <path d="M17 21l3 9M24 19v11M31 21l-3 9" stroke="#8f5f2d" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      );
    case 'wood':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#eef0e6" />
          <ellipse cx="17" cy="31" rx="9" ry="5" fill="#a77a52" />
          <path d="M8 31v-7c0-3 4-5 9-5s9 2 9 5v7" fill="#c09a6b" />
          <ellipse cx="17" cy="24" rx="9" ry="5" fill="#d8b98c" />
          <ellipse cx="17" cy="24" rx="4" ry="2" fill="none" stroke="#a77a52" stroke-width="1.2" />
          <ellipse cx="31" cy="35" rx="8" ry="4" fill="#a77a52" />
          <path d="M23 35v-5c0-2 4-4 8-4s8 2 8 4v5" fill="#b98d5f" />
          <ellipse cx="31" cy="30" rx="8" ry="4" fill="#cfa878" />
        </svg>
      );
    case 'planks':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f3eedf" />
          <rect x="8" y="12" width="32" height="7" rx="1" fill="#c09a6b" />
          <rect x="8" y="21" width="32" height="7" rx="1" fill="#b98d5f" />
          <rect x="8" y="30" width="32" height="7" rx="1" fill="#c09a6b" />
          <path d="M13 15h22M13 24h22M13 33h22" stroke="#9a7046" stroke-width="1" />
        </svg>
      );
  }
}

export function NavIcon({ kind }: { kind: 'ville' | 'marche' | 'conseil' | 'greffe' | 'courrier' }) {
  const open = (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {kind === 'ville' ? (
        <>
          <path d="M4 20V11l8-6 8 6v9" />
          <path d="M10 20v-5h4v5" />
        </>
      ) : kind === 'marche' ? (
        <>
          <path d="M4 8h16l-2 12H6z" />
          <path d="M9 8a3 3 0 0 1 6 0" />
        </>
      ) : kind === 'conseil' ? (
        <>
          <path d="M4 20h16M6 20V9l6-4 6 4v11" />
          <path d="M10 20v-5h4v5" />
        </>
      ) : kind === 'greffe' ? (
        <>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4M9 12h7M9 16h5" />
        </>
      ) : (
        <>
          <rect x="3" y="6" width="18" height="13" rx="1.5" />
          <path d="M3 7l9 6 9-6" />
        </>
      )}
    </svg>
  );

  return open;
}
