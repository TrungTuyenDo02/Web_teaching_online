import { useState, type FormEvent } from "react";
import { backend, errorMessage, type Student } from "../../lib/data";
import { useAsync } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { formatDateTime } from "../../lib/schedule";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Alert, ErrorState, Loading, useToast } from "../../ui/Feedback";

// weekday của API: 1 = thứ Hai … 7 = Chủ nhật
const WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
const DURATIONS = [45, 60, 90, 120, 180];

/** Lịch cố định của một học sinh: xem, thêm, ngừng. API sinh buổi 4 tuần tới và bổ sung dần (M1a.3). */
export function WeeklySlotsDialog({ student, onClose }: { student: Student; onClose: () => void }) {
  const toast = useToast();
  const slots = useAsync(() => backend.listWeeklySlots(), "Không tải được lịch cố định.");
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("19:00");
  const [minutes, setMinutes] = useState(60);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const mine = (slots.data ?? []).filter((s) => s.student_id === student.id && s.active);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(time)) return setError(t("Hãy chọn giờ bắt đầu."));
    setBusy(true);
    setError(null);
    try {
      const result = await backend.createWeeklySlot({
        student_id: student.id,
        weekday,
        start_time: time,
        duration_minutes: minutes,
        subject: subject.trim() || undefined,
      });
      toast.success(t("Đã thêm lịch, xếp {n} buổi trong 4 tuần tới.", { n: result.created }));
      if (result.skipped.length) {
        const when = result.skipped.map((iso) => formatDateTime(iso, new Date())).join(", ");
        toast.info(t("Bỏ qua buổi trùng giờ với buổi khác: {when}.", { when }));
      }
      setSubject("");
      await slots.reload();
    } catch (err) {
      setError(errorMessage(err, "Không thêm được lịch cố định."));
    } finally {
      setBusy(false);
    }
  }

  async function stop(slotId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await backend.stopWeeklySlot(slotId);
      toast.success(t("Đã ngừng lịch, hủy {n} buổi sắp tới.", { n: result.cancelled }));
      setStopping(null);
      await slots.reload();
    } catch (err) {
      setError(errorMessage(err, "Không ngừng được lịch cố định."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={t("Lịch hằng tuần · {name}", { name: student.full_name })} file="weekly.cal" variant="mint" onClose={onClose} busy={busy}>
      {slots.error ? (
        <ErrorState message={slots.error} onRetry={() => void slots.reload()} />
      ) : slots.loading && !slots.data ? (
        <Loading label={t("Đang tải lịch cố định…")} />
      ) : mine.length === 0 ? (
        <p className="muted">{t("Chưa có lịch cố định.")}</p>
      ) : (
        <ul className="items">
          {mine.map((s) => (
            <li key={s.id} className="item">
              <div className="item__top">
                <span className="item__title">
                  {t(WEEKDAYS[s.weekday - 1]!)} · {s.start_time} · {t("{n} phút", { n: s.duration_minutes })}
                </span>
                {s.subject && <span className="muted">{s.subject}</span>}
              </div>
              {stopping === s.id ? (
                <Alert
                  tone="warning"
                  action={
                    <div className="btn-row">
                      <Button size="sm" variant="danger" busy={busy} onClick={() => void stop(s.id)}>
                        {t("Ngừng lịch")}
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => setStopping(null)}>
                        {t("Thôi")}
                      </Button>
                    </div>
                  }
                >
                  {t("Không xếp thêm buổi; các buổi sắp tới của lịch này chuyển sang \"Đã hủy\". Buổi đã học giữ nguyên.")}
                </Alert>
              ) : (
                <div className="btn-row">
                  <Button size="sm" disabled={busy} onClick={() => setStopping(s.id)}>
                    {t("Ngừng lịch…")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="form" onSubmit={(event) => void create(event)}>
        <h3>{t("Thêm lịch")}</h3>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="form__grid">
          <Field label={t("Thứ")}>
            {(c) => (
              <select {...c} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {t(label)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("Giờ bắt đầu")} hint={t("Giờ Việt Nam")}>
            {(c) => <input {...c} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />}
          </Field>
          <Field label={t("Thời lượng")}>
            {(c) => (
              <select {...c} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {DURATIONS.map((m) => (
                  <option key={m} value={m}>
                    {t("{n} phút", { n: m })}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("Môn")} hint={t("Ví dụ: Toán")}>
            {(c) => <input {...c} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={100} />}
          </Field>
        </div>
        <p className="muted">
          {t("Hệ thống tự xếp các buổi 4 tuần tới và bổ sung dần. Ngày trùng giờ với buổi khác sẽ được bỏ qua, không ghi đè.")}
        </p>
        <div className="btn-row btn-row--end">
          <Button type="submit" variant="primary" busy={busy} busyLabel={t("Đang lưu…")}>
            {t("Thêm lịch")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
