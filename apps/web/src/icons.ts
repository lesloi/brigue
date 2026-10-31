import type { GoodId } from '@brigue/core';

export function seal(size = 30): string {
  return `<svg class="seal" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.6" fill="#b23a2e"/><circle cx="16" cy="16" r="12.2" fill="none" stroke="#ffe6c9" stroke-width=".7" opacity=".55"/><path d="M9 20.5h14M12 20.5v-4a4 4 0 0 1 8 0v4" fill="none" stroke="#ffe6c9" stroke-width="1.5"/></svg>`;
}

export function resourceIcon(kind: 'coins' | 'cloth' | 'wool' | 'favour'): string {
  switch (kind) {
    case 'coins':
      return `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#c79338"/><circle cx="12" cy="12" r="6" fill="none" stroke="#8a5c14" stroke-width="1.4"/></svg>`;
    case 'cloth':
      return `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2" fill="#b8714f"/><path d="M3 11h18M3 14h18" stroke="#8f4b2d" stroke-width="1"/></svg>`;
    case 'wool':
      return `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="11" r="4.6" fill="#ddd5c4"/><circle cx="14.5" cy="10" r="5" fill="#cfc6b3"/><circle cx="12" cy="15" r="4.2" fill="#e8e1d2"/></svg>`;
    case 'favour':
      return `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.2l5.9-.8z" fill="#b23a2e"/></svg>`;
  }
}

export function workshopThumb(good: GoodId): string {
  switch (good) {
    case 'cloth':
      return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="#eef0e6"/><rect x="12" y="26" width="24" height="14" fill="#f4e8ce"/><path d="M8 27L24 14l16 13z" fill="#c0663d"/><rect x="29" y="12" width="5" height="11" fill="#a77a52"/><rect x="21" y="31" width="7" height="9" fill="#8a6d47"/><rect x="14" y="29" width="4" height="4" fill="#a8c8d8"/></svg>`;
    case 'wool':
      return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="#f0ebe0"/><circle cx="18" cy="27" r="8" fill="#ddd5c4"/><circle cx="28" cy="24" r="9" fill="#cfc6b3"/><circle cx="26" cy="33" r="7" fill="#e8e1d2"/><path d="M12 39h24" stroke="#b9ad97" stroke-width="2" stroke-linecap="round"/></svg>`;
    case 'grain':
      return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="#f3eedf"/><path d="M15 18h18l-2 21H17z" fill="#d8b978"/><path d="M15 18c0-5 4-9 9-9s9 4 9 9" fill="none" stroke="#a9855a" stroke-width="2"/><path d="M24 13v6" stroke="#a9855a" stroke-width="2"/></svg>`;
  }
}

export function navIcon(kind: 'ville' | 'marche' | 'conseil' | 'greffe' | 'courrier'): string {
  const open = `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
  switch (kind) {
    case 'ville':
      return `${open}<path d="M4 20V11l8-6 8 6v9"/><path d="M10 20v-5h4v5"/></svg>`;
    case 'marche':
      return `${open}<path d="M4 8h16l-2 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>`;
    case 'conseil':
      return `${open}<path d="M4 20h16M6 20V9l6-4 6 4v11"/><path d="M10 20v-5h4v5"/></svg>`;
    case 'greffe':
      return `${open}<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg>`;
    case 'courrier':
      return `${open}<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 7l9 6 9-6"/></svg>`;
  }
}
