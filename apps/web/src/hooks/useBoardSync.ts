import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";

type RemoteElements = Parameters<typeof reconcileElements>[1];

export type BoardStatus = "connecting" | "online" | "offline";

const FLUSH_DELAY_MS = 40;
const MAX_RETRY_DELAY_MS = 10_000;
const CLOSE_AUTH_FAILED = 4401;

interface Options {
  url: string;
  token: string;
}

/**
 * Đồng bộ bảng Excalidraw qua máy chủ whiteboard-sync.
 * - Gửi các phần tử có version mới hơn bản đã gửi/nhận (gộp theo nhịp 40 ms).
 * - Nhận phần tử từ máy khác và gộp bằng reconcileElements (không đưa vào lịch sử hoàn tác).
 * - Rớt mạng thì tự nối lại; sau khi nối lại gửi nốt phần chưa gửi.
 */
export function useBoardSync({ url, token }: Options) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState<BoardStatus>("connecting");
  const [peers, setPeers] = useState(1);
  const socketRef = useRef<WebSocket | null>(null);
  const sentVersions = useRef(new Map<string, number>());
  const flushTimer = useRef<number | undefined>(undefined);

  const flushNow = useCallback(() => {
    const socket = socketRef.current;
    if (!api || !socket || socket.readyState !== WebSocket.OPEN) return;
    const changed = api
      .getSceneElementsIncludingDeleted()
      .filter((el) => (sentVersions.current.get(el.id) ?? -1) < el.version);
    if (changed.length === 0) return;
    socket.send(JSON.stringify({ type: "update", elements: changed }));
    for (const el of changed) sentVersions.current.set(el.id, el.version);
  }, [api]);

  const applyRemote = useCallback(
    (remote: unknown[]) => {
      if (!api) return;
      const merged = reconcileElements(
        api.getSceneElementsIncludingDeleted(),
        remote as RemoteElements,
        api.getAppState(),
      );
      for (const el of remote as { id: string; version: number }[]) {
        sentVersions.current.set(el.id, el.version); // đã có trên máy chủ, không gửi lại
      }
      api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [api],
  );

  /** Gắn vào prop onChange của <Excalidraw />. */
  const onChange = useCallback(() => {
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      flushNow();
    }, FLUSH_DELAY_MS);
  }, [flushNow]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      setStatus("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ type: "auth", token }));
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as {
          type: string;
          elements?: unknown[];
          peers?: number;
          count?: number;
        };
        if (msg.type === "init") {
          setStatus("online");
          setPeers(msg.peers ?? 1);
          applyRemote(msg.elements ?? []);
          flushNow();
        } else if (msg.type === "update") {
          applyRemote(msg.elements ?? []);
        } else if (msg.type === "peers") {
          setPeers(msg.count ?? 1);
        }
      };
      socket.onclose = (event) => {
        if (disposed) return;
        setStatus("offline");
        if (event.code === CLOSE_AUTH_FAILED) return; // token sai/hết hạn: vào lại phòng để lấy token mới
        retryTimer = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, MAX_RETRY_DELAY_MS));
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [api, url, token, applyRemote, flushNow]);

  return { api, setApi, onChange, status, peers };
}
