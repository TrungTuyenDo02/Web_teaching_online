import { useAuth } from "../../auth/AuthProvider";
import { backend } from "../../lib/data";
import { useAsync, useNow } from "../../lib/hooks";
import { durationMinutes, formatDateTime, formatTime, groupByDay, nextSession, relativeStart } from "../../lib/schedule";
import { ButtonLink } from "../../ui/Button";
import { Empty, ErrorState, Loading } from "../../ui/Feedback";
import { PageHeader } from "../../ui/PageHeader";
import { Window } from "../../ui/Window";
import { SessionList, sessionTitle } from "../SessionList";
import { StudentAssignments } from "./StudentAssignments";
import { t } from "../../lib/i18n";

/** Trang chính học sinh: buổi tiếp theo + nút vào lớp, buổi sắp học, bài về nhà gần nhất. */
export default function StudentHome() {
  const { user } = useAuth();
  const now = useNow();
  const sessions = useAsync(() => backend.listUpcoming(), "Không tải được lịch học.");
  const history = useAsync(() => backend.listHistory(), "Không tải được buổi đã học.");

  const items = sessions.data ?? [];
  const next = nextSession(items, now);
  const { today, later } = groupByDay(items, now, next);
  const rest = [...today, ...later];
  const latest = history.data?.find((s) => s.homework_note || s.summary);

  return (
    <>
      <PageHeader title={t("Chào {name}", { name: user?.name ?? "" })} lead={t("Lịch học của em và bài về nhà.")} />

      {sessions.error && <ErrorState message={sessions.error} onRetry={() => void sessions.reload()} />}

      <div className="grid-2">
        <div className="stack">
          <Window title={t("Buổi học tiếp theo")} file="next_class.exe" variant="mint" className="hero">
            {sessions.loading && !sessions.data ? (
              <Loading label={t("Đang tải lịch học…")} />
            ) : next ? (
              <>
                <p className="hero__when">{relativeStart(next, now)}</p>
                <p className="hero__title">{sessionTitle(next)}</p>
                <p className="item__meta">
                  {formatDateTime(next.scheduled_start, now)}–{formatTime(next.scheduled_end)} ({t("{n} phút", { n: durationMinutes(next) })})
                </p>
                <div className="btn-row">
                  <ButtonLink variant="primary" size="lg" to={`/room/${next.id}?mode=main`}>
                    {t("Vào lớp")}
                  </ButtonLink>
                </div>
                <p className="muted">{t("Phòng mở trước giờ học ít phút. Khi trình duyệt hỏi, em hãy cho phép dùng camera và micro.")}</p>
              </>
            ) : (
              <Empty title={t("Chưa có buổi học nào sắp tới.")}>
                <p className="muted">{t("Khi thầy cô xếp lịch, buổi học sẽ hiện ở đây.")}</p>
              </Empty>
            )}
          </Window>

          {rest.length > 0 && (
            <Window title={t("Buổi sắp học")} file="calendar.txt" variant="periwinkle">
              <SessionList items={rest} now={now} teacher={false} />
            </Window>
          )}
          <StudentAssignments />
        </div>

        <Window title={t("Bài về nhà gần nhất")} file="homework.txt" variant="peach">
          {history.error ? (
            <ErrorState message={history.error} onRetry={() => void history.reload()} />
          ) : history.loading && !history.data ? (
            <Loading />
          ) : latest ? (
            <>
              <p className="item__title">{sessionTitle(latest)}</p>
              <p className="muted">{formatDateTime(latest.scheduled_start, now)}</p>
              {latest.summary && (
                <p>
                  <strong>{t("Đã học:")}</strong> {latest.summary}
                </p>
              )}
              {latest.homework_note && (
                <div className="homework">
                  <strong>{t("Bài về nhà:")}</strong> {latest.homework_note}
                </div>
              )}
              <div className="btn-row">
                {latest.board_snapshot_path && <ButtonLink to={`/history/${latest.id}/board`}>{t("Xem lại bảng")}</ButtonLink>}
                <ButtonLink variant="ghost" to="/history">
                  {t("Tất cả buổi đã học")}
                </ButtonLink>
              </div>
            </>
          ) : (
            <Empty title={t("Chưa có bài về nhà.")} />
          )}
        </Window>
      </div>
    </>
  );
}
