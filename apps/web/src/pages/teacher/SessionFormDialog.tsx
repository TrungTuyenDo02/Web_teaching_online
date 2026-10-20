import { useEffect, useState, type FormEvent } from "react";
import { backend, errorMessage, errorText, type SessionItem, type StudentOption } from "../../lib/data";
import { durationMinutes, sessionErrorField, toLocalInput, type SessionField } from "../../lib/schedule";
import { Button, ButtonLink } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Alert, Loading } from "../../ui/Feedback";
import { t } from "../../lib/i18n";

const DURATIONS = [45, 60, 90, 120, 180, 240];

interface Props {
  open: boolean;
  /** Có giá trị: sửa buổi chưa bắt đầu (không đổi học sinh) */
  editing?: SessionItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function SessionFormDialog({ open, editing, onClose, onSaved }: Props) {
  const [students, setStudents] = useState<StudentOption[] | null>(null);
  const [studentId, setStudentId] = useState("");
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState("");
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [errors, setErrors] = useState<Partial<Record<SessionField, string>>>({});
  const [busy, setBusy] = useState(false);

  // Mở lại hộp thoại: điền theo buổi đang sửa hoặc để trống
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setStudentId("");
    setSubject(editing?.subject ?? "");
    setTopic(editing?.topic ?? "");
    setStart(editing ? toLocalInput(editing.scheduled_start) : "");
    setMinutes(editing ? durationMinutes(editing) : 60);
    if (!editing) {
      setStudents(null);
      backend
        .listStudentOptions()
        .then(setStudents)
        .catch((err: unknown) => setErrors({ form: errorMessage(err, "Không tải được danh sách học sinh.") }));
    }
  }, [open, editing]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: Partial<Record<SessionField, string>> = {};
    if (!editing && !studentId) next.student = t("Hãy chọn học sinh.");
    // datetime-local là giờ địa phương; toISOString đổi sang UTC kèm múi giờ
    const begin = new Date(start);
    if (!start || Number.isNaN(begin.getTime())) next.start = t("Hãy chọn ngày giờ bắt đầu.");
    else if (begin.getTime() + minutes * 60_000 <= Date.now()) next.start = t("Giờ học này đã qua, hãy chọn giờ khác.");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    const fields = {
      subject: subject.trim(),
      topic: topic.trim(),
      scheduled_start: begin.toISOString(),
      scheduled_end: new Date(begin.getTime() + minutes * 60_000).toISOString(),
    };
    try {
      if (editing) await backend.updateSession(editing.id, fields);
      else await backend.createSession({ ...fields, student_id: studentId });
      onSaved(editing ? t("Đã lưu thay đổi buổi học.") : t("Đã tạo buổi học."));
    } catch (err) {
      const raw = errorText(err, "Không lưu được buổi học.");
      setErrors({ [sessionErrorField(raw)]: t(raw) });
    } finally {
      setBusy(false);
    }
  }

  const noStudents = !editing && students?.length === 0;

  return (
    <Dialog
      open={open}
      title={editing ? t("Sửa buổi học với {name}", { name: editing.student_name }) : t("Tạo buổi học")}
      file="new_class.exe"
      variant="periwinkle"
      onClose={onClose}
      busy={busy}
    >
      {noStudents ? (
        <Alert tone="info" action={<div><ButtonLink to="/students" size="sm">{t("Đến trang học sinh")}</ButtonLink></div>}>
          {t("Chưa có học sinh nào đang học. Hãy thêm học sinh trước.")}
        </Alert>
      ) : !editing && !students && !errors.form ? (
        <Loading label={t("Đang tải danh sách học sinh…")} />
      ) : (
        <form className="form" onSubmit={onSubmit} noValidate>
          {errors.form && <Alert tone="error">{errors.form}</Alert>}
          {!editing && (
            <Field label={t("Học sinh")} required error={errors.student}>
              {(control) => (
                <select {...control} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  <option value="">{t("Chọn học sinh")}</option>
                  {students?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <div className="form__grid">
            <Field label={t("Môn")} hint={t("Ví dụ: Toán")}>
              {(control) => <input {...control} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} />}
            </Field>
            <Field label={t("Chủ đề")}>
              {(control) => <input {...control} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} />}
            </Field>
            <Field label={t("Bắt đầu")} required error={errors.start}>
              {(control) => (
                <input {...control} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              )}
            </Field>
            <Field label={t("Thời lượng")} error={errors.duration}>
              {(control) => (
                <select {...control} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[...new Set([...DURATIONS, minutes])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {t("{n} phút", { n: m })}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>
          <div className="btn-row btn-row--end">
            <Button onClick={onClose} disabled={busy}>
              {t("Thôi")}
            </Button>
            <Button type="submit" variant="primary" busy={busy} busyLabel={t("Đang lưu…")}>
              {editing ? t("Lưu thay đổi") : t("Tạo buổi học")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
