import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import mascot from "../assets/helper-mascot.png";
import { useAuth } from "../auth/AuthProvider";
import type { Role } from "../lib/api";
import { backend, errorMessage } from "../lib/data";
import { answerGuide, guideSuggestions, opsSuggestions, type GuideReply } from "../lib/helperGuide";
import { lang, t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Check } from "../ui/Check";
import { Segmented } from "../ui/Segmented";
import { Window } from "../ui/Window";
import "./HelperBot.css";

interface Exchange { question: string; answer: GuideReply }

function Guide({ role }: { role: Role }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  // ops: Teacher-Ops chỉ đọc (chỉ giáo viên); ai: tra cứu hướng dẫn/bài giảng có nguồn
  const [mode, setMode] = useState<"guide" | "ai" | "ops">("guide");
  const aiMode = mode !== "guide";
  const [ready, setReady] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  // Câu đang chờ AI: hiện ngay trong khung chat thay vì nằm im trong ô nhập
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const last = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => () => pending.current?.abort(), []);
  // Hỏi một lần khi mở lần đầu; đổi chế độ thì hỏi đồng ý lại vì dữ liệu gửi đi khác nhau
  useEffect(() => {
    if (open && ready === null) backend.assistantStatus().then((s) => setReady(s.enabled), () => setReady(false));
  }, [open, ready]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    // Cuộn tới đầu lượt mới nhất: câu trả lời dài vẫn đọc được từ đầu
    if (open) last.current?.scrollIntoView({ block: "start" });
  }, [open, exchanges, asking]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }
  async function send(question: string) {
    const value = question.trim().slice(0, 500);
    if (!value || sending.current) return;
    if (aiMode) {
      if (!consent || !ready) return;
      sending.current = true; setBusy(true); setError(null); setAsking(value); setDraft("");
      const controller = new AbortController(); pending.current = controller;
      try {
        const ask = mode === "ops" ? backend.askTeacherOps : backend.askAssistant;
        const reply = await ask({ question: value, language: lang(), consent: true,
          history: exchanges.slice(-3).map((e) => ({ question: e.question, answer: e.answer.text.slice(0, 3000) })) }, controller.signal);
        if (!controller.signal.aborted) {
          setExchanges((old) => [...old.slice(-19), { question: value, answer: { text: reply.answer, links: reply.sources.map((s, i) => ({ to: s.path, label: `[${i + 1}] ${s.title}` })) } }]);
        }
      } catch (err) {
        // Trả câu hỏi về ô nhập để bấm Gửi lại, không phải gõ lại
        if (!controller.signal.aborted) { setError(errorMessage(err, "Trợ lý AI chưa trả lời được. Hãy thử lại sau.")); setDraft(value); }
      }
      finally { sending.current = false; setBusy(false); setAsking(null); pending.current = null; input.current?.focus(); }
      return;
    }
    setExchanges((old) => [...old.slice(-19), { question: value, answer: answerGuide(value, role) }]);
    setDraft("");
    input.current?.focus();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <aside className={`helper${open ? " helper--open" : ""}`} aria-label={t("Trợ giúp sử dụng ứng dụng")}>
      {open && (
        <div id={panelId} role="dialog" aria-modal="false" aria-labelledby={titleId}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
          <Window title={t("Bạn đồng hành")} titleId={titleId} file="helper.chat" variant="mint" flush
            actions={<Button size="sm" onClick={close} aria-label={t("Thu gọn trò chuyện")}>−</Button>}>
            <div className="helper__intro">
              <img src={mascot} alt="" width="64" height="76" />
              <div>
                <strong>{role === "teacher" ? t("Trợ giúp giáo viên") : t("Trợ giúp học sinh")}</strong>
                <p className="muted">{mode === "ops" ? t("OpenAI · Lịch, học sinh, số buổi (chỉ xem)") : aiMode ? t("OpenAI · Tra cứu có nguồn") : t("Hướng dẫn dùng ứng dụng")}</p>
              </div>
            </div>
            {/* Chưa bật AI thì không bày chế độ AI ra rồi mới báo "chưa bật" */}
            {ready && <Segmented className="helper__modes" label={t("Chế độ trợ giúp")} value={mode} disabled={busy}
              onChange={(next) => { setMode(next); setConsent(false); setError(null); setExchanges([]); }}
              options={[
                { value: "guide" as const, label: t("Hướng dẫn") },
                { value: "ai" as const, label: t("Hỏi AI") },
                ...(role === "teacher" ? [{ value: "ops" as const, label: t("Lịch & lớp") }] : []),
              ]} />}
            {role === "teacher" && ready === false && <p className="helper__notice muted">{t("Hỏi AI chưa bật; cách bật ở docs/assistant.md.")}</p>}
            {aiMode && <div className="helper__notice">
              <Check checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy}>
                {mode === "ops" ? t("Đồng ý gửi câu hỏi tới OpenAI để tra lịch, học sinh và số buổi. Tên học sinh được thay bằng mã trước khi gửi. Không nhập thông tin riêng tư, mật khẩu hay token.") : t("Đồng ý gửi câu hỏi và trích đoạn tài liệu liên quan tới OpenAI. Không nhập thông tin riêng tư, mật khẩu hay token.")}</Check>
              {role === "teacher" && mode === "ai" && <Link to="/assistant-materials" onClick={close}>{t("Quản lý bài giảng RAG")}</Link>}
              {role === "student" && <p className="muted">{t("Bài giảng chỉ được tra cứu sau khi thầy cô bật và đúng chủ đề em đã học.")}</p>}
            </div>}
            <div className="helper__conversation" role="log" aria-label={t("Nội dung trò chuyện")} aria-live="polite" aria-relevant="additions">
              <p className="helper__bubble">{role === "teacher"
                ? t("Chào thầy cô! Mình giúp tìm đúng chỗ để quản lý lớp, xem báo cáo và ghi chú sau buổi học.")
                : t("Chào em! Mình giúp em xem lịch, vào lớp và tìm lại bảng của buổi đã học.")}</p>
              {exchanges.map((item, index) => (
                <div key={index} className="helper__exchange" ref={index === exchanges.length - 1 && !asking ? last : undefined}>
                  <p className="helper__bubble helper__bubble--user"><span className="sr-only">{t("Bạn:")} </span>{item.question}</p>
                  <div className="helper__bubble">
                    <p>{item.answer.text}</p>
                    {item.answer.links.map((link) => <Link key={link.to} to={link.to} className="btn btn--sm helper__link" onClick={close}>{link.label} <span aria-hidden="true">→</span></Link>)}
                  </div>
                </div>
              ))}
              {asking && (
                <div className="helper__exchange" ref={last}>
                  <p className="helper__bubble helper__bubble--user"><span className="sr-only">{t("Bạn:")} </span>{asking}</p>
                  <p className="helper__bubble helper__typing">{t("Mình đang tìm câu trả lời…")}</p>
                </div>
              )}
            </div>
            <div className="helper__suggestions" aria-label={t("Câu hỏi gợi ý")}>
              {(mode === "ops" ? opsSuggestions() : guideSuggestions(role, pathname)).map((question) => <Button key={question} size="sm" disabled={busy || (aiMode && (!ready || !consent))} onClick={() => void send(question)}>{question}</Button>)}
            </div>
            {error && <p className="helper__notice" role="alert">{error}</p>}
            <form className="helper__form" onSubmit={submit}>
              <label className="sr-only" htmlFor={`${panelId}-question`}>{t("Nhập câu hỏi cho trợ giúp")}</label>
              <input ref={input} id={`${panelId}-question`} className="helper__input" value={draft} maxLength={500}
                placeholder={t("Bạn cần mình giúp gì?")} disabled={busy} autoComplete="off" onChange={(event) => setDraft(event.target.value)} />
              <Button type="submit" size="sm" busy={busy} busyLabel={t("Đang trả lời…")} disabled={!draft.trim() || (aiMode && (!ready || !consent))}>{t("Gửi")}</Button>
            </form>
            <p className="helper__privacy">{mode === "ops" ? t("AI có thể sai. Đối chiếu với Trang chính trước khi dùng. Trợ lý chỉ xem, không sửa lịch. Ứng dụng không lưu lịch sử chat trên máy chủ.") : aiMode ? t("AI có thể sai. Kiểm tra nguồn trước khi dùng. Ứng dụng không lưu lịch sử chat trên máy chủ.") : t("Chỉ hướng dẫn thao tác. Trò chuyện này không được lưu sau khi tải lại trang.")}</p>
          </Window>
        </div>
      )}
      {!open && (
        <button ref={launcher} className="helper__launcher" type="button" aria-label={t("Mở trợ giúp")}
          aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(true)}>
          <span className="helper__hello">{t("Mình giúp nhé?")}</span>
          <img src={mascot} alt="" width="112" height="134" decoding="async" />
          <span className="helper__label">{t("Trợ giúp")}</span>
        </button>
      )}
    </aside>
  );
}

/** Remount khi đổi tài khoản/vai trò; nội dung trò chuyện không theo sang tài khoản khác. */
export default function HelperBot() {
  const { user } = useAuth();
  if (!user?.role) return null;
  return <Guide key={`${user.id}-${user.role}`} role={user.role} />;
}
