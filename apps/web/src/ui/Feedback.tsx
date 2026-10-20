import { t, useLang } from "../lib/i18n";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

type Tone = "info" | "success" | "warning" | "error";

const ICON: Record<Tone, string> = { info: "i", success: "✓", warning: "!", error: "✕" };

/** Thông báo trong trang. Lỗi dùng role="alert", còn lại role="status". Có chữ, không chỉ màu. */
export function Alert({ tone = "info", children, action }: { tone?: Tone; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="alert__icon" aria-hidden="true">
        {ICON[tone]}
      </span>
      <div className="alert__body">
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}

export function Loading({ label = t("Đang tải…") }: { label?: string }) {
  return (
    <div className="state" role="status">
      <div className="loading-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <span className="state__art" aria-hidden="true">
        ✦
      </span>
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      tone="error"
      action={
        onRetry && (
          <div>
            <Button size="sm" onClick={onRetry}>
              {t("Thử lại")}
            </Button>
          </div>
        )
      }
    >
      <strong>{t("Ôi, có lỗi rồi.")}</strong> {message}
    </Alert>
  );
}

// ---------- Thông báo nổi sau thao tác (thành công/lỗi) ----------

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ToastContext = createContext<(tone: Tone, text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  useLang(); // nằm ngoài App: tự vẽ lại nút "Đóng" khi đổi ngôn ngữ
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (tone: Tone, text: string) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, tone, text }]);
      // Lỗi giữ đến khi người dùng đóng; thông báo khác tự ẩn sau 6 giây
      if (tone !== "error") window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`alert alert--${toast.tone} toast`} role={toast.tone === "error" ? "alert" : "status"}>
            <span className="alert__icon" aria-hidden="true">
              {ICON[toast.tone]}
            </span>
            <span>{toast.text}</span>
            <Button size="sm" variant="ghost" onClick={() => dismiss(toast.id)} aria-label={t("Đóng thông báo")}>
              {t("Đóng")}
            </Button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  return useMemo(
    () => ({
      success: (text: string) => show("success", text),
      error: (text: string) => show("error", text),
      info: (text: string) => show("info", text),
    }),
    [show],
  );
}
