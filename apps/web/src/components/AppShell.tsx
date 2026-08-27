import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { canAccessPath, canView, api, type Office } from '../api';
import { PageHeadingProvider } from '../lib/pageHeading';
import { PresentLaser } from './PresentLaser';

type ThemeId =
  | 'home'
  | 'hierarchy'
  | 'map'
  | 'nsc'
  | 'disco'
  | 'griev'
  | 'works'
  | 'spot'
  | 'bulk'
  | 'consumers'
  | 'atc'
  | 'field'
  | 'upload'
  | 'admin';

type GroupId = 'overview' | 'ops' | 'network' | 'system';

type LinkItem = {
  to: string;
  label: string;
  short: string;
  end?: boolean;
  moduleId?: string;
  admin?: boolean;
  icon: string;
  theme: ThemeId;
  group: GroupId;
};

const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ops', label: 'Operations' },
  { id: 'network', label: 'Network' },
  { id: 'system', label: 'System' },
];

const links: LinkItem[] = [
  { to: '/', label: 'Home', short: 'Home', end: true, icon: 'home', theme: 'home', group: 'overview' },
  { to: '/hierarchy', label: 'Hierarchy', short: 'Offices', icon: 'tree', theme: 'hierarchy', group: 'overview' },
  { to: '/powermap', label: 'Power Map', short: 'Map', icon: 'map', theme: 'map', group: 'overview' },
  { to: '/nsc', label: 'New Connection', short: 'NSC', moduleId: 'nsc', icon: 'plug', theme: 'nsc', group: 'ops' },
  { to: '/disco', label: 'Disconnection', short: 'Disco', moduleId: 'disco', icon: 'bolt', theme: 'disco', group: 'ops' },
  { to: '/grievances', label: 'Grievances', short: 'Griev', moduleId: 'grievance', icon: 'chat', theme: 'griev', group: 'ops' },
  { to: '/tech-works', label: 'Priority Works', short: 'Priority', moduleId: 'tech_works', icon: 'wrench', theme: 'works', group: 'ops' },
  { to: '/spot-billing', label: 'Spot Billing', short: 'Spot', moduleId: 'spot_billing', icon: 'bill', theme: 'spot', group: 'ops' },
  { to: '/field', label: 'Field Desk', short: 'Field', moduleId: 'field_notes', icon: 'pin', theme: 'field', group: 'ops' },
  { to: '/consumers', label: 'Consumers', short: 'Master', moduleId: 'consumers', icon: 'users', theme: 'consumers', group: 'network' },
  { to: '/bulk', label: 'Bulk Consumers', short: 'Bulk', moduleId: 'bulk', icon: 'bulk', theme: 'bulk', group: 'network' },
  { to: '/atc', label: 'AT&C', short: 'AT&C', moduleId: 'atc', icon: 'chart', theme: 'atc', group: 'network' },
  { to: '/upload', label: 'Upload Center', short: 'Upload', icon: 'upload', theme: 'upload', group: 'system' },
  { to: '/admin', label: 'Users & Auth', short: 'Users', admin: true, icon: 'admin', theme: 'admin', group: 'system' },
];

const PRIMARY = ['/', '/nsc', '/disco', '/upload'];
const PRESENT_KEY = 'dro.present';
const LASER_KEY = 'dro.laser';
const APPEARANCE_KEY = 'dro.appearance';
const MOBILE_MQ = '(max-width: 960px)';

function isMobileView() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches;
}

function readPresentFlag() {
  try {
    if (isMobileView()) return false;
    const q = new URLSearchParams(window.location.search).get('present');
    if (q === '1' || q === 'true' || q === 'on') return true;
    return window.localStorage.getItem(PRESENT_KEY) === '1';
  } catch {
    return false;
  }
}

function readLaserFlag() {
  try {
    return window.localStorage.getItem(LASER_KEY) === '1';
  } catch {
    return false;
  }
}

function persistLaser(on: boolean) {
  try {
    window.localStorage.setItem(LASER_KEY, on ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}

function persistPresent(on: boolean) {
  try {
    window.localStorage.setItem(PRESENT_KEY, on ? '1' : '0');
    const url = new URL(window.location.href);
    if (on) url.searchParams.set('present', '1');
    else url.searchParams.delete('present');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function readAppearance(): 'light' | 'dark' {
  try {
    const q = new URLSearchParams(window.location.search).get('dark');
    if (q === '1' || q === 'true' || q === 'on') return 'dark';
    if (q === '0' || q === 'false' || q === 'off') return 'light';
    return window.localStorage.getItem(APPEARANCE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function persistAppearance(mode: 'light' | 'dark') {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
  try {
    document.documentElement.setAttribute('data-appearance', mode);
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', mode);
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute('content', mode === 'dark' ? '#0b1220' : '#1565c0');
  } catch {
    /* ignore */
  }
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('dark')) {
      if (mode === 'dark') url.searchParams.set('dark', '1');
      else url.searchParams.set('dark', '0');
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) {
        window.history.replaceState(window.history.state, '', next);
      }
    }
  } catch {
    /* ignore */
  }
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

function Icon({ name }: { name: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M9 7v4M15 7v4M8 11h8v2a4 4 0 0 1-8 0v-2zM12 17v3" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 10-14h-7l0-6z" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 16V5M8 8l4-4 4 4M5 19h14" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'tree':
      return (
        <svg {...common}>
          <path d="M12 3v18M12 8h6M12 14h6M12 8H8M12 14H7" />
        </svg>
      );
    case 'map':
      return (
        <svg {...common}>
          <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2zM9 4v14M15 6v14" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M5 6h14v10H9l-4 3V6z" />
        </svg>
      );
    case 'wrench':
      return (
        <svg {...common}>
          <path d="M14.5 5.5a4 4 0 0 0-5.6 5.6L4 16v4h4l4.9-4.9a4 4 0 0 0 5.6-5.6l-3.2 1.4-2.8-2.8 1.4-3.2z" />
        </svg>
      );
    case 'bill':
      return (
        <svg {...common}>
          <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3zM9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case 'bulk':
      return (
        <svg {...common}>
          <path d="M4 8h16v11H4zM8 8V6a4 4 0 0 1 8 0v2" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M21 19c0-2.2-1.4-3.8-3.5-4.4" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 19h16M7 16V9M12 16V5M17 16v-5" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s7-6.4 7-11.2A7 7 0 0 0 5 9.8C5 14.6 12 21 12 21z" />
          <circle cx="12" cy="9.8" r="2.2" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
        </svg>
      );
    case 'present':
      return (
        <svg {...common} width={18} height={18}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'laser':
      return (
        <svg {...common} width={18} height={18}>
          <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="7.2" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...common} width={18} height={18}>
          <path d="M15.2 13.4A6.2 6.2 0 0 1 10.1 4.5 6.4 6.4 0 1 0 18 12.2a6.2 6.2 0 0 1-2.8 1.2z" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...common} width={18} height={18}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

function matchLink(pathname: string, l: LinkItem) {
  if (l.end) return pathname === l.to;
  return pathname === l.to || (l.to !== '/' && pathname.startsWith(l.to));
}

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [present, setPresent] = useState(readPresentFlag);
  const [presentNav, setPresentNav] = useState(false);
  const [laser, setLaser] = useState(() => readPresentFlag() || readLaserFlag());
  const appearanceBeforePresent = useRef<'light' | 'dark'>(readAppearance());
  const [appearance, setAppearance] = useState<'light' | 'dark'>(() => {
    const saved = appearanceBeforePresent.current;
    if (readPresentFlag() && !isMobileView()) {
      persistAppearance('dark');
      return 'dark';
    }
    persistAppearance(saved);
    return saved;
  });
  const [idle, setIdle] = useState(false);
  const laserBeforePresent = useRef(readLaserFlag());
  const [offices, setOffices] = useState<Office[]>([]);
  const [heading, setHeading] = useState('');

  useEffect(() => {
    api
      .offices()
      .then((r) => setOffices(r.offices || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMoreOpen(false);
    setPresentNav(false);
    setHeading('');
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = moreOpen || presentNav ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [moreOpen, presentNav]);

  useEffect(() => {
    persistPresent(present);
    document.body.classList.toggle('is-presenting', present);
    if (!present) {
      setPresentNav(false);
      setIdle(false);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
    return () => {
      document.body.classList.remove('is-presenting');
    };
  }, [present]);

  useEffect(() => {
    if (!present) return;
    let timer = 0;
    const bump = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 3200);
    };
    bump();
    window.addEventListener('mousemove', bump);
    window.addEventListener('pointerdown', bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('pointerdown', bump);
    };
  }, [present]);

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const setLaserOn = useCallback((on: boolean) => {
    setLaser(on);
    persistLaser(on);
  }, []);

  const setAppearanceOn = useCallback((mode: 'light' | 'dark') => {
    setAppearance(mode);
    persistAppearance(mode);
  }, []);

  useEffect(() => {
    persistAppearance(appearance);
  }, [appearance]);

  const setPresentOn = useCallback(
    (on: boolean, opts?: { fullscreen?: boolean }) => {
      if (on && isMobileView()) return;
      setPresent(on);
      persistPresent(on);
      if (on) {
        laserBeforePresent.current = laser;
        appearanceBeforePresent.current = appearance;
        setLaserOn(true);
        setAppearanceOn('dark');
      } else {
        setLaserOn(laserBeforePresent.current);
        setAppearanceOn(appearanceBeforePresent.current);
      }
      if (on && opts?.fullscreen !== false) enterFullscreen();
    },
    [appearance, enterFullscreen, laser, setAppearanceOn, setLaserOn]
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => {
      if (mq.matches) setPresentOn(false);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [setPresentOn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        if (presentNav) {
          e.preventDefault();
          setPresentNav(false);
          return;
        }
        if (document.querySelector('.crm-modal-back, .sheet-root')) return;
        if (present) {
          e.preventDefault();
          setPresentOn(false);
          return;
        }
        if (laser) {
          e.preventDefault();
          setLaserOn(false);
        }
        return;
      }
      if (key === 'p') {
        e.preventDefault();
        setPresentOn(!present);
        return;
      }
      if (key === 'n' && present) {
        e.preventDefault();
        setPresentNav((v) => !v);
        return;
      }
      if (key === 'l') {
        e.preventDefault();
        setLaserOn(!laser);
        return;
      }
      if (key === 'd') {
        e.preventDefault();
        const next = appearance === 'dark' ? 'light' : 'dark';
        if (present) appearanceBeforePresent.current = next;
        setAppearanceOn(next);
        return;
      }
      if (key === 'f' && present) {
        e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else enterFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appearance, laser, present, presentNav, setAppearanceOn, setLaserOn, setPresentOn, enterFullscreen]);

  const visible = useMemo(() => {
    if (!user) return [];
    return links.filter((l) => {
      if (l.admin) return user.role === 'admin';
      if (l.moduleId) return canView(user, l.moduleId);
      if (l.to === '/upload') return canAccessPath(user, '/upload');
      return true;
    });
  }, [user]);

  if (loading) {
    return (
      <div className="login-page">
        <div className="loading-spinner" aria-label="Loading" />
        <p className="muted" style={{ marginTop: 16 }}>Starting DRO…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to="/" replace />;
  }

  const primary = visible.filter((l) => PRIMARY.includes(l.to));
  const bottomPrimary = PRIMARY.map((path) => visible.find((l) => l.to === path)).filter(Boolean) as LinkItem[];
  const moreLinks = visible.filter((l) => !PRIMARY.includes(l.to));
  const moreActive = moreLinks.some((l) => matchLink(location.pathname, l));
  const current = visible.find((l) => matchLink(location.pathname, l));
  const theme = current?.theme || 'home';
  const groupLabel = GROUPS.find((g) => g.id === current?.group)?.label || 'DRO';

  const officeName = (code?: string) => {
    if (!code) return '';
    return offices.find((o) => String(o.code) === String(code))?.name || '';
  };
  const regionName =
    officeName(user.region_code) ||
    offices.find((o) => o.office_type === 'region')?.name ||
    'Darjeeling Region';
  const scope =
    user.role === 'ccc'
      ? officeName(user.ccc_code) || regionName
      : user.role === 'division'
        ? officeName(user.division_code) || regionName
        : regionName;

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const logoutIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2M14 12H4M7 9l-3 3 3 3" />
    </svg>
  );

  const navList = (items: LinkItem[], onPick?: () => void) =>
    GROUPS.map((g) => {
      const chunk = items.filter((l) => l.group === g.id);
      if (!chunk.length) return null;
      return (
        <div key={g.id} className="nav-group">
          <div className="nav-group-label">{g.label}</div>
          {chunk.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              data-theme={l.theme}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={onPick}
            >
              <span className="nav-icon">
                <Icon name={l.icon} />
              </span>
              {l.label}
            </NavLink>
          ))}
        </div>
      );
    });

  const userCard = (
    <div className="sidebar-user">
      <div className="sidebar-user-avatar" aria-hidden>
        {initials}
      </div>
      <div className="sidebar-user-meta">
        <strong>{user.name}</strong>
        <span>{scope}</span>
      </div>
      <button type="button" className="sidebar-logout" aria-label="Sign out" onClick={() => logout()}>
        {logoutIcon}
      </button>
    </div>
  );

  const presentBtn = (where: 'sidebar' | 'masthead' | 'fab') => (
    <button
      type="button"
      className={`${where === 'sidebar' ? 'sidebar-present' : where === 'fab' ? 'present-fab desktop-only' : 'present-btn'}${present ? ' on' : ''}`}
      aria-pressed={present}
      title={present ? 'Exit present (Esc)' : 'Present on a big screen (P)'}
      onClick={() => setPresentOn(!present)}
    >
      <span className="nav-icon">
        <Icon name="present" />
      </span>
      <span>{present ? 'Exit present' : 'Present'}</span>
      {where === 'sidebar' && <kbd>P</kbd>}
    </button>
  );

  const laserBtn = (where: 'sidebar' | 'masthead' | 'fab') => (
    <button
      type="button"
      className={`${where === 'sidebar' ? 'sidebar-present' : where === 'fab' ? 'present-fab laser-fab' : 'present-btn'} laser-btn${laser ? ' on' : ''}`}
      aria-pressed={laser}
      title={laser ? 'Laser off (L)' : 'Laser pointer (L)'}
      onClick={() => setLaserOn(!laser)}
    >
      <span className="nav-icon">
        <Icon name="laser" />
      </span>
      <span>{laser ? 'Laser on' : 'Laser'}</span>
      {where !== 'fab' && <kbd>L</kbd>}
    </button>
  );

  const appearanceBtn = (where: 'sidebar' | 'masthead' | 'fab' | 'sheet') => {
    const dark = appearance === 'dark';
    return (
      <button
        type="button"
        className={`${where === 'sidebar' ? 'sidebar-present' : where === 'fab' ? 'present-fab' : where === 'sheet' ? 'btn secondary' : 'present-btn'} appearance-btn${dark ? ' on' : ''}`}
        aria-pressed={dark}
        title={dark ? 'Light theme (D)' : 'Dark theme (D)'}
        onClick={() => {
          const next = dark ? 'light' : 'dark';
          if (present) appearanceBeforePresent.current = next;
          setAppearanceOn(next);
        }}
      >
        {where !== 'sheet' ? (
          <span className="nav-icon">
            <Icon name={dark ? 'sun' : 'moon'} />
          </span>
        ) : null}
        <span>{dark ? 'Light' : 'Dark'}</span>
        {where === 'sidebar' || where === 'masthead' ? <kbd>D</kbd> : null}
      </button>
    );
  };

  const mapMode = location.pathname.startsWith('/powermap');

  return (
    <div
      className={`app-shell${mapMode ? ' mode-powermap' : ''}${idle && present && !presentNav ? ' present-idle' : ''}`}
      data-theme={theme}
      data-appearance={appearance}
      data-present={present ? 'on' : 'off'}
      data-laser={laser ? 'on' : 'off'}
    >
      <header className="app-bar">
        <div
          className="app-bar-text"
          role={present ? 'button' : undefined}
          onClick={present ? () => setPresentNav(true) : undefined}
        >
          <img className="app-bar-brand" src="/icons/icon-192.png" alt="" />
          <h1>{heading || current?.label || 'DRO Insights'}</h1>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar desktop-only">
          <div className="sidebar-brand">
            <img className="brand-logo" src="/icons/icon-192.png" alt="" />
            <div>
              <div className="brand-mark">DRO Insights</div>
              <div className="brand-sub">Actionable Insight</div>
            </div>
          </div>
          <nav className="nav">{navList(visible)}</nav>
          <div className="sidebar-footer">
            {appearanceBtn('sidebar')}
            {laserBtn('sidebar')}
            {presentBtn('sidebar')}
            {userCard}
          </div>
        </aside>

        <div className="main">
          {!mapMode && (
            <header className="page-masthead desktop-only">
              <div className="page-masthead-copy">
                <div className="page-masthead-kicker">{groupLabel}</div>
                <h1>{heading || current?.label || 'DRO Insights'}</h1>
                <p>{scope}</p>
              </div>
              <div className="page-masthead-actions">
                {present && <span className="present-chip">Presenting</span>}
                {appearanceBtn('masthead')}
                {laserBtn('masthead')}
                {presentBtn('masthead')}
              </div>
            </header>
          )}

          <div className={`page-content${mapMode ? ' page-content-flush' : ''}`}>
            <PageHeadingProvider set={setHeading}>
              <Outlet />
            </PageHeadingProvider>
          </div>
        </div>
      </div>

      {mapMode && !present && (
        <div className="present-fab-stack">
          {appearanceBtn('fab')}
          {laserBtn('fab')}
          {presentBtn('fab')}
        </div>
      )}

      {present && (
        <>
          <button
            type="button"
            className="present-hotzone desktop-only"
            aria-label="Open modules"
            title="Modules (N)"
            onClick={() => setPresentNav(true)}
          />
          <div className="present-hud desktop-only">
            <span>Presenting</span>
            <span className="present-hud-meta">
              {current?.label || 'DRO'} · {scope}
            </span>
            <button type="button" className="present-hud-btn" onClick={() => setPresentNav(true)}>
              Modules <kbd>N</kbd>
            </button>
            <button
              type="button"
              className="present-hud-btn"
              onClick={() => {
                const next = appearance === 'dark' ? 'light' : 'dark';
                appearanceBeforePresent.current = next;
                setAppearanceOn(next);
              }}
            >
              {appearance === 'dark' ? 'Light' : 'Dark'} <kbd>D</kbd>
            </button>
            <button
              type="button"
              className={`present-hud-btn${laser ? ' on' : ''}`}
              onClick={() => setLaserOn(!laser)}
            >
              Laser <kbd>L</kbd>
            </button>
            <button type="button" className="present-hud-btn" onClick={() => setPresentOn(false)}>
              Exit <kbd>Esc</kbd>
            </button>
          </div>
        </>
      )}

      <PresentLaser active={laser} />

      {presentNav && (
        <div className="present-nav-root" role="dialog" aria-modal="true" aria-label="Modules">
          <button type="button" className="present-nav-back" aria-label="Close" onClick={() => setPresentNav(false)} />
          <aside className="present-nav-panel">
            <div className="sidebar-brand">
              <img className="brand-logo" src="/icons/icon-192.png" alt="" />
              <div>
                <div className="brand-mark">DRO Insights</div>
                <div className="brand-sub">N to toggle · Esc to close</div>
              </div>
            </div>
            <nav className="nav">{navList(visible, () => setPresentNav(false))}</nav>
          </aside>
        </div>
      )}

      <nav className="bottom-nav mobile-only" aria-label="Primary">
        {(bottomPrimary.length ? bottomPrimary : primary).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="bottom-icon">
              <Icon name={l.icon} />
            </span>
            <span>{l.short}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-more ${moreActive || moreOpen ? 'active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <span className="bottom-icon">
            <Icon name="more" />
          </span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-root mobile-only" role="dialog" aria-modal="true" aria-label="More modules">
          <button type="button" className="sheet-backdrop" aria-label="Close" onClick={() => setMoreOpen(false)} />
          <div className="sheet-panel">
            <div className="sheet-handle" />
            {userCard}
            {appearanceBtn('sheet')}
            <div className="sheet-title">More modules</div>
            <div className="sheet-grid">
              {moreLinks.map((l) => (
                <button
                  key={l.to}
                  type="button"
                  className={`sheet-item ${location.pathname === l.to ? 'active' : ''}`}
                  data-theme={l.theme}
                  onClick={() => {
                    navigate(l.to);
                    setMoreOpen(false);
                  }}
                >
                  <span className="sheet-item-icon">
                    <Icon name={l.icon} />
                  </span>
                  <span>{l.short}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn secondary sheet-close" onClick={() => setMoreOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
