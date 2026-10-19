import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useBoardSync, type BoardStatus } from "../hooks/useBoardSync";

interface Props {
  url: string;
  token: string;
}

const statusText: Record<BoardStatus, string> = {
  connecting: "Đang kết nối bảng…",
  online: "Bảng đã kết nối",
  offline: "Mất kết nối, đang thử lại",
};

export default function Whiteboard({ url, token }: Props) {
  const { api, setApi, onChange, status, peers } = useBoardSync({ url, token });

  async function downloadPng() {
    if (!api) return;
    const blob = await exportToBlob({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), exportBackground: true },
      files: api.getFiles(),
      mimeType: "image/png",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bang-viet-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="board">
      <div className="board-bar">
        <span className={`dot ${status}`} aria-hidden />
        <span>{statusText[status]}</span>
        <span className="muted">· {peers} thiết bị</span>
        <button className="ghost small" onClick={() => void downloadPng()}>Tải ảnh bảng</button>
      </div>
      <div className="board-canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          onChange={onChange}
          langCode="vi-VN"
          initialData={{
            // Nét thẳng, rõ cho môn Toán (mặc định của Excalidraw là kiểu vẽ tay nguệch ngoạc)
            appState: { currentItemRoughness: 0, currentItemStrokeWidth: 2 },
          }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false } }}
        />
      </div>
    </section>
  );
}
