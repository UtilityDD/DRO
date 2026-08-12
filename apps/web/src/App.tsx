import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { HierarchyPage } from './pages/HierarchyPage';
import {
  BulkPage,
  DiscoPage,
  GrievancePage,
  NscPage,
  SpotBillingPage,
  TechWorksPage,
} from './pages/ModulePages';
import { UploadPage } from './pages/UploadPage';
import { AdminPage } from './pages/AdminPage';
import { AtcPage } from './pages/AtcPage';
import { ConsumersPage } from './pages/ConsumersPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/hierarchy" element={<HierarchyPage />} />
            <Route path="/nsc" element={<NscPage />} />
            <Route path="/disco" element={<DiscoPage />} />
            <Route path="/grievances" element={<GrievancePage />} />
            <Route path="/tech-works" element={<TechWorksPage />} />
            <Route path="/spot-billing" element={<SpotBillingPage />} />
            <Route path="/bulk" element={<BulkPage />} />
            <Route path="/consumers" element={<ConsumersPage />} />
            <Route path="/atc" element={<AtcPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
