import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Role } from "../lib/api";
import { supabase } from "../lib/supabase";
import { t } from "../lib/i18n";

export interface AuthUser {
  id: string;
  /** Họ tên trong profiles; chưa có thì phần trước @ của email */
  name: string;
  /** Vai trò đọc từ bảng profiles (không tin claim trong JWT); null nếu không đọc được. */
  role: Role | null;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** Chế độ xem trước bằng dữ liệu minh họa (chỉ bản development, src/dev/preview.tsx) */
  preview: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  // undefined: đang đọc hồ sơ của phiên hiện tại
  const [profile, setProfile] = useState<{ role: Role | null; full_name: string } | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    setProfile(undefined);
    if (!supabase || !userId) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("role, full_name")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (!cancelled) setProfile(data ? { role: (data.role as Role | undefined) ?? null, full_name: data.full_name ?? "" } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<AuthState>(() => {
    const email = session?.user.email ?? "";
    return {
      user: session
        ? { id: session.user.id, name: profile?.full_name || email.split("@")[0] || t("Tài khoản"), role: profile?.role ?? null }
        : null,
      loading: loading || (Boolean(userId) && profile === undefined),
      preview: false,
      signIn: async (emailInput, password) => {
        const { error } = (await supabase?.auth.signInWithPassword({ email: emailInput, password })) ?? {
          error: { message: "Chưa cấu hình Supabase" },
        };
        if (!error) return null;
        // Supabase trả thông báo tiếng Anh: dịch hai trường hợp người dùng tự xử lý được
        return /invalid login/i.test(error.message)
          ? t("Email hoặc mật khẩu chưa đúng.")
          : t("Không đăng nhập được. Kiểm tra kết nối mạng rồi thử lại.");
      },
      signOut: async () => {
        await supabase?.auth.signOut();
      },
    };
  }, [session, profile, loading, userId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong AuthProvider");
  return ctx;
}
