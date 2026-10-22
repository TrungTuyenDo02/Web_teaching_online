import { useSearchParams } from "react-router-dom";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { TeachingRecord, TeachingTopic } from "../lib/api";
import { backend } from "../lib/data";
import { useAsync } from "../lib/hooks";
import { locale, t } from "../lib/i18n";
import { teachingNotesExport } from "../lib/teachingNotesExport";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { Check } from "../ui/Check";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Alert, Empty, ErrorState, Loading, useToast } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Window } from "../ui/Window";

const noteError = (err: unknown, fallback: string) => err instanceof Error && /[À-ỹ]/.test(err.message) ? err.message : fallback;
const vnDate = (iso: string) => new Date(iso).toLocaleString(locale(), { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
function currentMonth() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

function NoteEditor({ initial, catalog, onClose, onSaved }: { initial: TeachingRecord; catalog: TeachingTopic[]; onClose: () => void; onSaved: () => void }) {
  const [record, setRecord] = useState(initial);
  const [topics, setTopics] = useState(catalog);
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const toast = useToast();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await backend.saveTeachingRecord(record.session_id, {
        expected_revision: record.revision, summary_md: record.summary_md,
        understanding_level: record.understanding_level, improve_points: record.improve_points,
        homework_text: record.homework_text, topic_ids: record.topic_ids,
      });
      toast.success(t("Đã lưu ghi chú riêng và chủ đề đã dạy."));
      onSaved();
    } catch (err) {
      setError(noteError(err, "Chưa xác nhận được kết quả lưu. Hãy tải lại bản đã lưu để kiểm tra trước khi thử lại."));
    } finally { setBusy(false); }
  }

  async function reload() {
    setBusy(true);
    try {
      const [saved, refreshedTopics] = await Promise.all([backend.getTeachingRecord(record.session_id), backend.listTeachingTopics()]);
      setRecord(saved); setTopics(refreshedTopics); setError(null);
    } catch (err) { setError(noteError(err, "Không tải được ghi chú đã lưu.")); }
    finally { setBusy(false); }
  }

  async function createTopic() {
    if (busy || !newName.trim()) return;
    setBusy(true); setTopicError(null);
    try {
      const topic = await backend.createTeachingTopic(newName.trim(), newGrade.trim());
      setTopics((old) => old.some((t) => t.id === topic.id) ? old : [...old, topic]);
      setRecord((r) => ({ ...r, topic_ids: [...new Set([...r.topic_ids, topic.id])] }));
      setNewName(""); setNewGrade("");
    } catch (err) { setTopicError(noteError(err, "Chưa tạo được chủ đề, hãy thử lại.")); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open title={t("Ghi chú riêng sau buổi")} file="private-notes.md" onClose={onClose} busy={busy}>
      <form className="form" onSubmit={(event) => void save(event)}>
        <p className="muted">{t("Buổi {date}. Nội dung này chỉ giáo viên xem.", { date: vnDate(record.scheduled_start) })}</p>
        {error && <Alert tone="error">{t(error)}</Alert>}
        <fieldset className="form" disabled={busy}>
          <legend className="sr-only">{t("Ghi chú riêng")}</legend>
          {([
            ["summary_md", "Nhận xét riêng", 5000], ["understanding_level", "Mức độ nắm bài", 100],
            ["improve_points", "Cần cải thiện", 5000], ["homework_text", "Bài tập ghi riêng", 5000],
          ] as const).map(([key, label, max]) => (
            <Field key={key} label={t(label)}>{(control) => <textarea {...control} rows={key === "understanding_level" ? 2 : 3} maxLength={max} value={record[key]} onChange={(event) => setRecord((r) => ({ ...r, [key]: event.target.value }))} />}</Field>
          ))}
          <fieldset className="stack">
            <legend>{t("Chủ đề đã dạy trong buổi này")}</legend>
            {topics.length === 0 && <p className="muted">{t("Chưa có chủ đề. Bạn có thể tạo bên dưới.")}</p>}
            {topics.map((topic) => (
              <Check key={topic.id} checked={record.topic_ids.includes(topic.id)} disabled={!record.topic_ids.includes(topic.id) && record.topic_ids.length >= 50} onChange={(event) => setRecord((r) => ({ ...r, topic_ids: event.target.checked ? [...r.topic_ids, topic.id] : r.topic_ids.filter((id) => id !== topic.id) }))}>
                {topic.name}{topic.grade && t(" · Lớp {grade}", { grade: topic.grade })}
              </Check>
            ))}
          </fieldset>
          <div className="form__grid">
            <Field label={t("Tên chủ đề mới")}>{(control) => <input {...control} value={newName} maxLength={200} onChange={(event) => setNewName(event.target.value)} />}</Field>
            <Field label={t("Lớp của chủ đề (tùy chọn)")}>{(control) => <input {...control} value={newGrade} maxLength={40} onChange={(event) => setNewGrade(event.target.value)} />}</Field>
          </div>
          {topicError && <Alert tone="error">{t(topicError)}</Alert>}
          <Button onClick={() => void createTopic()} disabled={!newName.trim() || record.topic_ids.length >= 50}>{t("Thêm chủ đề")}</Button>
          <p className="muted">{t("Tạo chủ đề thêm vào danh mục riêng của bạn. Bấm Lưu ghi chú để gắn các chủ đề đã chọn vào buổi.")}</p>
        </fieldset>
        <div className="btn-row">
          <Button type="submit" variant="primary" busy={busy} busyLabel={t("Đang xử lý…")}>{t("Lưu ghi chú")}</Button>
          {error && <Button disabled={busy} onClick={() => void reload()}>{t("Tải lại bản đã lưu (bỏ sửa đổi)")}</Button>}
          <Button disabled={busy} onClick={onClose}>{t("Hủy")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function NotesForMonth({ studentId, studentName, month }: { studentId: string; studentName: string; month: string }) {
  const data = useAsync(async () => {
    const [records, topics] = await Promise.all([backend.listTeachingRecords(studentId, month), backend.listTeachingTopics()]);
    return { records, topics };
  }, "Không tải được ghi chú riêng.");
  const [editing, setEditing] = useState<TeachingRecord | null>(null);
  if (data.error) return <ErrorState message={t(data.error)} onRetry={() => void data.reload()} />;
  if (data.loading || !data.data) return <Loading label={t("Đang tải ghi chú riêng…")} />;
  const { records, topics } = data.data;

  function download(format: "csv" | "md") {
    const content = teachingNotesExport(studentName, month, records, topics, format);
    const url = URL.createObjectURL(new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${t("ghi-chu-rieng")}-${month}.${format}`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return (
    <Window title={t("Buổi đã kết thúc · {student}", { student: studentName })} file="private-notes.md" variant="mint">
      <div className="btn-row"><Button disabled={!records.length} onClick={() => download("md")}>{t("Tải ghi chú Markdown")}</Button><Button disabled={!records.length} onClick={() => download("csv")}>{t("Tải ghi chú CSV")}</Button></div>
      {!records.length ? <Empty title={t("Chưa có buổi đã kết thúc trong tháng này.")} /> : (
        <ul className="items">{records.map((record) => (
          <li key={record.session_id} className="item">
            <div className="item__top"><strong id={`note-${record.session_id}`}>{record.subject || t("Buổi học")}{record.scheduled_topic && ` · ${record.scheduled_topic}`}</strong><span>{vnDate(record.scheduled_start)}</span></div>
            <p className="prose-text">{record.summary_md || t("Chưa ghi nhận xét riêng.")}</p>
            <p className="muted">{t("Chủ đề đã dạy: {topics}", { topics: record.topic_ids.map((id) => topics.find((topic) => topic.id === id)?.name || t("Chủ đề không còn trong danh mục")).join("; ") || t("Chưa chọn") })}</p>
            <Button onClick={() => setEditing(record)} aria-describedby={`note-${record.session_id}`}>{t("Ghi chú riêng")}</Button>
          </li>
        ))}</ul>
      )}
      {editing && <NoteEditor initial={editing} catalog={topics} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void data.reload(); }} />}
    </Window>
  );
}

function TeacherNotes() {
  const students = useAsync(async () => (await backend.listStudents()).filter((s) => !s.deleting_at), "Không tải được học sinh.");
  const [params] = useSearchParams(); // ?student=<id>: mở từ trang hồ sơ học sinh
  const [studentId, setStudentId] = useState(params.get("student") ?? "");
  const [month, setMonth] = useState(currentMonth);
  const student = students.data?.find((s) => s.id === studentId);
  return (
    <>
      <PageHeader title={t("Ghi chú riêng")} lead={t("Đánh giá sau buổi và chủ đề đã dạy. Chỉ giáo viên xem và tải về.")} />
      {students.error ? <ErrorState message={t(students.error)} onRetry={() => void students.reload()} /> : students.loading ? <Loading label={t("Đang tải học sinh…")} /> : (
        <div className="form__grid">
          <Field label={t("Học sinh ghi chú")}>{(control) => <select {...control} value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">{t("Chọn học sinh")}</option>{students.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}{!s.active && t(" · Đã ngừng dạy")}</option>)}</select>}</Field>
          <Field label={t("Tháng ghi chú")} hint={t("Theo ngày bắt đầu đã xếp lịch, giờ Việt Nam.")}>{(control) => <input {...control} type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />}</Field>
        </div>
      )}
      {student ? <NotesForMonth key={`${student.id}:${month}`} studentId={student.id} studentName={student.full_name} month={month} /> : !students.loading && !students.error && <Empty title={t("Chọn học sinh để xem buổi học và ghi chú.")} />}
    </>
  );
}

export default function TeachingNotesPage() {
  const { user } = useAuth();
  return <AppShell title={t("Ghi chú riêng")}>{user?.role === "teacher" ? <TeacherNotes /> : <Alert>{t("Chỉ giáo viên được xem ghi chú riêng.")}</Alert>}</AppShell>;
}
