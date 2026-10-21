import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import type { AssistantMaterial } from "../lib/api";
import { backend, errorMessage } from "../lib/data";
import { useAsync } from "../lib/hooks";
import { t } from "../lib/i18n";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Alert, Empty, ErrorState, Loading } from "../ui/Feedback";
import { Window } from "../ui/Window";

function Source({ id }: { id: string }) {
  const source = useAsync(() => backend.getAssistantMaterial(id), "Không tải được tài liệu.");
  if (source.error) return <ErrorState message={source.error} onRetry={() => void source.reload()} />;
  if (!source.data) return <Loading />;
  return <Window title={source.data.title} file="material.txt"><div className="material-text">{source.data.content}</div></Window>;
}

function Manage() {
  const materials = useAsync(() => backend.listAssistantMaterials(), "Không tải được kho bài giảng. Hãy kiểm tra migration 0010.");
  const topics = useAsync(() => backend.listTeachingTopics(), "Không tải được chủ đề.");
  const [editor, setEditor] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [visible, setVisible] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AssistantMaterial | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true); setError(null);
    try {
      await backend.createAssistantMaterial({ title, topic_id: topic, content, student_visible: visible });
      setEditor(false); setTitle(""); setContent(""); setVisible(false); setConfirmed(false);
      await materials.reload();
    } catch (err) { setError(errorMessage(err, "Không lưu được bài giảng.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setError(null);
    try { await backend.deleteAssistantMaterial(deleting.id); setDeleting(null); await materials.reload(); }
    catch (err) { setError(errorMessage(err, "Không gỡ được bài giảng.")); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><h1>{t("Bài giảng cho trợ lý AI")}</h1><p className="muted">{t("Nhập văn bản đã kiểm tra và gắn chủ đề. Bản đầu chưa đọc PDF hoặc ảnh.")}</p></div>
      <Button onClick={() => { setEditor(true); setError(null); }} disabled={!topics.data?.length}>{t("Thêm bài giảng")}</Button></div>
    <Alert tone="info">{t("Không nhập lời giải tham chiếu, ghi chú riêng hay thông tin cá nhân học sinh. Khi bật AI, trích đoạn phù hợp có thể được gửi OpenAI.")}</Alert>
    {topics.error && <ErrorState message={topics.error} onRetry={() => void topics.reload()} />}
    {topics.data?.length === 0 && <p>{t("Hãy tạo chủ đề trong Ghi chú riêng trước khi thêm bài giảng.")}</p>}
    {materials.error ? <ErrorState message={materials.error} onRetry={() => void materials.reload()} /> : materials.loading ? <Loading /> :
      <Window title={t("Kho bài giảng")} file="rag.txt">
        {!materials.data?.length ? <Empty title={t("Chưa có bài giảng")} /> : <div className="stack">{materials.data.map((row) => <article key={row.id} className="item">
          <h3>{row.title}</h3><p className="material-text">{row.content.slice(0, 240)}</p>
          <p className="muted">{row.student_visible ? t("Đã cho phép dùng với học sinh đã học chủ đề này") : t("Chỉ giáo viên dùng với AI")}</p>
          <div className="btn-row"><a className="btn btn--sm" href={`/assistant-materials/${row.id}`}>{t("Xem tài liệu")}</a><Button size="sm" onClick={() => { setDeleting(row); setError(null); }}>{t("Gỡ bài giảng")}</Button></div>
        </article>)}</div>}
      </Window>}
    <Dialog open={editor} title={t("Thêm bài giảng")} onClose={() => setEditor(false)} busy={busy}>
      <form className="form" onSubmit={(event) => void save(event)}>
        <Field label={t("Tiêu đề bài giảng")}>{(c) => <input {...c} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />}</Field>
        <Field label={t("Chủ đề bài giảng")}>{(c) => <select {...c} value={topic} onChange={(e) => setTopic(e.target.value)} required><option value="">{t("Chọn chủ đề")}</option>{topics.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</Field>
        <Field label={t("Nội dung bài giảng")}>{(c) => <textarea {...c} rows={10} value={content} onChange={(e) => setContent(e.target.value)} required minLength={20} maxLength={24000} />}</Field>
        <label className="check-row"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />{t("Cho phép dùng với học sinh đã học chủ đề này")}</label>
        <p className="muted">{t("Quyền này chỉ có hiệu lực sau khi tính năng bài giảng cho học sinh được nghiệm thu và bật trên API.")}</p>
        <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required />{t("Tôi đã kiểm tra: đây là bài giảng, không có lời giải tham chiếu hoặc dữ liệu cá nhân.")}</label>
        {error && <Alert tone="error">{error}</Alert>}<Button type="submit" busy={busy} disabled={!confirmed}>{t("Lưu bài giảng")}</Button>
      </form>
    </Dialog>
    <ConfirmDialog open={Boolean(deleting)} title={t("Gỡ bài giảng?")} confirmLabel={t("Gỡ bài giảng")} danger busy={busy} error={error} onClose={() => setDeleting(null)} onConfirm={() => void remove()}>
      {t("Bài giảng và các đoạn tra cứu của nó sẽ bị xóa. Câu trả lời đã nhận trước đó không được thu hồi.")}
    </ConfirmDialog>
  </>;
}

export default function AssistantMaterialsPage() {
  const { user } = useAuth();
  const { materialId } = useParams();
  return <AppShell>{materialId ? <Source key={materialId} id={materialId} /> : user?.role === "teacher" ? <Manage /> : <Alert tone="error">{t("Chỉ giáo viên được quản lý tài liệu")}</Alert>}</AppShell>;
}
