import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { brand } from "./brand";
import { isSupabaseConfigured } from "./lib/env";
import { useLang } from "./lib/i18n";
import BoardReviewPage from "./pages/BoardReviewPage";
import DashboardPage from "./pages/DashboardPage";
import HistoryPage from "./pages/HistoryPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import MonthlyReportPage from "./pages/MonthlyReportPage";
import TeachingNotesPage from "./pages/TeachingNotesPage";
import NotFoundPage from "./pages/NotFoundPage";
import RoomPage from "./pages/RoomPage";
import StudentsPage from "./pages/StudentsPage";
import AssistantMaterialsPage from "./pages/AssistantMaterialsPage";
import { Loading } from "./ui/Feedback";
import { Window } from "./ui/Window";

// Chỉ bản development mới có chế độ xem trước (src/dev/preview.tsx)
const PreviewBanner = import.meta.env.DEV
  ? lazy(() => import("./dev/preview").then((m) => ({ default: m.PreviewBanner })))
  : () => null;

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <main className="centered">
        <Loading />
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** "/": khách thấy trang giới thiệu, người đã đăng nhập thấy trang chính theo vai trò. */
function Home() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <main className="centered">
        <Loading />
      </main>
    );
  }
  return user ? <DashboardPage /> : <LandingPage />;
}

export default function App() {
  const { preview } = useAuth();
  useLang(); // đổi ngôn ngữ thì vẽ lại cả cây trang (các trang gọi t() khi vẽ)
  if (!isSupabaseConfigured && !preview) {
    return (
      <main className="centered">
        <Window title={brand.name} file="setup.txt" variant="peach">
          <p>
            Chưa cấu hình Supabase. Sao chép <code>apps/web/.env.example</code> thành <code>apps/web/.env.local</code> và điền{" "}
            <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
          {import.meta.env.DEV && (
            <p>
              Chỉ muốn xem giao diện: mở <a href="/?preview=teacher">xem trước như giáo viên</a> hoặc{" "}
              <a href="/?preview=student">như học sinh</a> (dữ liệu minh họa).
            </p>
          )}
        </Window>
      </main>
    );
  }
  return (
    <>
      {preview && (
        <Suspense fallback={null}>
          <PreviewBanner />
        </Suspense>
      )}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Home />} />
        <Route path="/history" element={<RequireAuth><HistoryPage /></RequireAuth>} />
        <Route path="/history/:sessionId/board" element={<RequireAuth><BoardReviewPage /></RequireAuth>} />
        <Route path="/students" element={<RequireAuth><StudentsPage /></RequireAuth>} />
        <Route path="/reports" element={<RequireAuth><MonthlyReportPage /></RequireAuth>} />
        <Route path="/teaching-notes" element={<RequireAuth><TeachingNotesPage /></RequireAuth>} />
        <Route path="/assistant-materials" element={<RequireAuth><AssistantMaterialsPage /></RequireAuth>} />
        <Route path="/assistant-materials/:materialId" element={<RequireAuth><AssistantMaterialsPage /></RequireAuth>} />
        <Route path="/room/:sessionId" element={<RequireAuth><RoomPage /></RequireAuth>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
