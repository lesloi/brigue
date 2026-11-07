import { NavIcon } from '../icons.tsx';
import type { Tab } from '../tabs.ts';

type NavKind = 'ville' | 'marche' | 'maison' | 'conseil' | 'greffe' | 'courrier';

/** The bottom map of places: the screens that exist, and the ones to come. */
export function Nav({
  tab,
  unread,
  onSelect,
}: {
  tab: Tab;
  /** How many messages wait; the badge, never a filter. */
  unread: number;
  onSelect(tab: Tab): void;
}) {
  return (
    <nav class="nav" aria-label="Navigation principale">
      <NavItem kind="ville" label="Ville" active={tab === 'ville'} onClick={() => onSelect('ville')} />
      <NavItem kind="marche" label="Marché" active={tab === 'marche'} onClick={() => onSelect('marche')} />
      <NavItem kind="maison" label="Maison" active={tab === 'maison'} onClick={() => onSelect('maison')} />
      <NavItem kind="conseil" label="Conseil" active={false} />
      <NavItem kind="greffe" label="Greffe" active={tab === 'greffe'} onClick={() => onSelect('greffe')} />
      <NavItem
        kind="courrier"
        label="Courrier"
        active={tab === 'courrier'}
        badge={unread}
        onClick={() => onSelect('courrier')}
      />
    </nav>
  );
}

function NavItem({
  kind,
  label,
  active,
  badge = 0,
  onClick,
}: {
  kind: NavKind;
  label: string;
  active: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  if (onClick === undefined) {
    return (
      <button class="nav-item" type="button" disabled title="À venir" aria-label={`${label} (à venir)`}>
        <NavIcon kind={kind} />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      class={`nav-item${active ? ' on' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <NavIcon kind={kind} />
      <span>{label}</span>
      {badge > 0 ? (
        <span class="nav-badge" aria-label={`${badge} message${badge > 1 ? 's' : ''} non lu${badge > 1 ? 's' : ''}`}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}
