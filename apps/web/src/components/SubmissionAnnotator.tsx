import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import { errorMessage } from "../lib/data";
import { lang, t } from "../lib/i18n";
import { Button } from "../ui/Button";

interface Props {
  /** URL ký (hoặc blob ở chế độ xem trước) của ảnh bài làm cần chữa. */
  imageUrl: string;
  title: string;
  onSave: (image: Blob) => Promise<void>;
  onClose: () => void;
}

const MAX_SIDE = 2560;

/** Ảnh bài làm → JPEG nền trắng, cạnh dài ≤ 2560 px. Dùng <img> để đọc được cả ảnh SVG mẫu của chế độ xem trước. */
async function loadImage(url: string) {
  const img = new Image();
  img.crossOrigin = "anonymous"; // ảnh từ Storage: canvas không bị "bẩn", xuất được
  img.src = url;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataURL: canvas.toDataURL("image/jpeg", 0.9), width: canvas.width, height: canvas.height };
}

/**
 * Chữa bài trên ảnh: ảnh bài làm khóa làm nền, giáo viên viết đè bằng bút (Excalidraw như bảng viết),
 * lưu ra một ảnh JPEG mới. Ảnh gốc của học sinh không bị sửa.
 */
export default function SubmissionAnnotator({ imageUrl, title, onSave, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    loadImage(imageUrl)
      .then(({ dataURL, width, height }) => {
        if (!alive) return;
        const fileId = "submission-image" as FileId;
        api.addFiles([{ id: fileId, dataURL: dataURL as BinaryFileData["dataURL"], mimeType: "image/jpeg", created: Date.now() }]);
        const elements = convertToExcalidrawElements([{ type: "image", fileId, x: 0, y: 0, width, height, status: "saved", scale: [1, 1], locked: true }]);
        api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
        api.scrollToContent(elements, { fitToViewport: true });
        api.setActiveTool({ type: "freedraw" });
        setReady(true);
      })
      .catch(() => alive && setError(t("Không tải được ảnh bài làm. Hãy đóng và thử lại.")));
    return () => {
      alive = false;
    };
  }, [api, imageUrl]);

  async function save() {
    if (!api) return;
    setSaving(true);
    setError("");
    try {
      const blob = await exportToBlob({
        elements: api.getSceneElements(),
        files: api.getFiles(),
        appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
        mimeType: "image/jpeg",
        quality: 0.85,
        exportPadding: 0,
      });
      await onSave(blob);
    } catch (err) {
      setError(errorMessage(err, "Chưa lưu được ảnh chữa. Hãy thử lại."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="annotator"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="board__bar">
        <strong className="annotator__title">{title}</strong>
        <span className="muted">{t("Viết đè lên ảnh bằng bút; ảnh gốc của học sinh giữ nguyên.")}</span>
        {error && <span role="alert" className="board__error">{error}</span>}
        <span className="annotator__actions">
          <Button size="sm" onClick={onClose} disabled={saving}>{t("Thôi")}</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!ready} busy={saving} busyLabel={t("Đang lưu…")}>
            {t("Lưu ảnh chữa")}
          </Button>
        </span>
      </div>
      <div className="board__canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          langCode={lang() === "en" ? "en" : "vi-VN"}
          initialData={{ appState: { currentItemRoughness: 0, currentItemStrokeWidth: 2, currentItemStrokeColor: "#e03131" } }}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false, export: false, saveAsImage: false },
            tools: { image: false },
          }}
        />
      </div>
    </dialog>
  );
}
