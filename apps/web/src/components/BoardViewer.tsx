import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { lang, t } from "../lib/i18n";

/** Hiển thị bảng đã lưu ở chế độ chỉ xem (vẫn phóng to, kéo được). */
export default function BoardViewer({ elements }: { elements: unknown[] }) {
  return (
    <section className="board board--review" aria-label={t("Bảng đã lưu")}>
      <div className="board__canvas">
        <Excalidraw
          initialData={{ elements: elements as ExcalidrawInitialDataState["elements"], scrollToContent: true }}
          viewModeEnabled
          langCode={lang() === "en" ? "en" : "vi-VN"}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } }}
        />
      </div>
    </section>
  );
}
