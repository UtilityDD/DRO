import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { canAccessPath, canView } from '../api';

type LinkItem = {
  to: string;
  label: string;
  short: string;
  end?: boolean;
  moduleId?: string;
  admin?: boolean;
  icon: string;
};

const links: LinkItem[] = [
  { to: '/', label: 'Home', short: 'Home', end: true, icon: 'home' },
  { to: '/hierarchy', label: 'Hierarchy', short: 'Offices', icon: 'tree' },
  { to: '/nsc', label: 'New Connection', short: 'NSC', moduleId: 'nsc', icon: 'plug' },
  { to: '/disco', label: 'Disconnection', short: 'Disco', moduleId: 'disco', icon: 'bolt' },
  { to: '/grievances', label: 'Grievances', short: 'Docket', moduleId: 'grievance', icon: 'chat' },
  { to: '/tech-works', label: 'Tech Works', short: 'Works', moduleId: 'tech_works', icon: 'wrench' },
  { to: '/spot-billing', label: 'Spot Billing', short: 'Spot', moduleId: 'spot_billing', icon: 'bill' },
  { to: '/bulk', label: 'Bulk Consumers', short: 'Bulk', moduleId: 'bulk', icon: 'bulk' },
  { to: '/consumers', label: 'Consumers', short: 'Master', moduleId: 'consumers', icon: 'users' },
  { to: '/atc', label: 'AT&C', short: 'AT&C', moduleId: 'atc', icon: 'chart' },
  { to: '/upload', label: 'Upload Center', short: 'Upload', icon: 'upload' },
  { to: '/admin', label: 'Users & Auth', short: 'Users', admin: true, icon: 'admin' },
];

const PRIMARY = ['/', '/nsc', '/disco', '/upload'];

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
    case 'admin':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" />
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

export function AppShell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = moreOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [moreOpen]);

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
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (!canAccessPath(user, location.pathname)) {
    return <Navigate to="/" replace />;
  }

  const primary = visible.filter((l) => PRIMARY.includes(l.to));
  // ensure bottom nav always has 4 + more even if some modules hidden
  const bottomPrimary = PRIMARY.map((path) => visible.find((l) => l.to === path)).filter(Boolean) as LinkItem[];
  const moreLinks = visible.filter((l) => !PRIMARY.includes(l.to));
  const moreActive = moreLinks.some((l) =>
    l.end ? location.pathname === l.to : location.pathname === l.to || location.pathname.startsWith(`${l.to}/`)
  );

  const current = visible.find((l) =>
    l.end ? location.pathname === l.to : location.pathname === l.to || (l.to !== '/' && location.pathname.startsWith(l.to))
  );

  const scope =
    user.role === 'ccc'
      ? `CCC ${user.ccc_code}`
      : user.role === 'division'
        ? `Div ${user.division_code}`
        : 'Region 341';

  return (
    <div className="app-shell">
      <aside className="sidebar desktop-only">
        <div className="brand">
          <div className="brand-mark">DRO</div>
          <div className="brand-sub">Darjeeling Region Ops</div>
        </div>
        <nav className="nav">
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-icon">
                <Icon name={l.icon} />
              </span>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="muted scope-label">Scope: {scope}</div>
      </aside>

      <div className="main">
        <header className="app-bar">
          <div className="app-bar-text">
            <div className="app-bar-brand">DRO</div>
            <div>
              <h1>{current?.label || 'DRO Ops'}</h1>
              <p>
                {user.name} · {scope}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Sign out" onClick={() => logout()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2M14 12H4M7 9l-3 3 3 3" />
            </svg>
          </button>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </div>

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
            <div className="sheet-title">More modules</div>
            <div className="sheet-grid">
              {moreLinks.map((l) => (
                <button
                  key={l.to}
                  type="button"
                  className={`sheet-item ${location.pathname === l.to ? 'active' : ''}`}
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
