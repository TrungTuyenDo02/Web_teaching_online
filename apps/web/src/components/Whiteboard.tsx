import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { useBoardSync, type BoardActivity, type BoardStatus } from "../hooks/useBoardSync";
import { lang, t } from "../lib/i18n";
import { Button } from "../ui/Button";
import { prepareBoardImage } from "../lib/boardImage";

interface Props {
  url: string;
  token: string;
  /** Học sinh chỉ xem bảng; máy chủ cũng bỏ qua nét vẽ từ học sinh. */
  readOnly?: boolean;
  /** Máy chủ báo giáo viên đã kết thúc buổi học. */
  onEnded?: () => void;
  /** Tùy chọn: báo đã gửi/đã nhận phần tử (trang thử /dev/whiteboard dùng để hiện đồng bộ). */
  onActivity?: (activity: BoardActivity) => void;
  /** Tùy chọn: nhận Excalidraw API khi sẵn sàng (trang thử /dev/whiteboard đưa cho test trình duyệt). */
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}

// Câu tiếng Việt là khóa dịch (lib/i18n.ts); dịch lúc vẽ
const statusText: Record<BoardStatus, string> = {
  connecting: "Đang kết nối bảng…",
  online: "Bảng đã kết nối",
  checking: "Đang kiểm tra kết nối bảng…",
  offline: "Mất kết nối, đang thử lại. Nét vẽ sẽ được gửi khi có mạng.",
  expired: "Hết phiên bảng viết. Hãy tải lại trang để vào lại.",
  ended: "Buổi học đã kết thúc",
  preview: "Xem trước: bảng không kết nối máy chủ",
};

export default function Whiteboard({ url, token, readOnly = false, onEnded, onActivity, onApi }: Props) {
  const { api, setApi, onChange, status, peers, images, uploadFile } = useBoardSync({ url, token, onActivity });
  const [exportError, setExportError] = useState("");
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  async function insertImage(file: File) {
    if (!api || readOnly || status !== "online" || !images || uploading) return;
    setUploading(true); setImageError("");
    try {
      const prepared = await prepareBoardImage(file);
      const uploaded = await uploadFile(prepared);
      const state = api.getAppState();
      const point = viewportCoordsToSceneCoords({ clientX: state.offsetLeft + state.width / 2, clientY: state.offsetTop + state.height / 2 }, state);
      const width = Math.min(prepared.width, 600 / state.zoom.value);
      const height = width * prepared.height / prepared.width;
      const elements = convertToExcalidrawElements([{ type: "image", fileId: uploaded.id as FileId, x: point.x - width / 2, y: point.y - height / 2, width, height, status: "saved", scale: [1, 1] }]);
      api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...elements], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    } catch (error) {
      setImageError(t(error instanceof Error ? error.message : "Chưa lưu được ảnh. Hãy thử lại."));
    } finally { setUploading(false); }
  }

  useEffect(() => {
    if (api) onApi?.(api);
  }, [api, onApi]);

  useEffect(() => {
    if (status === "ended") onEnded?.();
  }, [status, onEnded]);

  async function downloadPng() {
    if (!api) return;
    setExportError("");
    const elements = api.getSceneElements();
    if (elements.length === 0) return setExportError(t("Bảng đang trống, chưa có gì để tải."));
    try {
      const blob = await exportToBlob({
        elements,
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        mimeType: "image/png",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${t("bang-viet")}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
      link.click();
      // Thu hồi ngay có thể làm hỏng lượt tải trên một số trình duyệt
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch {
      setExportError(t("Không xuất được ảnh bảng. Hãy thử lại; nếu vẫn lỗi, hãy chụp màn hình bảng."));
    }
  }

  return (
    <section className="board" aria-label={t("Bảng viết")}>
      <div className="board__bar">
        <span className={`dot dot--${status}`} aria-hidden="true" />
        {/* role=status: trình đọc màn hình báo khi mất mạng hoặc hết phiên */}
        <span role="status">{t(statusText[status])}</span>
        <span className="muted">· {t("{n} thiết bị", { n: peers })}</span>
        {readOnly && <span className="muted">· {t("Chỉ xem")}</span>}
        {!readOnly && <>
          <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
            if (file) void insertImage(file);
          }} />
          <Button size="sm" disabled={!api || !images || status !== "online" || uploading} onClick={() => imageInput.current?.click()}>
            {uploading ? t("Đang tải ảnh…") : t("Chèn ảnh đề bài")}
          </Button>
        </>}
        <Button size="sm" onClick={() => void downloadPng()} disabled={!api}>
          {t("Tải ảnh bảng")}
        </Button>
        {exportError && (
          <span role="alert" className="board__error">
            {exportError}
          </span>
        )}
        {imageError && <span role="alert" className="board__error">{imageError}</span>}
      </div>
      <div className="board__canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={readOnly ? undefined : onChange}
          viewModeEnabled={readOnly}
          langCode={lang() === "en" ? "en" : "vi-VN"}
          initialData={{
            // Nét thẳng, rõ cho môn Toán (mặc định của Excalidraw là kiểu vẽ tay nguệch ngoạc)
            appState: { currentItemRoughness: 0, currentItemStrokeWidth: 2 },
          }}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
            tools: { image: false }, // dùng nút riêng để kiểm ảnh và chờ ACK; chặn đường chèn trực tiếp
          }}
        />
      </div>
    </section>
  );
}
