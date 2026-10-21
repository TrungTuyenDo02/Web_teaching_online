import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { backend, errorMessage, errorText, type Student } from "../lib/data";
import { useAsync } from "../lib/hooks";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Alert, Empty, ErrorState, Loading, useToast } from "../ui/Feedback";
import { Window } from "../ui/Window";
import { WeeklySlotsDialog } from "./teacher/WeeklySlotsDialog";
import { t } from "../lib/i18n";

const TEXT_FIELDS = ["full_name", "grade", "goals", "notes", "guardian_name", "guardian_contact"] as const;
type Draft = Record<(typeof TEXT_FIELDS)[number], string> & { consent: boolean };
type Filter = "active" | "inactive" | "all";

const emptyDraft: Draft = {
  full_name: "", grade: "", goals: "", notes: "", guardian_name: "", guardian_contact: "", consent: false,
};

function toDraft(s: Student): Draft {
  const draft = { ...emptyDraft, consent: Boolean(s.consent_at) };
  for (const f of TEXT_FIELDS) draft[f] = s[f] ?? "";
  return draft;
}

/** So khớp tên không phân biệt hoa thường và dấu tiếng Việt ("nguyen" khớp "Nguyễn"). */
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gi, "d").toLowerCase();
}

export default function StudentsPage() {
  const { user } = useAuth();
  if (user?.role !== "teacher") return <Navigate to="/" replace />;
  return (
    <AppShell title={t("Học sinh")}>
      <StudentsManager />
    </AppShell>
  );
}

function StudentsManager() {
  const toast = useToast();
  const list = useAsync(() => backend.listStudents(), "Không tải được danh sách học sinh.");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [editing, setEditing] = useState<{ student: Student | null } | null>(null);
  const [account, setAccount] = useState<{ student: Student; reset: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [slotsFor, setSlotsFor] = useState<Student | null>(null);

  const students = list.data ?? [];
  const counts = {
    active: students.filter((s) => s.active).length,
    inactive: students.filter((s) => !s.active).length,
  };
  const visible = useMemo(() => {
    const q = fold(query.trim());
    return students.filter(
      (s) =>
        (filter === "all" || (filter === "active" ? s.active : !s.active)) &&
        (!q || fold(`${s.full_name} ${s.grade ?? ""}`).includes(q)),
    );
  }, [students, filter, query]);

  async function toggleActive(s: Student) {
    setRowBusy(s.id);
    try {
      await backend.updateStudent(s.id, { active: !s.active });
      toast.success(s.active ? t("Đã chuyển {name} sang ngừng dạy.", { name: s.full_name }) : t("{name} đã học lại.", { name: s.full_name }));
      await list.reload();
    } catch (err) {
      toast.error(errorMessage(err, "Không đổi được trạng thái học sinh."));
    } finally {
      setRowBusy(null);
    }
  }

  async function runDelete(s: Student) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await backend.deleteStudent(s.id);
      toast.success(t("Đã xóa hẳn {name}.", { name: s.full_name }));
      setDeleting(null);
    } catch (err) {
      const raw = errorText(err, "Không xóa được học sinh.");
      const message = t(raw);
      if (raw.startsWith("Chưa xóa xong")) {
        // Đã xóa một phần: hệ thống tự làm tiếp, danh sách hiện trạng thái "đang xóa"
        toast.info(message);
        setDeleting(null);
      } else if (/không tìm thấy/i.test(raw)) {
        toast.success(t("{name} đã được xóa.", { name: s.full_name })); // lần trước đã xóa xong nhưng mất phản hồi
        setDeleting(null);
      } else if (s.deleting_at) {
        toast.error(message); // "Xóa tiếp" không mở hộp thoại: báo bằng thông báo nổi
        setDeleting(null);
      } else setDeleteError(message);
    } finally {
      setDeleteBusy(false);
      await list.reload();
    }
  }

  return (
    <>
      <div className="page__head">
        <div>
          <h1>{t("Học sinh")}</h1>
          <p className="page__lead">{t("Hồ sơ, tài khoản đăng nhập và số buổi đã dạy.")}</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setEditing({ student: null })}>
          {t("Thêm học sinh")}
        </Button>
      </div>

      <Window title={t("Danh sách học sinh")} file="students.db" variant="lavender">
        <div className="toolbar">
          <Field label={t("Tìm theo tên hoặc lớp")}>
            {(control) => (
              <input {...control} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Ví dụ: An, 8A")} />
            )}
          </Field>
          <div className="segmented" role="group" aria-label={t("Lọc theo trạng thái")}>
            {(
              [
                ["active", t("Đang học ({n})", { n: counts.active })],
                ["inactive", t("Ngừng dạy ({n})", { n: counts.inactive })],
                ["all", t("Tất cả ({n})", { n: students.length })],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Báo gọn số dòng khi tìm/lọc thay vì đọc lại cả danh sách */}
        <p className="sr-only" role="status">
          {list.data ? t("Đang hiện {n} học sinh", { n: visible.length }) : ""}
        </p>
        {list.error && <ErrorState message={list.error} onRetry={() => void list.reload()} />}
        {list.loading && !list.data ? (
          <Loading label={t("Đang tải danh sách học sinh…")} />
        ) : visible.length === 0 && !list.error ? (
          <Empty title={students.length === 0 ? t("Chưa có học sinh nào.") : t("Không có học sinh khớp bộ lọc.")}>
            {students.length === 0 && (
              <Button variant="primary" onClick={() => setEditing({ student: null })}>
                {t("Thêm học sinh")}
              </Button>
            )}
          </Empty>
        ) : (
          <ul className="items">
            {visible.map((s) => (
              <li key={s.id} className="item">
                <div className="item__top">
                  <span className="item__title" id={`student-${s.id}`}>
                    {s.full_name}
                    {s.grade ? ` · ${t("Lớp {grade}", { grade: s.grade })}` : ""}
                  </span>
                  <span className="btn-row">
                    {s.deleting_at ? (
                      <span className="badge badge--danger">{t("Đang xóa")}</span>
                    ) : (
                      <span className={`badge ${s.active ? "badge--live" : "badge--done"}`}>{s.active ? t("Đang học") : t("Ngừng dạy")}</span>
                    )}
                    {!s.consent_at && <span className="badge badge--warn">{t("Chưa ghi nhận phụ huynh đồng ý")}</span>}
                  </span>
                </div>
                <div className="item__meta">
                  <span>{t("Đã dạy {n} buổi", { n: s.completed_sessions })}</span>
                  <span>{s.profile_id ? t("Đã có tài khoản đăng nhập") : t("Chưa có tài khoản đăng nhập")}</span>
                </div>
                {s.goals && <p className="muted">{t("Mục tiêu:")} {s.goals}</p>}

                {s.deleting_at ? (
                  <Alert
                    tone="warning"
                    action={
                      <div>
                        <Button variant="danger" size="sm" busy={deleteBusy && deleting?.id === s.id}
                          onClick={() => {
                            setDeleting(s);
                            void runDelete(s);
                          }}
                        >
                          {t("Xóa tiếp")}
                        </Button>
                      </div>
                    }
                  >
                    {t("Đang xóa nhưng chưa xong. Hệ thống sẽ tự thử lại sau ít phút, hoặc bạn bấm \"Xóa tiếp\".")}
                  </Alert>
                ) : (
                  <>
                    <div className="btn-row">
                      <Button size="sm" onClick={() => setEditing({ student: s })} aria-describedby={`student-${s.id}`}>
                        {t("Sửa hồ sơ")}
                      </Button>
                      {s.active && (
                        <Button size="sm" onClick={() => setSlotsFor(s)} aria-describedby={`student-${s.id}`}>
                          {t("Lịch hằng tuần")}
                        </Button>
                      )}
                      {s.profile_id ? (
                        <Button size="sm" onClick={() => setAccount({ student: s, reset: true })} aria-describedby={`student-${s.id}`}>
                          {t("Đặt lại mật khẩu")}
                        </Button>
                      ) : (
                        s.active && (
                          <Button size="sm" onClick={() => setAccount({ student: s, reset: false })} aria-describedby={`student-${s.id}`}>
                            {t("Tạo tài khoản")}
                          </Button>
                        )
                      )}
                    </div>
                    <details className="more">
                      <summary aria-describedby={`student-${s.id}`}>{t("Thao tác khác")}</summary>
                      <div className="btn-row">
                        <Button size="sm" busy={rowBusy === s.id} onClick={() => void toggleActive(s)} aria-describedby={`student-${s.id}`}>
                          {s.active ? t("Ngừng dạy") : t("Dạy lại")}
                        </Button>
                        {s.active ? (
                          <span className="muted">{t("Muốn xóa hẳn, hãy chuyển sang ngừng dạy trước.")}</span>
                        ) : (
                          <Button size="sm" variant="danger" onClick={() => setDeleting(s)} aria-describedby={`student-${s.id}`}>
                            {t("Xóa hẳn…")}
                          </Button>
                        )}
                      </div>
                    </details>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Window>

      {slotsFor && <WeeklySlotsDialog student={slotsFor} onClose={() => setSlotsFor(null)} />}
      <StudentFormDialog
        open={editing !== null}
        student={editing?.student ?? null}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          toast.success(message);
          void list.reload();
        }}
      />
      <AccountDialog
        target={account}
        onClose={() => setAccount(null)}
        onSaved={(message) => {
          setAccount(null);
          toast.success(message);
          void list.reload();
        }}
      />
      <ConfirmDialog
        open={deleting !== null && !deleting.deleting_at}
        title={t("Xóa hẳn {name}?", { name: deleting?.full_name ?? "" })}
        confirmLabel={t("Xóa hẳn")}
        danger
        acknowledge={t("Tôi hiểu dữ liệu này không khôi phục được.")}
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => deleting && void runDelete(deleting)}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      >
        <p>{t("Sẽ xóa vĩnh viễn:")}</p>
        <ul>
          <li>{t("Hồ sơ, ghi chú và thông tin phụ huynh")}</li>
          <li>{t("Mọi buổi học, điểm danh, nội dung và bài về nhà")}</li>
          <li>{t("Bảng viết đã lưu và ảnh bài nộp")}</li>
          <li>{t("Tài khoản đăng nhập của học sinh")}</li>
        </ul>
        <p className="muted">{t("Nếu chỉ tạm dừng, hãy giữ ở trạng thái \"Ngừng dạy\".")}</p>
      </ConfirmDialog>
    </>
  );
}

function StudentFormDialog({
  open,
  student,
  onClose,
  onSaved,
}: {
  open: boolean;
  student: Student | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(student ? toDraft(student) : emptyDraft);
    setNameError(null);
    setFormError(null);
  }, [open, student]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.full_name.trim()) {
      setNameError(t("Hãy nhập họ tên học sinh."));
      return;
    }
    setNameError(null);
    setFormError(null);
    setBusy(true);
    try {
      if (student) await backend.updateStudent(student.id, draft);
      else await backend.createStudent(draft);
      onSaved(student ? t("Đã lưu hồ sơ học sinh.") : t("Đã thêm {name}.", { name: draft.full_name.trim() }));
    } catch (err) {
      setFormError(errorMessage(err, "Không lưu được hồ sơ học sinh."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={student ? t("Sửa hồ sơ học sinh") : t("Thêm học sinh")} file="profile.txt" variant="pink" onClose={onClose} busy={busy}>
      <form className="form" onSubmit={onSubmit} noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="form__grid">
          <Field label={t("Họ tên")} required error={nameError}>
            {(c) => <input {...c} value={draft.full_name} onChange={(e) => set("full_name", e.target.value)} maxLength={120} autoComplete="off" />}
          </Field>
          <Field label={t("Lớp")}>
            {(c) => <input {...c} value={draft.grade} onChange={(e) => set("grade", e.target.value)} maxLength={40} />}
          </Field>
        </div>
        <Field label={t("Mục tiêu học tập")}>
          {(c) => <textarea {...c} value={draft.goals} onChange={(e) => set("goals", e.target.value)} rows={2} maxLength={1000} />}
        </Field>
        <Field label={t("Ghi chú riêng")} hint={t("Chỉ giáo viên thấy.")}>
          {(c) => <textarea {...c} value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={2} maxLength={2000} />}
        </Field>
        <div className="form__grid">
          <Field label={t("Phụ huynh")}>
            {(c) => <input {...c} value={draft.guardian_name} onChange={(e) => set("guardian_name", e.target.value)} maxLength={120} />}
          </Field>
          <Field label={t("Liên hệ phụ huynh")} hint={t("Điện thoại, Zalo hoặc email.")}>
            {(c) => <input {...c} value={draft.guardian_contact} onChange={(e) => set("guardian_contact", e.target.value)} maxLength={200} />}
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.consent} onChange={(e) => set("consent", e.target.checked)} />
          {t("Phụ huynh đã đồng ý cho lưu dữ liệu học tập")}
        </label>
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={busy}>
            {t("Thôi")}
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel={t("Đang lưu…")}>
            {student ? t("Lưu hồ sơ") : t("Thêm học sinh")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AccountDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { student: Student; reset: boolean } | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEmail("");
    setPassword("");
    setErrors({});
  }, [target]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const next: typeof errors = {};
    if (!target.reset && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t("Hãy nhập email hợp lệ.");
    if (password.length < 8) next.password = t("Mật khẩu cần ít nhất 8 ký tự.");
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      if (target.reset) {
        await backend.resetStudentPassword(target.student.id, password);
        onSaved(t("Đã đặt mật khẩu mới cho {name}. Hãy gửi cho học sinh hoặc phụ huynh.", { name: target.student.full_name }));
      } else {
        const created = await backend.createStudentAccount(target.student.id, email.trim(), password);
        onSaved(t("Đã tạo tài khoản {email}. Hãy gửi email và mật khẩu cho học sinh hoặc phụ huynh.", { email: created.email }));
      }
    } catch (err) {
      const raw = errorText(err, "Không lưu được tài khoản.");
      const message = t(raw);
      if (/email/i.test(raw)) setErrors({ email: message });
      else if (/mật khẩu/i.test(raw)) setErrors({ password: message });
      else setErrors({ form: message });
    } finally {
      setBusy(false);
    }
  }

  const reset = target?.reset ?? false;
  return (
    <Dialog
      open={target !== null}
      title={t(reset ? "Đặt lại mật khẩu cho {name}" : "Tạo tài khoản cho {name}", { name: target?.student.full_name ?? "" })}
      file="login.exe"
      variant="peach"
      onClose={onClose}
      busy={busy}
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        {!reset && (
          <Field label={t("Email đăng nhập")} required error={errors.email}>
            {(c) => <input {...c} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="off" />}
          </Field>
        )}
        <Field label={reset ? t("Mật khẩu mới") : t("Mật khẩu tạm")} required hint={t("Ít nhất 8 ký tự. Mật khẩu hiện rõ để bạn chép và gửi cho học sinh.")} error={errors.password}>
          {(c) => <input {...c} type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" />}
        </Field>
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={busy}>
            {t("Thôi")}
          </Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel={t("Đang lưu…")}>
            {reset ? t("Đặt mật khẩu") : t("Tạo tài khoản")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
