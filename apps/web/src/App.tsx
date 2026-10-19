import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { brand } from "./brand";
import { isSupabaseConfigured } from "./lib/env";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import RoomPage from "./pages/RoomPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="center">Đang tải…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <main className="center card">
        <h1>{brand.name}</h1>
        <p>
          Chưa cấu hình Supabase. Sao chép <code>apps/web/.env.example</code> thành{" "}
          <code>apps/web/.env.local</code> và điền <code>VITE_SUPABASE_URL</code>,{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
      </main>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/room/:sessionId"
        element={
          <RequireAuth>
            <RoomPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
