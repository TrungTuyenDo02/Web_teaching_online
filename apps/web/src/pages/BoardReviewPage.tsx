import { lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { backend } from "../lib/data";
import { useAsync } from "../lib/hooks";
import { ButtonLink } from "../ui/Button";
import { ErrorState, Loading } from "../ui/Feedback";
import { t } from "../lib/i18n";

// Excalidraw nặng: chỉ tải khi mở trang xem lại
const BoardViewer = lazy(() => import("../components/BoardViewer"));

/** Xem lại bảng cuối buổi (chỉ xem), toàn màn hình như phòng học. */
export default function BoardReviewPage() {
  const { sessionId = "" } = useParams();
  const board = useAsync(() => backend.loadBoard(sessionId), "Không tải được bảng đã lưu.");

  return (
    <div className="room">
      <header className="room__bar">
        <ButtonLink size="sm" to="/history">
          ← {t("Buổi đã học")}
        </ButtonLink>
        <h1 className="room__title">{t("Bảng cuối buổi (chỉ xem)")}</h1>
      </header>
      {board.error ? (
        <ErrorState message={board.error} onRetry={() => void board.reload()} />
      ) : !board.data ? (
        <Loading label={t("Đang tải bảng…")} />
      ) : (
        <Suspense fallback={<Loading label={t("Đang mở bảng…")} />}>
          <BoardViewer elements={board.data} />
        </Suspense>
      )}
    </div>
  );
}
