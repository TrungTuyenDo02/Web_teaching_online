import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { backend, errorMessage, type AssignmentItem, type SubmissionItem } from "../lib/data";
import type { SubmissionFile } from "../lib/api";
import { useAsync, useNow } from "../lib/hooks";
import { t } from "../lib/i18n";
import { formatDateTime } from "../lib/schedule";
import { AppShell } from "../ui/AppShell";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Alert, Empty, ErrorState, Loading, useToast } from "../ui/Feedback";
import { PageHeader } from "../ui/PageHeader";
import { Window } from "../ui/Window";

// Excalidraw nặng: chỉ tải khi giáo viên bấm Chữa trên ảnh
const SubmissionAnnotator = lazy(() => import("../components/SubmissionAnnotator"));

type AssignmentState = AssignmentItem["status"] | "redo";

/** "Cần làm lại": API mở lại bài (assigned) sau khi trả một lượt nộp kèm yêu cầu làm lại. */
export function assignmentState(item: AssignmentItem): AssignmentState {
  return item.status === "assigned" && item.submissions.length > 0 ? "redo" : item.status;
}

const STATUS: Record<AssignmentState, [BadgeTone, string]> = {
  assigned: ["scheduled", "Chưa nộp"],
  redo: ["warn", "Cần làm lại"],
  submitted: ["live", "Đã nộp"],
  returned: ["done", "Đã trả"],
};

export function AssignmentStatus({ item }: { item: AssignmentItem }) {
  const [tone, label] = STATUS[assignmentState(item)];
  return <Badge tone={tone}>{t(label)}</Badge>;
}

/** Ảnh bài làm (gốc hoặc ảnh thầy cô chữa): URL ký 10 phút qua Storage RLS; bấm mở cỡ đầy đủ ở tab mới. */
export function SubmissionImages({
  submission,
  kind = "original",
  actions,
}: {
  submission: SubmissionItem;
  kind?: SubmissionFile["kind"];
  /** Nút riêng cho từng ảnh (giáo viên: chữa, xóa ảnh chữa). */
  actions?: (file: SubmissionFile, url: string, name: string) => ReactNode;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    void Promise.all(
      submission.files.map(async (f) => [f.id, await backend.submissionImageUrl(f.storage_path).catch(() => null)] as const),
    ).then((pairs) => alive && setUrls(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [submission.files]);
  const files = submission.files.filter((f) => f.kind === kind);
  return (
    <ul className="work-images">
      {files.map((file, i) => {
        const url = urls[file.id];
        const name = kind === "original" ? t("Ảnh bài làm {n}", { n: i + 1 }) : t("Ảnh thầy cô chữa {n}", { n: i + 1 });
        return (
          <li key={file.id}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={name} loading="lazy" />
              </a>
            ) : (
              <span className="muted">{url === null ? t("Không tải được ảnh {n}", { n: i + 1 }) : t("Đang tải ảnh…")}</span>
            )}
            {url && actions?.(file, url, name)}
          </li>
        );
      })}
    </ul>
  );
}

function AssignDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const students = useAsync(() => backend.listStudentOptions(), "Không tải được danh sách học sinh.");
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setTitle(""); setDescription(""); setDue(""); setError(null); }
  }, [open]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      await backend.createAssignment({ student_id: studentId, title, description, due_at: due ? new Date(due).toISOString() : null });
      onSaved();
    } catch (err) {
      setError(errorMessage(err, "Không giao được bài."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={t("Giao bài")} file="homework.txt" variant="peach" onClose={onClose} busy={busy}>
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        {students.error && <Alert tone="error">{students.error}</Alert>}
        <Field label={t("Học sinh")} required>
          {(c) => (
            <select {...c} value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
              <option value="">{t("Chọn học sinh")}</option>
              {students.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Tiêu đề")} required>
          {(c) => <input {...c} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />}
        </Field>
        <Field label={t("Đề bài / yêu cầu")}>
          {(c) => <textarea {...c} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />}
        </Field>
        <Field label={t("Hạn nộp")} hint={t("Không bắt buộc.")}>
          {(c) => <input {...c} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={busy}>{t("Thôi")}</Button>
          <Button type="submit" variant="primary" busy={busy}>{t("Giao bài")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReviewDialog({ item, onClose, onChanged }: { item: AssignmentItem; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const submission = item.submissions[0];
  const [transcript, setTranscript] = useState(submission?.transcripts[0]?.content ?? null);
  const [comment, setComment] = useState(submission?.teacher_comment ?? "");
  const [score, setScore] = useState(submission?.score == null ? "" : String(submission.score));
  const [busy, setBusy] = useState<"ocr" | "return" | "redo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SubmissionFile | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const annotated = submission?.files.filter((f) => f.kind === "annotated") ?? [];

  async function saveAnnotation(image: Blob) {
    if (!submission) return;
    await backend.annotateSubmission(submission.id, image);
    toast.success(t("Đã lưu ảnh chữa."));
    setAnnotating(null);
    onChanged();
  }
  async function removeAnnotation() {
    if (!submission || !removing) return;
    setRemoveBusy(true); setRemoveError(null);
    try {
      await backend.deleteAnnotation(submission.id, removing.id);
      setRemoving(null);
      onChanged();
    } catch (err) {
      setRemoveError(errorMessage(err, "Không xóa được ảnh chữa."));
    } finally {
      setRemoveBusy(false);
    }
  }
  const annotateButton = (label: string) => (_file: SubmissionFile, url: string, name: string) => (
    <Button size="sm" onClick={() => setAnnotating(url)} disabled={busy !== null} aria-label={`${label}: ${name}`}>
      {label}
    </Button>
  );

  async function readWithAI() {
    if (!submission) return;
    setBusy("ocr"); setError(null);
    try {
      setTranscript((await backend.ocrSubmission(submission.id)).content);
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "AI chưa đọc được ảnh. Hãy thử lại sau hoặc tự xem ảnh bài làm."));
    } finally {
      setBusy(null);
    }
  }
  async function giveBack(event: FormEvent, redo = false) {
    event.preventDefault();
    if (!submission) return;
    if (redo && !comment.trim()) return setError(t("Hãy viết nhận xét để học sinh biết cần sửa gì."));
    setBusy(redo ? "redo" : "return"); setError(null);
    try {
      await backend.returnSubmission(submission.id, { teacher_comment: comment, score: score === "" ? null : Number(score), redo });
      toast.success(redo ? t("Đã gửi yêu cầu làm lại cho {name}.", { name: item.student_name }) : t("Đã trả bài cho {name}.", { name: item.student_name }));
      onChanged();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Không trả được bài."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open title={t("Bài nộp · {title}", { title: item.title })} file="submission.jpg" variant="mint" onClose={onClose} busy={busy !== null}>
      {!submission ? (
        <Empty title={t("Học sinh chưa nộp bài này.")} />
      ) : (
        <div className="stack">
          <p className="muted">{t("{name} nộp lúc {when}", { name: item.student_name, when: formatDateTime(submission.submitted_at, new Date()) })}</p>
          <SubmissionImages submission={submission} actions={annotateButton(t("Chữa trên ảnh"))} />
          {annotated.length > 0 && (
            <section className="stack" aria-labelledby="annotated-title">
              <h3 id="annotated-title">{t("Ảnh thầy cô chữa")}</h3>
              <p className="muted">{t("Học sinh thấy các ảnh này khi thầy cô trả bài.")}</p>
              <SubmissionImages
                submission={submission}
                kind="annotated"
                actions={(file, url, name) => (
                  <div className="btn-row">
                    {annotateButton(t("Chữa tiếp"))(file, url, name)}
                    <Button size="sm" variant="danger" onClick={() => { setRemoveError(null); setRemoving(file); }} disabled={busy !== null} aria-label={`${t("Xóa ảnh chữa")}: ${name}`}>
                      {t("Xóa ảnh chữa")}
                    </Button>
                  </div>
                )}
              />
            </section>
          )}
          <section className="stack" aria-labelledby="ocr-title">
            <h3 id="ocr-title">{t("AI đọc bài (gợi ý cho thầy cô)")}</h3>
            {transcript ? (
              <p className="prose-text ocr-text">{transcript}</p>
            ) : (
              <p className="muted">{t("Ảnh được gửi tới Google Gemini để chép lại chữ và công thức. AI không giải, không chấm; chỉ dùng khi đã ghi nhận phụ huynh đồng ý.")}</p>
            )}
            <div>
              <Button onClick={() => void readWithAI()} busy={busy === "ocr"} busyLabel={t("AI đang đọc…")} disabled={busy !== null}>
                {transcript ? t("Đọc lại bằng AI") : t("Đọc bài bằng AI")}
              </Button>
            </div>
          </section>
          <form className="form" onSubmit={(e) => void giveBack(e)}>
            <Field label={t("Nhận xét cho học sinh")}>
              {(c) => <textarea {...c} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />}
            </Field>
            <Field label={t("Điểm (0–10)")} hint={t("Để trống nếu chỉ nhận xét.")}>
              {(c) => <input {...c} type="number" min={0} max={10} step={0.25} inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} />}
            </Field>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="btn-row btn-row--end">
              <Button onClick={onClose} disabled={busy !== null}>{t("Đóng")}</Button>
              <Button onClick={(e) => void giveBack(e, true)} busy={busy === "redo"} disabled={busy !== null}>
                {t("Yêu cầu làm lại")}
              </Button>
              <Button type="submit" variant="primary" busy={busy === "return"} disabled={busy !== null}>{t("Trả bài")}</Button>
            </div>
          </form>
        </div>
      )}
      {annotating && (
        <Suspense fallback={null}>
          <SubmissionAnnotator
            imageUrl={annotating}
            title={t("Chữa bài · {title}", { title: item.title })}
            onSave={saveAnnotation}
            onClose={() => setAnnotating(null)}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t("Xóa ảnh chữa?")}
        confirmLabel={t("Xóa ảnh chữa")}
        danger
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void removeAnnotation()}
        onClose={() => setRemoving(null)}
      >
        {t("Ảnh chữa này sẽ bị xóa hẳn, học sinh không xem được nữa. Ảnh bài làm gốc vẫn giữ nguyên.")}
      </ConfirmDialog>
    </Dialog>
  );
}

function TeacherAssignments() {
  const toast = useToast();
  const now = useNow();
  const list = useAsync(() => backend.listAssignments(), "Không tải được danh sách bài tập.");
  const [assigning, setAssigning] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const reviewing = list.data?.find((a) => a.id === reviewingId) ?? null; // lấy bản mới sau khi tải lại

  return (
    <>
      <PageHeader
        title={t("Bài tập")}
        lead={t("Giao bài, xem ảnh bài làm, nhờ AI đọc bài và trả nhận xét.")}
        actions={<Button variant="primary" size="lg" onClick={() => setAssigning(true)}>{t("Giao bài")}</Button>}
      />
      <Window title={t("Bài đã giao")} file="homework.db" variant="lavender">
        {list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : list.loading && !list.data ? (
          <Loading label={t("Đang tải bài tập…")} />
        ) : !list.data?.length ? (
          <Empty title={t("Chưa giao bài nào.")} />
        ) : (
          <ul className="items">
            {list.data.map((item) => (
              <li key={item.id} className="item">
                <div className="item__top">
                  <span className="item__title" id={`assignment-${item.id}`}>{item.title}</span>
                  <AssignmentStatus item={item} />
                </div>
                <div className="item__meta">
                  <span>{t("Học sinh: {name}", { name: item.student_name || "—" })}</span>
                  {item.due_at && <span>{t("Hạn nộp: {when}", { when: formatDateTime(item.due_at, now) })}</span>}
                  {item.submissions[0] && <span>{t("{n} ảnh", { n: item.submissions[0].files.filter((f) => f.kind === "original").length })}</span>}
                </div>
                {item.submissions[0] && (
                  <div className="btn-row">
                    <Button size="sm" variant={item.status === "submitted" ? "primary" : undefined} onClick={() => setReviewingId(item.id)} aria-describedby={`assignment-${item.id}`}>
                      {item.status === "submitted" ? t("Xem và chấm") : t("Xem lại bài nộp")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Window>
      <AssignDialog
        open={assigning}
        onClose={() => setAssigning(false)}
        onSaved={() => {
          setAssigning(false);
          toast.success(t("Đã giao bài."));
          void list.reload();
        }}
      />
      {reviewing && <ReviewDialog item={reviewing} onClose={() => setReviewingId(null)} onChanged={() => void list.reload()} />}
    </>
  );
}

export default function AssignmentsPage() {
  const { user } = useAuth();
  return (
    <AppShell title={t("Bài tập")}>
      {user?.role === "teacher" ? <TeacherAssignments /> : <Alert>{t("Chỉ giáo viên được quản lý bài tập.")}</Alert>}
    </AppShell>
  );
}
