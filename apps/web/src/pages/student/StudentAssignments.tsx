import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { backend, errorMessage, type AssignmentItem } from "../../lib/data";
import { useAsync, useNow } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { prepareImage } from "../../lib/imagePrep";
import { formatDateTime } from "../../lib/schedule";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Alert, Empty, ErrorState, Loading, useToast } from "../../ui/Feedback";
import { Window } from "../../ui/Window";
import { AssignmentStatus, assignmentState, SubmissionImages } from "../AssignmentsPage";

const MAX_FILES = 6;

function SubmitDialog({ item, onClose, onDone, onPartial }: { item: AssignmentItem; onClose: () => void; onDone: () => void; onPartial: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  // Ảnh đã lên máy chủ trong lần nộp này: lỗi giữa chừng thì gửi tiếp từ ảnh sau, không tạo bài nộp mới
  const [sent, setSent] = useState(0);
  const submissionId = useRef<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const busy = progress !== null;

  function add(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = ""; // chọn lại đúng ảnh vừa bỏ vẫn nhận
    setError(files.length + picked.length > MAX_FILES ? t("Mỗi lần nộp tối đa {n} ảnh.", { n: MAX_FILES }) : null);
    setFiles((old) => [...old, ...picked].slice(0, MAX_FILES));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) return setError(t("Hãy chọn ít nhất một ảnh bài làm."));
    setError(null);
    let done = sent;
    if (done >= files.length) return onDone(); // đã gửi hết, chỉ bỏ các ảnh lỗi còn lại
    // Thu nhỏ ảnh kế tiếp trong lúc ảnh này đang gửi
    let next = prepareImage(files[done]!);
    try {
      for (; done < files.length; done++) {
        setProgress(t("Đang gửi ảnh {i}/{n}…", { i: done + 1, n: files.length }));
        const image = await next;
        if (done + 1 < files.length) {
          next = prepareImage(files[done + 1]!);
          next.catch(() => undefined); // lỗi được báo khi tới lượt ảnh đó
        }
        if (submissionId.current) await backend.addSubmissionImage(submissionId.current, image);
        else submissionId.current = (await backend.submitAssignment(item.id, image)).id;
        setSent(done + 1);
      }
      onDone();
    } catch (err) {
      const reason = errorMessage(err, "Không gửi được ảnh.");
      setError(
        submissionId.current
          ? t("Đã gửi {sent}/{n} ảnh. {reason} Bấm Gửi tiếp để gửi các ảnh còn lại.", { sent: done, n: files.length, reason })
          : errorMessage(err, "Không nộp được bài."),
      );
      if (submissionId.current) onPartial(); // tải lại danh sách, giữ hộp thoại để gửi tiếp
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog open title={t("Nộp bài · {title}", { title: item.title })} file="upload.jpg" variant="peach" onClose={onClose} busy={busy}>
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        {item.description && <p className="prose-text">{item.description}</p>}
        <Field label={t("Ảnh bài làm")} required hint={t("Chụp rõ từng trang, tối đa {n} ảnh (JPEG, PNG, WebP).", { n: MAX_FILES })}>
          {(c) => <input {...c} ref={pick} className="sr-only" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={add} />}
        </Field>
        <input ref={camera} className="sr-only" tabIndex={-1} aria-hidden="true" type="file" accept="image/*" capture="environment" onChange={add} />
        <div className="btn-row">
          <Button onClick={() => camera.current?.click()} disabled={busy || files.length >= MAX_FILES}>{t("Chụp ảnh")}</Button>
          <Button onClick={() => pick.current?.click()} disabled={busy || files.length >= MAX_FILES}>{t("Chọn ảnh có sẵn")}</Button>
        </div>
        {files.length > 0 && (
          <ul className="work-images work-images--picked" aria-label={t("Ảnh sẽ nộp")}>
            {files.map((file, i) => (
              <li key={previews[i]}>
                <img src={previews[i]} alt={t("Ảnh bài làm {n}", { n: i + 1 })} />
                {i < sent ? (
                  <span className="muted">{t("Đã gửi")}</span>
                ) : (
                  <Button size="sm" disabled={busy} aria-label={t("Bỏ ảnh {n}", { n: i + 1 })}
                    onClick={() => setFiles((old) => old.filter((f) => f !== file))}>
                    {t("Bỏ ảnh")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Alert tone="info">
          {t("Ảnh chỉ thầy cô và em xem được. Vị trí chụp và thông tin máy ảnh được gỡ trước khi lưu. Thầy cô có thể nhờ AI (Google Gemini) đọc chữ trong ảnh để chấm nhanh hơn.")}
        </Alert>
        <p className="sr-only" role="status">{progress ?? ""}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={busy}>{sent ? t("Đóng") : t("Thôi")}</Button>
          <Button type="submit" variant="primary" busy={busy} busyLabel={progress ?? undefined}>{sent ? t("Gửi tiếp") : t("Nộp bài")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Bài tập của học sinh trên trang chính: nộp ảnh, xem nhận xét và điểm khi thầy cô đã trả. */
export function StudentAssignments() {
  const toast = useToast();
  const now = useNow();
  const list = useAsync(() => backend.listAssignments(), "Không tải được bài tập.");
  const [submitting, setSubmitting] = useState<AssignmentItem | null>(null);

  return (
    <Window title={t("Bài tập")} file="homework.txt" variant="pink">
      {list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.loading && !list.data ? (
        <Loading label={t("Đang tải bài tập…")} />
      ) : !list.data?.length ? (
        <Empty title={t("Chưa có bài tập nào.")} />
      ) : (
        <ul className="items">
          {list.data.map((item) => {
            const latest = item.submissions[0];
            return (
              <li key={item.id} className="item">
                <div className="item__top">
                  <span className="item__title" id={`homework-${item.id}`}>{item.title}</span>
                  <AssignmentStatus item={item} />
                </div>
                {item.description && <p className="prose-text">{item.description}</p>}
                <div className="item__meta">
                  {item.due_at && <span>{t("Hạn nộp: {when}", { when: formatDateTime(item.due_at, now) })}</span>}
                  {latest && <span>{t("Đã nộp {n} ảnh lúc {when}", { n: latest.files.filter((f) => f.kind === "original").length, when: formatDateTime(latest.submitted_at, now) })}</span>}
                </div>
                {latest?.status === "returned" && (
                  <div className="homework">
                    {assignmentState(item) === "redo" && <p><strong>{t("Thầy cô yêu cầu em làm lại bài này. Đọc nhận xét rồi nộp lại nhé.")}</strong></p>}
                    {latest.score != null && <p><strong>{t("Điểm: {score}/10", { score: latest.score })}</strong></p>}
                    {latest.teacher_comment && <p className="prose-text">{latest.teacher_comment}</p>}
                    {latest.files.some((f) => f.kind === "annotated") && (
                      <>
                        <p><strong>{t("Bài thầy cô chữa")}</strong></p>
                        <SubmissionImages submission={latest} kind="annotated" />
                      </>
                    )}
                  </div>
                )}
                {item.status !== "returned" && (
                  <div className="btn-row">
                    <Button size="sm" variant={!latest || assignmentState(item) === "redo" ? "primary" : undefined} onClick={() => setSubmitting(item)} aria-describedby={`homework-${item.id}`}>
                      {latest ? t("Nộp lại") : t("Nộp bài")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {submitting && (
        <SubmitDialog
          item={submitting}
          onClose={() => setSubmitting(null)}
          onDone={() => {
            setSubmitting(null);
            toast.success(t("Đã nộp bài."));
            void list.reload();
          }}
          onPartial={() => void list.reload()}
        />
      )}
    </Window>
  );
}
