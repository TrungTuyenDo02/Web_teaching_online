import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import mascot from "../assets/helper-mascot.png";
import { useAuth } from "../auth/AuthProvider";
import type { Role } from "../lib/api";
import { backend, errorMessage } from "../lib/data";
import { answerGuide, guideSuggestions, type GuideReply } from "../lib/helperGuide";
import { lang, t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { Window } from "../ui/Window";
import "./HelperBot.css";

interface Exchange { question: string; answer: GuideReply }

function Guide({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [aiMode, setAiMode] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const last = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) last.current?.scrollIntoView({ block: "nearest" });
  }, [open, exchanges]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }
  async function chooseAI() {
    setAiMode(true); setError(null); setReady(null); setExchanges([]);
    try { setReady((await backend.assistantStatus()).enabled); }
    catch (err) { setReady(false); setError(errorMessage(err, "Không kiểm tra được trợ lý AI.")); }
  }
  async function send(question: string) {
    const value = question.trim().slice(0, 500);
    if (!value || sending.current) return;
    if (aiMode) {
      if (!consent || !ready) return;
      sending.current = true; setBusy(true); setError(null);
      const controller = new AbortController(); pending.current = controller;
      try {
        const reply = await backend.askAssistant({ question: value, language: lang(), consent: true,
          history: exchanges.slice(-3).map((e) => ({ question: e.question, answer: e.answer.text.slice(0, 3000) })) }, controller.signal);
        if (!controller.signal.aborted) {
          setExchanges((old) => [...old.slice(-19), { question: value, answer: { text: reply.answer, links: reply.sources.map((s, i) => ({ to: s.path, label: `[${i + 1}] ${s.title}` })) } }]);
          setDraft("");
        }
      } catch (err) { if (!controller.signal.aborted) setError(errorMessage(err, "Trợ lý AI chưa trả lời được. Hãy thử lại sau.")); }
      finally { sending.current = false; setBusy(false); pending.current = null; input.current?.focus(); }
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
                <p className="muted">{aiMode ? t("OpenAI · Tra cứu có nguồn") : t("Hướng dẫn dùng ứng dụng")}</p>
              </div>
            </div>
            <div className="helper__modes segmented" role="group" aria-label={t("Chế độ trợ giúp")}>
              <button type="button" aria-pressed={!aiMode} disabled={busy} onClick={() => { setAiMode(false); setError(null); setExchanges([]); }}>{t("Hướng dẫn")}</button>
              <button type="button" aria-pressed={aiMode} disabled={busy} onClick={() => void chooseAI()}>{t("Hỏi AI")}</button>
            </div>
            {aiMode && <div className="helper__notice">
              {ready === null && <p role="status">{t("Đang kiểm tra trợ lý AI…")}</p>}
              {ready === false && !error && <p role="status">{t("Trợ lý AI chưa được bật hoặc cấu hình.")}</p>}
              {ready && <label className="helper__consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
                <span>{t("Đồng ý gửi câu hỏi và trích đoạn tài liệu liên quan tới OpenAI. Không nhập thông tin riêng tư, mật khẩu hay token.")}</span></label>}
              {role === "teacher" && <Link to="/assistant-materials" onClick={close}>{t("Quản lý bài giảng RAG")}</Link>}
              {role === "student" && <p className="muted">{t("Bài giảng chỉ được tra cứu sau khi thầy cô bật và đúng chủ đề em đã học.")}</p>}
            </div>}
            <div className="helper__conversation" role="log" aria-label={t("Nội dung trò chuyện")} aria-live="polite" aria-relevant="additions">
              <p className="helper__bubble">{role === "teacher"
                ? t("Chào thầy cô! Mình giúp tìm đúng chỗ để quản lý lớp, xem báo cáo và ghi chú sau buổi học.")
                : t("Chào em! Mình giúp em xem lịch, vào lớp và tìm lại bảng của buổi đã học.")}</p>
              {exchanges.map((item, index) => (
                <div key={index} className="helper__exchange">
                  <p className="helper__bubble helper__bubble--user"><span className="sr-only">{t("Bạn:")} </span>{item.question}</p>
                  <div className="helper__bubble">
                    <p>{item.answer.text}</p>
                    {item.answer.links.map((link) => <Link key={link.to} to={link.to} className="btn btn--sm helper__link" onClick={close}>{link.label} →</Link>)}
                  </div>
                </div>
              ))}
              <div ref={last} />
            </div>
            <div className="helper__suggestions" aria-label={t("Câu hỏi gợi ý")}>
              {guideSuggestions(role).map((question) => <Button key={question} size="sm" disabled={busy || (aiMode && (!ready || !consent))} onClick={() => void send(question)}>{question}</Button>)}
            </div>
            {error && <p className="helper__notice" role="alert">{error}</p>}
            <form className="helper__form" onSubmit={submit}>
              <label className="sr-only" htmlFor={`${panelId}-question`}>{t("Nhập câu hỏi cho trợ giúp")}</label>
              <input ref={input} id={`${panelId}-question`} className="helper__input" value={draft} maxLength={500}
                placeholder={t("Bạn cần mình giúp gì?")} disabled={busy} autoComplete="off" onChange={(event) => setDraft(event.target.value)} />
              <Button type="submit" size="sm" busy={busy} busyLabel={t("Đang trả lời…")} disabled={!draft.trim() || (aiMode && (!ready || !consent))}>{t("Gửi")}</Button>
            </form>
            <p className="helper__privacy">{aiMode ? t("AI có thể sai. Kiểm tra nguồn trước khi dùng. Ứng dụng không lưu lịch sử chat trên máy chủ.") : t("Chỉ hướng dẫn thao tác. Trò chuyện này không được lưu sau khi tải lại trang.")}</p>
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
