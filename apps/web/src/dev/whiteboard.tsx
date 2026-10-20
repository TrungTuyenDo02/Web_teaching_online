/**
 * Trang thử bảng viết /dev/whiteboard — CHỈ bản development (main.tsx nạp khi import.meta.env.DEV).
 * Dùng đúng component Whiteboard và máy chủ whiteboard-sync thật, chạy cục bộ bằng
 * `make dev-board-local` (services/whiteboard-sync/dev/local-board.ts). Token do máy chủ thử ký;
 * trang này không có khóa ký. Không cần Supabase, API hay LiveKit.
 *
 * "Đã kết nối máy chủ" (thanh của Whiteboard) khác "nét đã tới tab kia": tab nhận báo lại qua
 * BroadcastChannel (chỉ giữa các tab cùng trình duyệt) để tab giáo viên thấy nét đã đến nơi.
 * Thiết bị khác (tablet qua Wi-Fi, `make dev-board-lan`) không báo về được: trang ghi rõ giới hạn này.
 * Chế độ Wi-Fi: máy chủ thử nằm cùng host với trang (IP laptop) và đòi mã ghép nối in ở cửa sổ chạy nó.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { BoardActivity } from "../hooks/useBoardSync";
import { Button } from "../ui/Button";
import { Alert, Loading } from "../ui/Feedback";
import { Field } from "../ui/Field";

const Whiteboard = lazy(() => import("../components/Whiteboard"));

// Máy chủ thử cùng máy với web: mở bằng IP laptop (tablet) thì gọi đúng IP đó, không phải localhost của tablet
const LOOPBACK = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const DEV_HOST = LOOPBACK ? "127.0.0.1" : window.location.hostname;
// Test trình duyệt tự động chạy máy chủ thử ở cổng ngẫu nhiên (e2e/global-setup.ts)
const DEV_SERVER = `http://${DEV_HOST}:${import.meta.env.VITE_DEV_BOARD_TOKEN_PORT || 8789}`;
const PAIR_KEY = "gia-su-dev-pair"; // mã ghép nối của lần chạy máy chủ thử, chỉ trong tab (sessionStorage)
const readPair = () => {
  try {
    return sessionStorage.getItem(PAIR_KEY) ?? "";
  } catch {
    return "";
  }
};
const savePair = (code: string) => {
  try {
    if (code) sessionStorage.setItem(PAIR_KEY, code);
    else sessionStorage.removeItem(PAIR_KEY);
  } catch {
    // trình duyệt chặn lưu: vẫn dùng mã trong bộ nhớ của trang
  }
};
// Hai cách giả lập mất kết nối: máy chủ cắt hẳn (có sự kiện close) và đường truyền treo (không có gì)
const SIMULATIONS = {
  pause: {
    seconds: 10,
    label: "Ngắt máy chủ thử 10 giây",
    query: (room: string) => `/pause?room=${room}&seconds=10`,
    note: "Máy chủ thử cắt kết nối của phòng (trình duyệt biết ngay)",
  },
  // 40 giây: đủ để máy chủ gỡ kết nối treo (15–30 giây) trước khi khôi phục
  hang: {
    seconds: 40,
    label: "Treo đường truyền tab này 40 giây",
    query: (_room: string, line: string) => `/hang?line=${line}&seconds=40`,
    note: "Đường truyền tab này treo: kết nối không đóng, chỉ ngừng chuyển dữ liệu (như mất sóng); bảng tự phát hiện trong khoảng 15 giây, tab kia thấy bớt một thiết bị trong khoảng 30 giây",
  },
} as const;
type Simulation = keyof typeof SIMULATIONS;
const ROOMS = ["dev-1", "dev-2"] as const;
type Role = "teacher" | "student";
const ROLE_LABEL: Record<Role, string> = { teacher: "Giáo viên — được viết", student: "Học sinh — chỉ xem" };
const ROLE_SHORT: Record<Role, string> = { teacher: "giáo viên", student: "học sinh" };

interface Ack {
  room: string;
  role: Role;
  keys: string[];
  at: number;
}

const keyOf = (el: { id: string; version: number }) => `${el.id}:${el.version}`;
const clock = (at: number) => new Date(at).toLocaleTimeString("vi-VN");

function readParams(): { role: Role; room: string } {
  const q = new URLSearchParams(window.location.search);
  const role = q.get("role") === "student" ? "student" : "teacher";
  // Phòng dev-* bất kỳ (máy chủ thử chỉ nhận mẫu này): test trình duyệt dùng phòng riêng cho mỗi test
  const asked = q.get("room") ?? "";
  const room = /^dev-[a-z0-9-]{1,40}$/.test(asked) ? asked : ROOMS[0];
  return { role, room };
}

// Test trình duyệt đọc nội dung bảng của tab nhận (không chỉ trạng thái kết nối hay BroadcastChannel)
const exposeApi = (api: unknown) => {
  (window as unknown as { __devBoardApi?: unknown }).__devBoardApi = api;
};

const pageUrl = (role: Role, room: string) => `/dev/whiteboard?role=${role}&room=${room}`;
const pairQuery = (pair: string) => (pair ? `&pair=${encodeURIComponent(pair)}` : "");

export function DevWhiteboardPage() {
  const [{ role, room }, setParams] = useState(readParams);
  const [conn, setConn] = useState<{ url: string; token: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Đếm phần tử khác nhau (một nét bút được gửi lại nhiều lần khi đang viết)
  const [sent, setSent] = useState<{ ids: Set<string>; at: number; keys: string[] } | null>(null);
  const [received, setReceived] = useState<{ kind: string; ids: Set<string>; at: number } | null>(null);
  const [simulating, setSimulating] = useState<{ kind: Simulation; until: number } | null>(null);
  const [simError, setSimError] = useState("");
  const [pair, setPair] = useState(readPair);
  const [needPair, setNeedPair] = useState(false);
  const [pairInput, setPairInput] = useState("");
  // Id đường truyền riêng của tab này (proxy thử dùng để treo đúng tab), đổi khi tải lại trang
  const [line] = useState(() => Math.random().toString(36).slice(2, 12).padEnd(10, "0"));
  const [ack, setAck] = useState<{ keys: Set<string>; at: number } | null>(null);
  const [channel, setChannel] = useState<BroadcastChannel | null>(null);
  const canBroadcast = "BroadcastChannel" in window;
  const other: Role = role === "teacher" ? "student" : "teacher";

  // Tạo kênh trong effect: StrictMode gắn/gỡ effect hai lần, kênh tạo một lần rồi đóng sẽ không dùng lại được
  useEffect(() => {
    if (!canBroadcast) return;
    const ch = new BroadcastChannel("gia-su-dev-board");
    setChannel(ch);
    return () => ch.close();
  }, [canBroadcast]);

  // Đổi vai trò/phòng: giữ trên URL để tải lại tab vẫn đúng chỗ
  const choose = (next: { role: Role; room: string }) => {
    window.history.replaceState(null, "", pageUrl(next.role, next.room));
    setParams(next);
  };

  useEffect(() => {
    let cancelled = false;
    setConn(null);
    setError("");
    setSent(null);
    setReceived(null);
    setAck(null);
    setNeedPair(false);
    fetch(`${DEV_SERVER}/token?role=${role}&room=${room}&line=${line}${pairQuery(pair)}`)
      .then((res) => {
        if (res.status === 401) {
          // Chế độ Wi-Fi: chưa có mã, gõ sai, hoặc máy chủ thử đã chạy lại (mã mới)
          if (!cancelled) setNeedPair(true);
          return null;
        }
        if (res.status === 403) {
          const port = window.location.port || "80";
          throw new Error(
            LOOPBACK
              ? `Máy chủ bảng thử không nhận trang ở cổng ${port}. Tắt nó rồi chạy: cd services/whiteboard-sync && npm run dev:local -- --web-port=${port}`
              : `Máy chủ bảng thử không nhận trang ở ${window.location.host}. Trên laptop chạy lại: make dev-board-lan LAN_IP=${DEV_HOST} WEB_PORT=${port}`,
          );
        }
        if (!res.ok) throw new Error(`Máy chủ bảng thử trả lỗi ${res.status}.`);
        return res.json() as Promise<{ url: string; token: string }>;
      })
      .then((data) => !cancelled && data && setConn(data))
      .catch((err: unknown) => {
        if (cancelled) return;
        // fetch lỗi mạng (TypeError): máy chủ thử chưa chạy, khác IP, hoặc firewall chặn cổng 8789
        setError(
          err instanceof TypeError
            ? LOOPBACK
              ? "Không kết nối được máy chủ bảng thử (127.0.0.1:8789). Hãy chạy make dev-board-local rồi bấm Thử lại."
              : `Trang web đã tải nhưng không gọi được máy chủ cấp token ${DEV_HOST}:8789. Trên laptop: make dev-board-lan LAN_IP=${DEV_HOST} có đang chạy không, firewall có chặn cổng 8789 không.`
            : String((err as Error).message),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [role, room, attempt, line, pair]);

  // Tab khác cùng phòng báo đã nhận nét
  useEffect(() => {
    if (!channel) return;
    channel.onmessage = (event: MessageEvent<Ack>) => {
      const msg = event.data;
      if (msg.room !== room || msg.role === role) return;
      setAck((prev) => ({ keys: new Set([...(prev?.keys ?? []), ...msg.keys]), at: msg.at }));
    };
  }, [channel, room, role]);

  const onActivity = useCallback(
    (activity: BoardActivity) => {
      const at = Date.now();
      const keys = activity.elements.map(keyOf);
      const ids = activity.elements.map((el) => el.id);
      if (activity.kind === "sent") {
        setSent((prev) => ({ ids: new Set([...(prev?.ids ?? []), ...ids]), at, keys }));
        return;
      }
      if (keys.length === 0) return;
      setReceived((prev) => ({ kind: activity.kind, ids: new Set([...(prev?.ids ?? []), ...ids]), at }));
      channel?.postMessage({ room, role, keys, at } satisfies Ack);
    },
    [channel, room, role],
  );

  const delivered = sent && ack ? sent.keys.every((k) => ack.keys.has(k)) : false;

  async function simulate(kind: Simulation) {
    const sim = SIMULATIONS[kind];
    setSimError("");
    try {
      const res = await fetch(`${DEV_SERVER}${sim.query(room, line)}${pairQuery(pair)}`, { method: "POST" });
      if (res.status === 409) return setSimError("Đang giả lập mất kết nối, chờ hết lượt này rồi thử tiếp.");
      if (!res.ok) throw new Error(String(res.status));
      const until = Date.now() + sim.seconds * 1000;
      setSimulating({ kind, until });
      setTimeout(() => setSimulating((v) => (v?.until === until ? null : v)), sim.seconds * 1000);
    } catch {
      setSimError("Không gọi được máy chủ bảng thử để giả lập mất kết nối.");
    }
  }

  return (
    <div className="room devboard">
      <div className="preview-banner" role="note">
        Phòng thử cục bộ — dữ liệu giả · phòng {room} · {ROLE_SHORT[role]}
      </div>

      <div className="room__bar">
        <div className="devboard__group" role="group" aria-label="Vai trò ở tab này">
          {(["teacher", "student"] as const).map((r) => (
            <Button key={r} size="sm" variant={r === role ? "primary" : "secondary"} aria-pressed={r === role} onClick={() => choose({ role: r, room })}>
              {ROLE_LABEL[r]}
            </Button>
          ))}
        </div>
        <div className="devboard__group" role="group" aria-label="Phòng thử">
          <span className="devboard__label">Phòng:</span>
          {ROOMS.map((r) => (
            <Button key={r} size="sm" variant={r === room ? "primary" : "secondary"} aria-pressed={r === room} onClick={() => choose({ role, room: r })}>
              {r}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="accent" onClick={() => window.open(pageUrl(other, room), "_blank")}>
          Mở tab {ROLE_SHORT[other]}
        </Button>
        {(Object.keys(SIMULATIONS) as Simulation[]).map((kind) => (
          <Button key={kind} size="sm" onClick={() => void simulate(kind)} disabled={simulating !== null || !conn}>
            {SIMULATIONS[kind].label}
          </Button>
        ))}
      </div>

      <div className="room__bar devboard__sync" aria-live="polite">
        <span>
          <strong>Đã gửi lên máy chủ:</strong> {sent ? `${sent.ids.size} phần tử, lần cuối ${clock(sent.at)}` : "chưa có"}
        </span>
        <span>
          <strong>Đã nhận từ máy chủ:</strong>{" "}
          {received ? `${received.ids.size} phần tử, lần cuối ${clock(received.at)}${received.kind === "init" ? " (nội dung có sẵn khi vào)" : ""}` : "chưa có"}
        </span>
        {role === "teacher" && (
          <span>
            <strong>Tab học sinh cùng trình duyệt:</strong>{" "}
            {!sent ? (
              "chưa viết nét nào"
            ) : delivered ? (
              <span className="devboard__ok">đã nhận nét mới nhất ({clock(ack!.at)})</span>
            ) : (
              <span className="devboard__wait">chưa xác nhận nét mới nhất</span>
            )}
          </span>
        )}
        {role === "teacher" && !LOOPBACK && <span>Máy khác (tablet/laptop kia) không báo về đây: nhìn nét trên máy đó.</span>}
        {!canBroadcast && <span>Trình duyệt không hỗ trợ xác nhận giữa các tab.</span>}
        {simulating && (
          <span className="devboard__wait">
            {SIMULATIONS[simulating.kind].note}, đến {clock(simulating.until)}. Cứ viết tiếp: nét sẽ được gửi bù khi nối lại.
          </span>
        )}
        {simError && <span role="alert">{simError}</span>}
      </div>

      {needPair ? (
        <form
          className="devboard__pair"
          onSubmit={(event) => {
            event.preventDefault();
            const code = pairInput.trim();
            if (!code) return;
            savePair(code);
            setPair(code);
            setAttempt((n) => n + 1);
          }}
        >
          <Field
            label="Mã ghép nối"
            hint="In ở cửa sổ chạy make dev-board-lan trên laptop (dạng ABCD-EFGH). Đổi mỗi lần chạy lại máy chủ thử."
            error={pair ? "Mã không đúng hoặc máy chủ thử đã chạy lại. Nhập mã đang hiện trên laptop." : null}
          >
            {(control) => (
              <input
                {...control}
                value={pairInput}
                onChange={(event) => setPairInput(event.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Button type="submit" variant="primary">
            Ghép nối
          </Button>
        </form>
      ) : error ? (
        <Alert tone="error" action={<Button size="sm" onClick={() => setAttempt((n) => n + 1)}>Thử lại</Button>}>
          {error}
        </Alert>
      ) : !conn ? (
        <Loading label="Đang lấy token thử…" />
      ) : (
        <div className="room__body">
          <Suspense fallback={<Loading label="Đang tải bảng viết…" />}>
            <Whiteboard key={`${role}-${room}`} url={conn.url} token={conn.token} readOnly={role === "student"} onActivity={onActivity} onApi={exposeApi} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
