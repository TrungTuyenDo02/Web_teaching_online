import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { backend, errorMessage, type DeviceMode, type JoinResponse } from "../lib/data";
import { Button, ButtonLink } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Alert, Loading } from "../ui/Feedback";
import { Window } from "../ui/Window";
import { usePageTitle } from "../lib/hooks";
import { t } from "../lib/i18n";

// Tách gói để trang danh sách tải nhanh; Excalidraw và LiveKit chỉ tải khi vào phòng
const Whiteboard = lazy(() => import("../components/Whiteboard"));
const VideoPanel = lazy(() => import("../components/VideoPanel"));

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; join: JoinResponse }
  | { status: "ended" };

export default function RoomPage() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const mode: DeviceMode = params.get("mode") === "board" ? "board" : "main";
  const navigate = useNavigate();
  usePageTitle(mode === "board" ? t("Bảng viết (tablet)") : t("Phòng học"));

  const [state, setState] = useState<State>({ status: "loading" });
  const [endOpen, setEndOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [homework, setHomework] = useState("");
  const [endError, setEndError] = useState<string | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [endPending, setEndPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // React StrictMode chạy effect hai lần ở môi trường dev: dùng chung một lời gọi để không điểm danh trùng.
  // Ghi nhớ theo buổi, chế độ và lần thử, để đổi buổi, đổi main/board hoặc bấm "Thử lại" thì gọi vào phòng lại.
  const joinRef = useRef<{ key: string; promise: Promise<JoinResponse> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const key = `${sessionId}:${mode}:${attempt}`;
    if (joinRef.current?.key !== key) {
      setState({ status: "loading" });
      joinRef.current = { key, promise: backend.joinSession(sessionId, mode) };
    }
    joinRef.current.promise
      .then((join) => !cancelled && setState({ status: "ready", join }))
      .catch((err: unknown) => !cancelled && setState({ status: "error", message: errorMessage(err, "Không vào được phòng.") }));
    return () => {
      cancelled = true;
    };
  }, [sessionId, mode, attempt]);

  // Gọi lại an toàn (API không tính thêm buổi); chỉ chặn bấm lặp khi đang chờ phản hồi
  async function onEnd(event?: FormEvent) {
    event?.preventDefault();
    if (endBusy) return;
    setEndBusy(true);
    setEndError(null);
    try {
      const result = await backend.endSession(sessionId, {
        summary: summary.trim() || undefined,
        homework_note: homework.trim() || undefined,
      });
      setEndOpen(false);
      if (result.finalize_pending) setEndPending(true);
      else navigate("/", { replace: true });
    } catch (err) {
      setEndError(errorMessage(err, "Không kết thúc được buổi học."));
    } finally {
      setEndBusy(false);
    }
  }

  // Video hoặc bảng báo giáo viên đã kết thúc: rời phòng trên mọi thiết bị (kể cả tablet)
  const onRoomClosed = () => setState({ status: "ended" });

  if (endPending) {
    return (
      <main className="centered">
        <Window title={t("Buổi học đã kết thúc")} file="saving.exe" variant="peach" headingLevel={1}>
          <Alert tone="warning">
            {t("Buổi học đã được tính. Chưa đóng xong phòng video hoặc chưa lưu được bảng; hệ thống sẽ tự thử lại sau vài phút.")}
          </Alert>
          {endError && <Alert tone="error">{endError}</Alert>}
          <div className="btn-row">
            <Button variant="primary" busy={endBusy} busyLabel={t("Đang thử lại…")} onClick={() => void onEnd()}>
              {t("Thử lại ngay")}
            </Button>
            <ButtonLink to="/">{t("Về trang chính")}</ButtonLink>
          </div>
        </Window>
      </main>
    );
  }
  if (state.status === "loading") {
    return (
      <main className="centered">
        <Loading label={t("Đang vào phòng…")} />
      </main>
    );
  }
  if (state.status === "ended") {
    return (
      <main className="centered">
        <Window title={t("Buổi học đã kết thúc")} file="bye.exe" variant="mint" headingLevel={1}>
          <p>{t("Cảm ơn bạn! Nội dung buổi học và bảng sẽ có ở mục \"Buổi đã học\".")}</p>
          <div className="btn-row">
            <ButtonLink variant="primary" to="/">
              {t("Về trang chính")}
            </ButtonLink>
            <ButtonLink to="/history">{t("Buổi đã học")}</ButtonLink>
          </div>
        </Window>
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="centered">
        <Window title={t("Chưa vào được phòng")} file="error.exe" variant="danger" headingLevel={1}>
          <p>{state.message}</p>
          <div className="btn-row">
            <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
              {t("Thử lại")}
            </Button>
            <ButtonLink to="/">{t("Về trang chính")}</ButtonLink>
          </div>
        </Window>
      </main>
    );
  }

  const { join } = state;
  const isTeacher = join.role === "teacher";
  return (
    <main className={`room room--${join.mode}`}>
      <header className="room__bar">
        <ButtonLink size="sm" to="/" aria-label={t("Rời phòng, về trang chính")}>
          ← {t("Rời phòng")}
        </ButtonLink>
        <h1 className="room__title">{join.mode === "board" ? t("Bảng viết (tablet)") : isTeacher ? t("Phòng học") : t("Phòng học · em xem bảng của thầy cô")}</h1>
        {isTeacher && join.mode === "main" && (
          <Button size="sm" variant="danger" onClick={() => setEndOpen(true)}>
            {t("Kết thúc buổi học")}
          </Button>
        )}
      </header>

      <div className="room__body">
        <Suspense fallback={<Loading label={t("Đang tải bảng viết…")} />}>
          <Whiteboard url={join.whiteboard.url} token={join.whiteboard.token} readOnly={!isTeacher} onEnded={onRoomClosed} />
        </Suspense>
        {/* Tablet (mode=board) không có token video: không tải, không kết nối LiveKit */}
        {join.livekit && (
          <Suspense fallback={<div className="room__video" />}>
            <VideoPanel url={join.livekit.url} token={join.livekit.token} onRoomClosed={onRoomClosed} />
          </Suspense>
        )}
      </div>

      <Dialog open={endOpen} title={t("Kết thúc buổi học")} file="end_class.exe" variant="pink" onClose={() => setEndOpen(false)} busy={endBusy}>
        <form className="form" onSubmit={(e) => void onEnd(e)}>
          <p>{t("Mọi thiết bị sẽ rời phòng, buổi học được tính là đã dạy và bảng được lưu lại.")}</p>
          <Field label={t("Nội dung đã dạy")} hint={t("Học sinh sẽ thấy ở mục \"Buổi đã học\".")}>
            {(c) => <textarea {...c} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={5000} />}
          </Field>
          <Field label={t("Bài về nhà")}>
            {(c) => <textarea {...c} value={homework} onChange={(e) => setHomework(e.target.value)} rows={2} maxLength={5000} />}
          </Field>
          {endError && <Alert tone="error">{endError}</Alert>}
          <div className="btn-row btn-row--end">
            <Button onClick={() => setEndOpen(false)} disabled={endBusy}>
              {t("Tiếp tục dạy")}
            </Button>
            <Button type="submit" variant="danger" busy={endBusy} busyLabel={t("Đang kết thúc…")}>
              {t("Kết thúc buổi học")}
            </Button>
          </div>
        </form>
      </Dialog>
    </main>
  );
}
