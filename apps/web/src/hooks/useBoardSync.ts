import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { BoardConnection, isSyncable, type BoardActivity, type BoardStatus } from "../lib/boardConnection";
import { t } from "../lib/i18n";
import type { BoardFile } from "../lib/boardFiles";

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
 * - Files được máy chủ xác nhận trước khi cho chèn ảnh; nhận đủ files rồi mới áp dụng phần tử ảnh.
 */
export function useBoardSync({ url, token, onActivity }: Options) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [status, setStatus] = useState<BoardStatus>("connecting");
  const [peers, setPeers] = useState(1);
  const [images, setImages] = useState(false);
  const approvedFiles = useRef(new Set<string>());
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
        files: () => api.getFiles() as unknown as Record<string, BoardFile>,
        applyFiles: (files) => {
          for (const file of files) approvedFiles.current.add(file.id);
          api.addFiles(files as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
        },
        applyRemote: (remote) => {
          const merged = reconcileElements(
            api.getSceneElementsIncludingDeleted(),
            remote as unknown as RemoteElements,
            api.getAppState(),
          );
          api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });
        },
      },
      { onStatus: setStatus, onPeers: setPeers, onImages: setImages, onFileError: message => api.setToast({ message: t(message), duration: 5000 }), onActivity: (a) => activityRef.current?.(a) },
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
      clearTimeout(flushTimer.current); flushTimer.current = undefined;
    };
  }, [api, url, token]);

  /** Gắn vào prop onChange của <Excalidraw />. */
  const onChange = useCallback(() => {
    if (!api) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const allowed = (el: typeof elements[number]) => isSyncable(el) && (el.type !== "image" || (el.fileId !== null && approvedFiles.current.has(el.fileId)));
    if (elements.some((el) => !allowed(el))) {
      // Chặn ảnh ngoài đường tải đã được máy chủ xác nhận (dán/kéo thả, dữ liệu không hợp lệ).
      api.updateScene({ elements: elements.filter(allowed), captureUpdate: CaptureUpdateAction.NEVER });
      api.setToast({ message: t("Hãy dùng nút Chèn ảnh đề bài để tải ảnh lên bảng."), duration: 5000 });
      return;
    }
    if (flushTimer.current !== undefined) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = undefined;
      connRef.current?.flush();
    }, FLUSH_DELAY_MS);
  }, [api]);

  const uploadFile = async (file: Pick<BoardFile, "mimeType" | "dataURL">) => {
    if (!connRef.current) throw new Error("Chưa sẵn sàng tải ảnh. Hãy thử lại khi bảng đã kết nối.");
    return connRef.current.uploadFile(file);
  };
  return { api, setApi, onChange, status, peers, images, uploadFile };
}
