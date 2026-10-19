import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { endSession, joinSession, type DeviceMode, type JoinResponse } from "../lib/api";

// Tách gói để trang danh sách tải nhanh; Excalidraw và LiveKit chỉ tải khi vào phòng
const Whiteboard = lazy(() => import("../components/Whiteboard"));
const VideoPanel = lazy(() => import("../components/VideoPanel"));

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; join: JoinResponse };

export default function RoomPage() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const mode: DeviceMode = params.get("mode") === "board" ? "board" : "main";
  const navigate = useNavigate();

  const [state, setState] = useState<State>({ status: "loading" });
  const [ending, setEnding] = useState(false);
  const [summary, setSummary] = useState("");
  const [homework, setHomework] = useState("");
  const [endError, setEndError] = useState<string | null>(null);

  // React StrictMode chạy effect hai lần ở môi trường dev: dùng chung một lời gọi để không điểm danh trùng
  const joinPromise = useRef<Promise<JoinResponse> | null>(null);
  useEffect(() => {
    let cancelled = false;
    joinPromise.current ??= joinSession(sessionId, mode);
    joinPromise.current
      .then((join) => !cancelled && setState({ status: "ready", join }))
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "Không vào được phòng" });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, mode]);

  async function onEnd() {
    setEndError(null);
    try {
      await endSession(sessionId, {
        summary: summary || undefined,
        homework_note: homework || undefined,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setEndError(err instanceof Error ? err.message : "Không kết thúc được buổi học");
    }
  }

  if (state.status === "loading") return <p className="center">Đang vào phòng…</p>;
  if (state.status === "error") {
    return (
      <main className="center card">
        <p className="error" role="alert">{state.message}</p>
        <Link className="btn" to="/">Về danh sách</Link>
      </main>
    );
  }

  const { join } = state;
  const isTeacher = join.role === "teacher";

  return (
    <div className={`room ${join.mode}`}>
      <header className="bar">
        <Link to="/" className="ghost btn small">← Thoát</Link>
        <span className="muted">
          {join.mode === "board" ? "Chế độ bảng viết (tablet)" : "Phòng học"}
        </span>
        {isTeacher && join.mode === "main" && (
          <button className="danger small" onClick={() => setEnding((v) => !v)}>Kết thúc buổi học</button>
        )}
      </header>

      {ending && (
        <div className="card stack">
          <label>
            Nội dung đã dạy
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
          </label>
          <label>
            Bài về nhà
            <textarea value={homework} onChange={(e) => setHomework(e.target.value)} rows={2} />
          </label>
          {endError && <p className="error" role="alert">{endError}</p>}
          <button onClick={() => void onEnd()}>Xác nhận kết thúc</button>
        </div>
      )}

      <div className="room-body">
        {join.livekit && (
          <Suspense fallback={<p className="center">Đang tải video…</p>}>
            <VideoPanel
              url={join.livekit.url}
              token={join.livekit.token}
              onDisconnected={() => undefined}
            />
          </Suspense>
        )}
        <Suspense fallback={<p className="center">Đang tải bảng viết…</p>}>
          <Whiteboard url={join.whiteboard.url} token={join.whiteboard.token} />
        </Suspense>
      </div>
    </div>
  );
}
