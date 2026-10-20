import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { BoardConnection, isSyncable, type BoardActivity, type BoardStatus } from "../lib/boardConnection";
import { t } from "../lib/i18n";

export type { BoardActivity, BoardStatus } from "../lib/boardConnection";

type RemoteElements = Parameters<typeof reconcileElements>[1];

const FLUSH_DELAY_MS = 40;

interface Options {
  url: string;
  token: string;
  onActivity?: (activity: BoardActivity) => void;
}

/**
 * Đồng bộ bảng Excalidraw qua máy chủ whiteboard-sync (giao thức ở `lib/boardConnection.ts`).
 * - Gửi phần tử đổi theo nhịp 40 ms; nhận phần tử từ máy khác và gộp bằng reconcileElements
 *   (không đưa vào lịch sử hoàn tác).
 * - Ảnh chưa được đồng bộ (cần cả `files`): gỡ khỏi bảng và báo, để không chỉ hiện ở một máy.
 */
export function useBoardSync({ url, token, onActivity }: Options) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState<BoardStatus>("connecting");
  const [peers, setPeers] = useState(1);
  const connRef = useRef<BoardConnection | null>(null);
  const flushTimer = useRef<number | undefined>(undefined);
  // Ref để đổi callback không làm nối lại kết nối
  const activityRef = useRef(onActivity);
  activityRef.current = onActivity;

  useEffect(() => {
    if (!api) return;
    if (!url) {
      setStatus("preview"); // xem trước: vẽ được trên máy này, không gửi đi đâu
      return;
    }
    const conn = new BoardConnection(
      url,
      token,
      {
        elements: () => api.getSceneElementsIncludingDeleted(),
        applyRemote: (remote) => {
          const merged = reconcileElements(
            api.getSceneElementsIncludingDeleted(),
            remote as unknown as RemoteElements,
            api.getAppState(),
          );
          api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        },
      },
      { onStatus: setStatus, onPeers: setPeers, onActivity: (a) => activityRef.current?.(a) },
    );
    connRef.current = conn;
    conn.start();
    // Tab ẩn/thiết bị ngủ thì timer bị hoãn: khi quay lại, hỏi lại máy chủ thay vì tin pong cũ
    const recheck = () => document.visibilityState === "visible" && conn.verify();
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("focus", recheck);
      conn.stop();
      connRef.current = null;
    };
  }, [api, url, token]);

  /** Gắn vào prop onChange của <Excalidraw />. */
  const onChange = useCallback(() => {
    if (!api) return;
    const elements = api.getSceneElementsIncludingDeleted();
    if (elements.some((el) => !isSyncable(el))) {
      // Chặn mọi đường chèn ảnh (nút, dán, kéo thả): ảnh chưa gửi được sang máy khác
      api.updateScene({ elements: elements.filter(isSyncable), captureUpdate: CaptureUpdateAction.NEVER });
      api.setToast({ message: t("Bảng viết chưa hỗ trợ chèn ảnh. Ảnh đã được gỡ khỏi bảng."), duration: 5000 });
      return;
    }
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      connRef.current?.flush();
    }, FLUSH_DELAY_MS);
  }, [api]);

  return { api, setApi, onChange, status, peers };
}
