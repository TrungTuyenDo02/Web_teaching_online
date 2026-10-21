import { useState } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { backend, errorMessage, type SessionItem } from "../../lib/data";
import { useAsync, useNow } from "../../lib/hooks";
import { durationMinutes, formatDateTime, formatTime, groupByDay, nextSession, relativeStart } from "../../lib/schedule";
import { Button, ButtonLink } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/Dialog";
import { Empty, ErrorState, Loading, useToast } from "../../ui/Feedback";
import { PageHeader } from "../../ui/PageHeader";
import { SessionStatus } from "../../ui/SessionStatus";
import { Window } from "../../ui/Window";
import { SessionList, sessionTitle } from "../SessionList";
import { SessionFormDialog } from "./SessionFormDialog";
import { t } from "../../lib/i18n";

export default function TeacherHome() {
  const { user } = useAuth();
  const toast = useToast();
  const now = useNow();
  const sessions = useAsync(() => backend.listUpcoming(), "Không tải được lịch học.");
  const students = useAsync(() => backend.listStudents(), "Không tải được số liệu học sinh.");
  // "new": tạo buổi mới; một buổi: đang sửa buổi đó
  const [form, setForm] = useState<"new" | SessionItem | null>(null);
  const [cancelling, setCancelling] = useState<SessionItem | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const items = sessions.data ?? [];
  const next = nextSession(items, now);
  const { today, later } = groupByDay(items, now, next);

  async function confirmCancel() {
    if (!cancelling) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await backend.cancelSession(cancelling.id);
      toast.success(t("Đã hủy buổi học."));
      setCancelling(null);
      await sessions.reload();
    } catch (err) {
      setCancelError(errorMessage(err, "Không hủy được buổi học."));
    } finally {
      setCancelBusy(false);
    }
  }

  // Số liệu chỉ lấy từ dữ liệu thật: lịch sắp tới (RLS) và danh sách học sinh (API)
  const active = students.data?.filter((s) => s.active && !s.deleting_at);
  const taught = students.data?.reduce((sum, s) => sum + s.completed_sessions, 0);
  const todayCount = today.length + (next && groupByDay([next], now).today.length ? 1 : 0);

  return (
    <>
      <PageHeader
        title={t("Chào {name}", { name: user?.name ?? "" })}
        lead={t("Lịch dạy và việc cần làm hôm nay.")}
        actions={
          <Button variant="primary" size="lg" onClick={() => setForm("new")}>
            {t("Tạo buổi học")}
          </Button>
        }
      />

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
                <div className="item__meta">
                  <span>{t("Học sinh: {name}", { name: next.student_name || "—" })}</span>
                  <span>
                    {formatDateTime(next.scheduled_start, now)}–{formatTime(next.scheduled_end)} ({t("{n} phút", { n: durationMinutes(next) })})
                  </span>
                  <SessionStatus status={next.status} />
                </div>
                <div className="btn-row">
                  <ButtonLink variant="primary" size="lg" to={`/room/${next.id}?mode=main`}>
                    {t("Vào lớp")}
                  </ButtonLink>
                  <ButtonLink size="lg" to={`/room/${next.id}?mode=board`}>
                    {t("Bảng trên tablet")}
                  </ButtonLink>
                  {next.status === "scheduled" && (
                    <>
                      <Button variant="ghost" onClick={() => setForm(next)}>
                        {t("Sửa")}
                      </Button>
                      <Button variant="ghost" onClick={() => setCancelling(next)}>
                        {t("Hủy buổi")}
                      </Button>
                    </>
                  )}
                </div>
                <p className="muted">{t("Mở \"Bảng trên tablet\" bằng tablet để viết bảng bằng bút. Chế độ này không bật camera hay micro.")}</p>
              </>
            ) : (
              <Empty title={t("Chưa có buổi học nào sắp tới.")}>
                <Button variant="primary" onClick={() => setForm("new")}>
                  {t("Tạo buổi học")}
                </Button>
              </Empty>
            )}
          </Window>

          {today.length > 0 && (
            <Window title={t("Còn lại hôm nay")} file="today.txt" variant="lavender">
              <SessionList items={today} now={now} teacher onEdit={setForm} onCancel={setCancelling} />
            </Window>
          )}
          {later.length > 0 && (
            <Window title={t("Sắp tới")} file="calendar.txt" variant="periwinkle">
              <SessionList items={later} now={now} teacher onEdit={setForm} onCancel={setCancelling} />
            </Window>
          )}
        </div>

        <Window title={t("Tổng quan")} file="stats.exe" variant="peach">
          {students.error ? (
            <ErrorState message={students.error} onRetry={() => void students.reload()} />
          ) : (
            <div className="stats">
              <Stat label={t("Buổi hôm nay")} value={sessions.data ? todayCount : undefined} />
              <Stat label={t("Buổi sắp tới")} value={sessions.data?.length} />
              <Stat label={t("Học sinh đang học")} value={active?.length} />
              <Stat label={t("Buổi đã dạy")} value={taught} />
            </div>
          )}
          <div className="btn-row">
            <ButtonLink to="/students">{t("Quản lý học sinh")}</ButtonLink>
            <ButtonLink to="/history">{t("Buổi đã học")}</ButtonLink>
          </div>
        </Window>
      </div>

      <SessionFormDialog
        open={form !== null}
        editing={form === "new" || form === null ? undefined : form}
        onClose={() => setForm(null)}
        onSaved={(message) => {
          setForm(null);
          toast.success(message);
          void sessions.reload();
        }}
      />
      <ConfirmDialog
        open={cancelling !== null}
        title={t("Hủy buổi học?")}
        confirmLabel={t("Hủy buổi học")}
        danger
        busy={cancelBusy}
        error={cancelError}
        onConfirm={() => void confirmCancel()}
        onClose={() => {
          setCancelling(null);
          setCancelError(null);
        }}
      >
        {cancelling && (
          <p>
            {t("Buổi \"{title}\" với {name} lúc {when} sẽ chuyển sang \"Đã hủy\" và vẫn được giữ trong danh sách.", {
              title: sessionTitle(cancelling),
              name: cancelling.student_name,
              when: formatDateTime(cancelling.scheduled_start, now),
            })}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="stat">
      <div className="stat__value">{value ?? "…"}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}
