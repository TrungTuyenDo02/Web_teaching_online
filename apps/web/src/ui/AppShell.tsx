import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { brand } from "../brand";
import HelperBot from "../components/HelperBot";
import { usePageTitle } from "../lib/hooks";
import { t } from "../lib/i18n";
import { Button } from "./Button";
import { DecorLayer } from "./Decor";
import { LangSwitch } from "./LangSwitch";

const NAV = {
  teacher: [
    { to: "/", label: "Trang chính" },
    { to: "/students", label: "Học sinh" },
    { to: "/history", label: "Buổi đã học" },
    { to: "/assignments", label: "Bài tập" },
    { to: "/reports", label: "Báo cáo tháng" },
    { to: "/teaching-notes", label: "Ghi chú riêng" },
  ],
  student: [
    { to: "/", label: "Trang chính" },
    { to: "/history", label: "Buổi đã học" },
  ],
} as const;

// Mỗi trang dựng AppShell riêng nên nhớ đường dẫn ở cấp module để biết là vừa chuyển trang
let lastPath: string | null = null;

/** Khung trang: thanh trên (taskbar) gồm tên ứng dụng, điều hướng theo vai trò, ngôn ngữ, tài khoản, đăng xuất. */
export function AppShell({ title, children }: { title?: string; children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  usePageTitle(title);
  // Chuyển trang trong ứng dụng: đưa focus về nội dung chính để trình đọc màn hình đọc trang mới (lần mở đầu thì không)
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) document.getElementById("main")?.focus();
    lastPath = pathname;
  }, [pathname]);
  const links = user?.role === "teacher" ? NAV.teacher : NAV.student;
  return (
    <div className="shell">
      <DecorLayer />
      <a className="btn skip-link" href="#main">
        {t("Chuyển đến nội dung chính")}
      </a>
      <header className="taskbar">
        <NavLink to="/" className="taskbar__brand">
          <span aria-hidden="true">✦</span> {brand.name}
        </NavLink>
        <nav className="taskbar__nav" aria-label={t("Điều hướng chính")}>
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end className="taskbar__link">
              {t(link.label)}
            </NavLink>
          ))}
        </nav>
        <div className="taskbar__user">
          <LangSwitch />
          {user && (
            <>
              <span className="taskbar__who">
                <span className="taskbar__name" title={user.name}>
                  {user.name}
                </span>{" "}
                <span className="taskbar__role">({user.role === "teacher" ? t("giáo viên") : t("học sinh")})</span>
              </span>
              <Button size="sm" onClick={() => void signOut()}>
                {t("Đăng xuất")}
              </Button>
            </>
          )}
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>
        {children}
      </main>
      <HelperBot />
    </div>
  );
}
