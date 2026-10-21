import { useState, type FormEvent } from "react";
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
import { AssignmentStatus } from "../AssignmentsPage";

const MAX_FILES = 6;

function SubmitDialog({ item, onClose, onDone, onPartial }: { item: AssignmentItem; onClose: () => void; onDone: () => void; onPartial: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!files.length) return setError(t("Hãy chọn ít nhất một ảnh bài làm."));
    if (files.length > MAX_FILES) return setError(t("Mỗi lần nộp tối đa {n} ảnh.", { n: MAX_FILES }));
    setError(null);
    let submissionId: string | null = null;
    try {
      for (const [i, file] of files.entries()) {
        setProgress(t("Đang gửi ảnh {i}/{n}…", { i: i + 1, n: files.length }));
        const image = await prepareImage(file);
        if (submissionId) await backend.addSubmissionImage(submissionId, image);
        else submissionId = (await backend.submitAssignment(item.id, image)).id;
      }
      onDone();
    } catch (err) {
      // Ảnh đã gửi trước khi lỗi vẫn được lưu: báo rõ để em không nộp trùng
      setError(
        submissionId
          ? t("Đã gửi một phần. {reason} Hãy báo thầy cô nếu thiếu ảnh.", { reason: errorMessage(err, "Không gửi được ảnh.") })
          : errorMessage(err, "Không nộp được bài."),
      );
      if (submissionId) onPartial(); // tải lại danh sách, giữ hộp thoại để em đọc lỗi
    } finally {
      setProgress(null);
    }
  }

  return (
    <Dialog open title={t("Nộp bài · {title}", { title: item.title })} file="upload.jpg" variant="peach" onClose={onClose} busy={progress !== null}>
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        {item.description && <p className="prose-text">{item.description}</p>}
        <Field label={t("Ảnh bài làm")} required hint={t("Chụp rõ từng trang, tối đa {n} ảnh (JPEG, PNG, WebP).", { n: MAX_FILES })}>
          {(c) => <input {...c} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />}
        </Field>
        <Alert tone="info">
          {t("Ảnh chỉ thầy cô và em xem được. Vị trí chụp và thông tin máy ảnh được gỡ trước khi lưu. Thầy cô có thể nhờ AI (Google Gemini) đọc chữ trong ảnh để chấm nhanh hơn.")}
        </Alert>
        <p className="sr-only" role="status">{progress ?? ""}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={progress !== null}>{t("Thôi")}</Button>
          <Button type="submit" variant="primary" busy={progress !== null} busyLabel={progress ?? undefined}>{t("Nộp bài")}</Button>
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
                  <AssignmentStatus status={item.status} />
                </div>
                {item.description && <p className="prose-text">{item.description}</p>}
                <div className="item__meta">
                  {item.due_at && <span>{t("Hạn nộp: {when}", { when: formatDateTime(item.due_at, now) })}</span>}
                  {latest && <span>{t("Đã nộp {n} ảnh lúc {when}", { n: latest.files.length, when: formatDateTime(latest.submitted_at, now) })}</span>}
                </div>
                {latest?.status === "returned" && (
                  <div className="homework">
                    {latest.score != null && <p><strong>{t("Điểm: {score}/10", { score: latest.score })}</strong></p>}
                    {latest.teacher_comment && <p className="prose-text">{latest.teacher_comment}</p>}
                  </div>
                )}
                {item.status !== "returned" && (
                  <div className="btn-row">
                    <Button size="sm" variant={latest ? undefined : "primary"} onClick={() => setSubmitting(item)} aria-describedby={`homework-${item.id}`}>
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
