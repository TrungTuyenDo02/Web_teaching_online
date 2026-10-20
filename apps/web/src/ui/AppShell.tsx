import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { brand } from "../brand";
import { t } from "../lib/i18n";
import { Button } from "./Button";
import { DecorLayer } from "./Decor";
import { LangSwitch } from "./LangSwitch";

const NAV = {
  teacher: [
    { to: "/", label: "Trang chính" },
    { to: "/students", label: "Học sinh" },
    { to: "/history", label: "Buổi đã học" },
    { to: "/reports", label: "Báo cáo tháng" },
    { to: "/teaching-notes", label: "Ghi chú riêng" },
  ],
  student: [
    { to: "/", label: "Trang chính" },
    { to: "/history", label: "Buổi đã học" },
  ],
} as const;

/** Khung trang: thanh trên (taskbar) gồm tên ứng dụng, điều hướng theo vai trò, ngôn ngữ, tài khoản, đăng xuất. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
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
    </div>
  );
}
