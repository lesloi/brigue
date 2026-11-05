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
          <rect x="3" y="4" width="18" height="16" rx="2" fill="#e8d3bf" />
          <path d="M3 4h18v5H3z" fill="#c98f6a" />
          <path d="M3 16h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#d8a17f" />
          <path d="M3 9l6-5" stroke="#8f4b2d" stroke-width="1" />
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
          <rect x="8" y="10" width="32" height="28" rx="3" fill="#e8d3bf" />
          <path d="M8 10h32v8H8z" fill="#c98f6a" />
          <path d="M8 30h32v5a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#d8a17f" />
          <path d="M8 18l10-8" stroke="#8f4b2d" stroke-width="1.2" />
          <path d="M13 14h22" stroke="#8f4b2d" stroke-width="1" />
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
          <path
            d="M18 23c1-2 4-2 5 0M24 20c2-2 5-1 5 1"
            stroke="#b9ad97"
            stroke-width="1.2"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      );
    case 'grain':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f3eedf" />
          <path d="M24 39V15" stroke="#a9855a" stroke-width="2" stroke-linecap="round" />
          <path
            d="M24 19c-4 0-6-3-6-6 4 0 6 3 6 6zm0 0c4 0 6-3 6-6-4 0-6 3-6 6zm-1 7c-4 0-6-3-6-6 4 0 6 3 6 6zm0 0c4 0 6-3 6-6-4 0-6 3-6 6zm-1 7c-4 0-6-3-6-6 4 0 6 3 6 6zm0 0c4 0 6-3 6-6-4 0-6 3-6 6z"
            fill="#d8b978"
          />
          <path d="M18 38l6-4 6 4" stroke="#a9855a" stroke-width="2" fill="none" stroke-linecap="round" />
        </svg>
      );
    case 'bread':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f4ecdc" />
          <ellipse cx="24" cy="28" rx="15" ry="9" fill="#c58a4a" />
          <ellipse cx="24" cy="26" rx="15" ry="9" fill="#d19a5b" />
          <path d="M17 22l3 8M24 20v10M31 22l-3 8" stroke="#8f5f2d" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      );
    case 'wood':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#eef0e6" />
          <rect x="8" y="25" width="31" height="10" rx="5" fill="#a77a52" />
          <circle cx="14" cy="30" r="4" fill="#d8b98c" />
          <circle cx="14" cy="30" r="1.4" fill="none" stroke="#a77a52" stroke-width="1" />
          <rect x="12" y="15" width="28" height="9" rx="4.5" fill="#c09a6b" />
          <circle cx="18" cy="19.5" r="3.5" fill="#e0c49c" />
          <circle cx="18" cy="19.5" r="1.2" fill="none" stroke="#a77a52" stroke-width="1" />
        </svg>
      );
    case 'planks':
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#f3eedf" />
          <rect x="8" y="12" width="32" height="7" rx="1" fill="#c09a6b" />
          <rect x="8" y="21" width="32" height="7" rx="1" fill="#b98d5f" />
          <rect x="8" y="30" width="32" height="7" rx="1" fill="#c09a6b" />
          <path
            d="M12 15c4-1 8-1 12 0M12 24c4 1 8 1 12 0M12 33c4-1 8-1 12 0"
            stroke="#9a7046"
            stroke-width="1"
            fill="none"
          />
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
