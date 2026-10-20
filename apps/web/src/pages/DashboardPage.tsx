import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../ui/AppShell";
import { Alert } from "../ui/Feedback";
import StudentHome from "./student/StudentHome";
import TeacherHome from "./teacher/TeacherHome";
import { t } from "../lib/i18n";

/** Trang chính: giao diện riêng theo vai trò đọc từ profiles. */
export default function DashboardPage() {
  const { user } = useAuth();
  return (
    <AppShell>
      {user?.role === "teacher" ? (
        <TeacherHome />
      ) : user?.role === "student" ? (
        <StudentHome />
      ) : (
        <Alert tone="warning">{t("Tài khoản chưa có hồ sơ. Hãy liên hệ thầy cô để được cấp quyền.")}</Alert>
      )}
    </AppShell>
  );
}
