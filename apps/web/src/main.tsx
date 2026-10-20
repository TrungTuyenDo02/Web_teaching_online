import { StrictMode, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { ToastProvider } from "./ui/Feedback";
import "@fontsource-variable/nunito";
import "./styles/tokens.css";
import "./styles/global.css";

// Excalidraw mặc định tải font từ CDN (esm.sh): trỏ về bản sao trong web (vite.config.ts chép từ
// node_modules), để trình duyệt học sinh không gọi bên thứ ba và bảng vẫn đúng chữ khi CDN bị chặn
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

async function boot() {
  let Auth: ComponentType<{ children: ReactNode }> = AuthProvider;
  // Chế độ xem trước bằng dữ liệu minh họa: chỉ trong bản development. Vite thay import.meta.env.DEV
  // bằng false khi build production nên khối này và src/dev/ không có trong bản phát hành.
  if (import.meta.env.DEV) {
    // Trang thử bảng viết với máy chủ bảng thử cục bộ: không qua đăng nhập, không cần Supabase
    if (window.location.pathname === "/dev/whiteboard") {
      const { DevWhiteboardPage } = await import("./dev/whiteboard");
      createRoot(document.getElementById("root")!).render(
        <StrictMode>
          <DevWhiteboardPage />
        </StrictMode>,
      );
      return;
    }
    const asked = new URLSearchParams(window.location.search).get("preview");
    if (asked === "off") sessionStorage.removeItem("preview");
    else if (asked === "teacher" || asked === "student") sessionStorage.setItem("preview", asked);
    const role = sessionStorage.getItem("preview");
    if (role === "teacher" || role === "student") {
      const { installPreview } = await import("./dev/preview");
      Auth = installPreview(role);
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <Auth>
          <ToastProvider>
            <App />
          </ToastProvider>
        </Auth>
      </BrowserRouter>
    </StrictMode>,
  );
}

void boot();
