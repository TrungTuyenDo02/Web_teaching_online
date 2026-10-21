import { useAuth } from "../auth/AuthProvider";
import { backend } from "../lib/data";
import { useAsync, useNow } from "../lib/hooks";
import { formatDateTime } from "../lib/schedule";
import { AppShell } from "../ui/AppShell";
import { ButtonLink } from "../ui/Button";
import { Empty, ErrorState, Loading } from "../ui/Feedback";
import { Window } from "../ui/Window";
import { sessionTitle } from "./SessionList";
import { t } from "../lib/i18n";

/** Buổi đã học: nội dung, bài về nhà, xem lại bảng. RLS lọc: học sinh chỉ thấy buổi của mình. */
export default function HistoryPage() {
  const { user } = useAuth();
  const teacher = user?.role === "teacher";
  const now = useNow();
  const history = useAsync(() => backend.listHistory(), "Không tải được buổi đã học.");

  return (
    <AppShell title={t("Buổi đã học")}>
      <div className="page__head">
        <div>
          <h1>{t("Buổi đã học")}</h1>
          <p className="page__lead">{teacher ? t("Nội dung đã dạy, bài về nhà và bảng cuối buổi.") : t("Nội dung đã học, bài về nhà và bảng của từng buổi.")}</p>
        </div>
        {teacher && <ButtonLink to="/teaching-notes">{t("Ghi chú riêng và chủ đề")}</ButtonLink>}
      </div>
      <Window title={t("Lịch sử buổi học")} file="history.log" variant="lavender">
        {history.error ? (
          <ErrorState message={history.error} onRetry={() => void history.reload()} />
        ) : history.loading && !history.data ? (
          <Loading label={t("Đang tải buổi đã học…")} />
        ) : history.data?.length === 0 ? (
          <Empty title={t("Chưa có buổi học nào kết thúc.")} />
        ) : (
          <ul className="items">
            {history.data?.map((item) => (
              <li key={item.id} className="item">
                <div className="item__top">
                  <span className="item__title" id={`past-${item.id}`}>{sessionTitle(item)}</span>
                  <span className="muted">{formatDateTime(item.scheduled_start, now)}</span>
                </div>
                {teacher && <div className="item__meta">{t("Học sinh: {name}", { name: item.student_name || "—" })}</div>}
                {item.summary ? (
                  <p>
                    <strong>{teacher ? t("Đã dạy:") : t("Đã học:")}</strong> {item.summary}
                  </p>
                ) : (
                  <p className="muted">{t("Chưa ghi nội dung buổi này.")}</p>
                )}
                {item.homework_note && (
                  <div className="homework">
                    <strong>{t("Bài về nhà:")}</strong> {item.homework_note}
                  </div>
                )}
                <div className="btn-row">
                  {item.board_snapshot_path ? (
                    <ButtonLink size="sm" to={`/history/${item.id}/board`} aria-describedby={`past-${item.id}`}>
                      {t("Xem lại bảng")}
                    </ButtonLink>
                  ) : (
                    <span className="muted">{t("Không có bảng đã lưu")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Window>
    </AppShell>
  );
}
