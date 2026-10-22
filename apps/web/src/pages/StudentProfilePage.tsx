import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { backend } from "../lib/data";
import { useAsync, useNow } from "../lib/hooks";
import { t } from "../lib/i18n";
import { formatDateTime } from "../lib/schedule";
import { AppShell } from "../ui/AppShell";
import { Badge } from "../ui/Badge";
import { ButtonLink } from "../ui/Button";
import { Alert, Empty, ErrorState, Loading } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Window } from "../ui/Window";
import { AssignmentStatus } from "./AssignmentsPage";
import { sessionTitle } from "./SessionList";
import { WEEKDAYS } from "./teacher/WeeklySlotsDialog";

/** Gom dữ liệu sẵn có của một học sinh; RLS chỉ trả học sinh của giáo viên đang đăng nhập. */
async function loadProfile(studentId: string) {
  // shortcut: lọc phía trình duyệt từ danh sách của cả lớp (một giáo viên, vài chục học sinh); nhiều hơn thì lọc ở truy vấn
  const [students, upcoming, history, assignments, slots] = await Promise.all([
    backend.listStudents(),
    backend.listUpcoming(),
    backend.listHistory(studentId),
    backend.listAssignments(),
    backend.listWeeklySlots(),
  ]);
  const student = students.find((s) => s.id === studentId && !s.deleting_at);
  if (!student) return null;
  return {
    student,
    upcoming: upcoming.filter((s) => s.student_id === studentId),
    history,
    assignments: assignments.filter((a) => a.student_id === studentId),
    slots: slots.filter((s) => s.student_id === studentId && s.active),
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Profile({ studentId }: { studentId: string }) {
  const now = useNow();
  const data = useAsync(() => loadProfile(studentId), "Không tải được hồ sơ học sinh.");
  if (data.error) return <ErrorState message={data.error} onRetry={() => void data.reload()} />;
  if (data.loading && data.data === undefined) return <Loading label={t("Đang tải hồ sơ…")} />;
  if (!data.data) return <Empty title={t("Không tìm thấy học sinh.")}><ButtonLink to="/students">{t("Danh sách học sinh")}</ButtonLink></Empty>;
  const { student: s, upcoming, history, assignments, slots } = data.data;

  return (
    <>
      <PageHeader
        title={s.full_name}
        lead={[s.grade && t("Lớp {grade}", { grade: s.grade }), s.active ? t("Đang học") : t("Ngừng dạy")].filter(Boolean).join(" · ")}
        actions={
          <>
            <ButtonLink to={`/teaching-notes?student=${s.id}`}>{t("Ghi chú riêng và chủ đề")}</ButtonLink>
            <ButtonLink to="/students">{t("Danh sách học sinh")}</ButtonLink>
          </>
        }
      />
      <div className="grid-2">
        <div className="stack">
          <Window title={t("Buổi đã học")} file="history.log" variant="lavender">
            {!history.length ? (
              <Empty title={t("Chưa có buổi nào đã kết thúc.")} />
            ) : (
              <ul className="items">
                {history.map((h) => (
                  <li key={h.id} className="item">
                    <div className="item__top">
                      <span className="item__title" id={`past-${h.id}`}>{sessionTitle(h)}</span>
                      <span className="muted">{formatDateTime(h.scheduled_start, now)}</span>
                    </div>
                    {h.summary && <p className="prose-text">{h.summary}</p>}
                    {h.homework_note && <p className="muted">{t("Bài về nhà: {text}", { text: h.homework_note })}</p>}
                    {h.board_snapshot_path && (
                      <div className="btn-row">
                        <ButtonLink size="sm" to={`/history/${h.id}/board`} aria-describedby={`past-${h.id}`}>{t("Xem lại bảng")}</ButtonLink>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Window>
          <Window title={t("Bài tập")} file="homework.db" variant="peach">
            {!assignments.length ? (
              <Empty title={t("Chưa giao bài nào.")} />
            ) : (
              <ul className="items">
                {assignments.map((a) => {
                  const latest = a.submissions[0];
                  return (
                    <li key={a.id} className="item">
                      <div className="item__top">
                        <span className="item__title">{a.title}</span>
                        <AssignmentStatus item={a} />
                      </div>
                      <div className="item__meta">
                        {a.due_at && <span>{t("Hạn nộp: {when}", { when: formatDateTime(a.due_at, now) })}</span>}
                        {latest?.status === "returned" && latest.score != null && <span>{t("Điểm: {score}/10", { score: latest.score })}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Window>
        </div>
        <div className="stack">
          <Window title={t("Hồ sơ")} file="profile.txt" variant="mint">
            <dl className="facts">
              <Fact label={t("Mục tiêu")}>{s.goals || "—"}</Fact>
              <Fact label={t("Phụ huynh")}>{[s.guardian_name, s.guardian_contact].filter(Boolean).join(" · ") || "—"}</Fact>
              <Fact label={t("Phụ huynh đồng ý lưu dữ liệu")}>
                {s.consent_at ? formatDateTime(s.consent_at, now) : <Badge tone="warn">{t("Chưa ghi nhận phụ huynh đồng ý")}</Badge>}
              </Fact>
              <Fact label={t("Tài khoản")}>{s.profile_id ? t("Đã có tài khoản đăng nhập") : t("Chưa có tài khoản đăng nhập")}</Fact>
              <Fact label={t("Số buổi")}>{t("Đã dạy {n} buổi", { n: s.completed_sessions })}</Fact>
              <Fact label={t("Ghi chú của giáo viên")}>{s.notes ? <span className="prose-text">{s.notes}</span> : "—"}</Fact>
            </dl>
          </Window>
          <Window title={t("Lịch học")} file="schedule.ics" variant="pink">
            <div className="stack">
              {slots.length > 0 && (
                <ul className="items">
                  {slots.map((slot) => (
                    <li key={slot.id} className="item">
                      {t(WEEKDAYS[slot.weekday - 1]!)} · {slot.start_time} · {t("{n} phút", { n: slot.duration_minutes })}
                    </li>
                  ))}
                </ul>
              )}
              {!upcoming.length ? (
                <Empty title={t("Chưa có buổi sắp tới.")} />
              ) : (
                <ul className="items">
                  {upcoming.map((u) => (
                    <li key={u.id} className="item">
                      <div className="item__top">
                        <span className="item__title">{sessionTitle(u)}</span>
                        <span className="muted">{formatDateTime(u.scheduled_start, now)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Window>
        </div>
      </div>
    </>
  );
}

/** Hồ sơ một học sinh (chỉ giáo viên): thông tin, lịch, buổi đã học, bài tập và điểm. Chỉ đọc. */
export default function StudentProfilePage() {
  const { user } = useAuth();
  const { studentId = "" } = useParams();
  return (
    <AppShell title={t("Hồ sơ học sinh")}>
      {user?.role === "teacher" ? <Profile key={studentId} studentId={studentId} /> : <Alert>{t("Chỉ giáo viên được xem hồ sơ học sinh.")}</Alert>}
    </AppShell>
  );
}
