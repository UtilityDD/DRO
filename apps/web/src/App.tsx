import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { lazyNamed } from './lib/lazyPage';

// Heavy, route-specific pages are code-split so the initial load does not pull in
// Leaflet (Power Map), xlsx (Upload) or the full chart desks up front.
const HierarchyPage = lazyNamed(() => import('./pages/HierarchyPage'), 'HierarchyPage');
const PowerMapPage = lazyNamed(() => import('./pages/PowerMapPage'), 'PowerMapPage');
const NscPage = lazyNamed(() => import('./pages/ModulePages'), 'NscPage');
const DiscoPage = lazyNamed(() => import('./pages/ModulePages'), 'DiscoPage');
const GrievancePage = lazyNamed(() => import('./pages/ModulePages'), 'GrievancePage');
const SpotBillingPage = lazyNamed(() => import('./pages/ModulePages'), 'SpotBillingPage');
const BulkPage = lazyNamed(() => import('./pages/ModulePages'), 'BulkPage');
const TechWorksDeskPage = lazyNamed(() => import('./pages/TechWorksDeskPage'), 'TechWorksDeskPage');
const ConsumersPage = lazyNamed(() => import('./pages/ConsumersPage'), 'ConsumersPage');
const AtcPage = lazyNamed(() => import('./pages/AtcPage'), 'AtcPage');
const FieldDeskPage = lazyNamed(() => import('./pages/FieldDeskPage'), 'FieldDeskPage');
const UploadPage = lazyNamed(() => import('./pages/UploadPage'), 'UploadPage');
const AdminPage = lazyNamed(() => import('./pages/AdminPage'), 'AdminPage');

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  );
}
