import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';

// Heavy, route-specific pages are code-split so the initial load does not pull in
// Leaflet (Power Map), xlsx (Upload) or the full chart desks up front.
const HierarchyPage = lazy(() =>
  import('./pages/HierarchyPage').then((m) => ({ default: m.HierarchyPage })),
);
const PowerMapPage = lazy(() =>
  import('./pages/PowerMapPage').then((m) => ({ default: m.PowerMapPage })),
);
const NscPage = lazy(() => import('./pages/ModulePages').then((m) => ({ default: m.NscPage })));
const DiscoPage = lazy(() => import('./pages/ModulePages').then((m) => ({ default: m.DiscoPage })));
const GrievancePage = lazy(() =>
  import('./pages/ModulePages').then((m) => ({ default: m.GrievancePage })),
);
const SpotBillingPage = lazy(() =>
  import('./pages/ModulePages').then((m) => ({ default: m.SpotBillingPage })),
);
const BulkPage = lazy(() => import('./pages/ModulePages').then((m) => ({ default: m.BulkPage })));
const TechWorksDeskPage = lazy(() =>
  import('./pages/TechWorksDeskPage').then((m) => ({ default: m.TechWorksDeskPage })),
);
const ConsumersPage = lazy(() =>
  import('./pages/ConsumersPage').then((m) => ({ default: m.ConsumersPage })),
);
const AtcPage = lazy(() => import('./pages/AtcPage').then((m) => ({ default: m.AtcPage })));
const FieldDeskPage = lazy(() =>
  import('./pages/FieldDeskPage').then((m) => ({ default: m.FieldDeskPage })),
);
const UploadPage = lazy(() => import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

function RouteFallback() {
  return (
    <div className="route-loading" aria-live="polite">
      <div className="loading-spinner" aria-label="Loading" />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/hierarchy" element={<HierarchyPage />} />
              <Route path="/powermap" element={<PowerMapPage />} />
              <Route path="/nsc" element={<NscPage />} />
              <Route path="/disco" element={<DiscoPage />} />
              <Route path="/grievances" element={<GrievancePage />} />
              <Route path="/tech-works" element={<TechWorksDeskPage />} />
              <Route path="/spot-billing" element={<SpotBillingPage />} />
              <Route path="/bulk" element={<BulkPage />} />
              <Route path="/consumers" element={<ConsumersPage />} />
              <Route path="/atc" element={<AtcPage />} />
              <Route path="/field" element={<FieldDeskPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
