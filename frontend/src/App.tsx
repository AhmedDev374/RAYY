import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { AUTH_REDIRECT_STATE_KEY } from './lib/authRedirect';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AboutPage from './pages/AboutPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import CareLogPage from './pages/CareLogPage';
import ChatPage from './pages/ChatPage';
import DashboardPage from './pages/DashboardPage';
import DeviceOnboardPage from './pages/DeviceOnboardPage';
import DiagnosePage from './pages/DiagnosePage';
import DiseaseMapPage from './pages/DiseaseMapPage';
import EncyclopediaPage, { EncyclopediaDetailPage } from './pages/EncyclopediaPage';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import PlantsPage from './pages/PlantsPage';
import { shouldRetry } from './lib/api';

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry },
    mutations: { retry: false },
  },
});

function intendedPath(location: { pathname: string; search: string; hash: string }) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  // Wait for the auth state listener to settle before judging the session: an
  // OAuth callback still exchanging its code reports `loading` plus a null
  // session for a moment, and rendering a redirect during that window is what
  // used to bounce signed-in users to /login.
  if (loading) {
    return (
      <div dir="rtl" lang="ar" className="font-arabic min-h-screen items-center justify-center text-leaf-700">
        جارٍ التحميل…
      </div>
    );
  }

  if (!session) {
    // Hand the page the user was trying to reach to the login route, so the
    // sign-in flow can return them there instead of to the dashboard.
    //
    // The destination goes in the query string *and* in router state. The URL
    // is what makes `/login?redirect=%2Fdashboard` self-describing - it sur-
    // vives a reload, a bookmark and a link pasted between browsers, and it is
    // what the login page reads. State is the in-SPA fallback.
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(intendedPath(location))}`}
        replace
        state={{ [AUTH_REDIRECT_STATE_KEY]: intendedPath(location) }}
      />
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route
              element={
                <PrivateRoute>
                  <Layout />
                </PrivateRoute>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/plants" element={<PlantsPage />} />
              <Route path="/diagnose" element={<DiagnosePage />} />
              <Route path="/encyclopedia" element={<EncyclopediaPage />} />
              <Route path="/encyclopedia/:species" element={<EncyclopediaDetailPage />} />
              <Route path="/care-log/:plantId" element={<CareLogPage />} />
              <Route path="/devices/onboard" element={<DeviceOnboardPage />} />
              <Route path="/disease-map" element={<DiseaseMapPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/about" element={<AboutPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
