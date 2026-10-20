import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { brand } from "../brand";
import { t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Decor } from "../ui/Decor";
import { Field } from "../ui/Field";
import { Alert } from "../ui/Feedback";
import { LangSwitch } from "../ui/LangSwitch";
import { Window } from "../ui/Window";

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const message = await signIn(email, password);
    setBusy(false);
    if (message) setError(message);
    else navigate("/", { replace: true });
  }

  return (
    <main className="centered">
      <div className="centered__top">
        <Link to="/" className="btn btn--ghost btn--sm">
          ← {t("Giới thiệu")}
        </Link>
        <LangSwitch />
      </div>
      <Window title={t("Đăng nhập")} file="login.exe" variant="peach">
        <div className="stack">
          <p className="hero__title">
            <Decor type="sparkle" size={20} /> {brand.name}
          </p>
          <p className="muted">{t(brand.tagline)}</p>
        </div>
        <form className="form" onSubmit={onSubmit}>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email">
            {(c) => <input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />}
          </Field>
          <Field label={t("Mật khẩu")} hint={t("Quên mật khẩu? Nhờ thầy cô đặt lại giúp.")}>
            {(c) => (
              <input {...c} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" block busy={busy} busyLabel={t("Đang đăng nhập…")}>
            {t("Đăng nhập")}
          </Button>
        </form>
      </Window>
    </main>
  );
}
