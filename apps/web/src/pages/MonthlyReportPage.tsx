import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { backend } from "../lib/data";
import { useAsync } from "../lib/hooks";
import { monthlyReportCsv } from "../lib/reportCsv";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Alert, Empty, ErrorState, Loading } from "../ui/Feedback";
import { Window } from "../ui/Window";
import { t } from "../lib/i18n";

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

function MonthResult({ month }: { month: string }) {
  const report = useAsync(() => backend.monthlySessionReport(month), "Không tải được báo cáo tháng.");
  const data = report.data;
  function download() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([monthlyReportCsv(data)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${t("bao-cao-buoi-hoc")}-${month}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  if (report.error) return <ErrorState message={report.error} onRetry={() => void report.reload()} />;
  if (report.loading || !data) return <Loading label={t("Đang tải báo cáo tháng…")} />;
  return (
    <Window title={t("Buổi đã kết thúc · {month}", { month })} file="monthly.csv" variant="mint">
      <div className="btn-row">
        <p><strong>{t("Tổng cộng: {n} buổi", { n: data.total })}</strong></p>
        <Button onClick={download}>{t("Tải CSV")}</Button>
      </div>
      {data.students.length === 0 ? <Empty title={t("Chưa có học sinh trong báo cáo.")} /> : (
        <ul className="items">
          {data.students.map((row) => (
            <li className="item" key={row.student_id}>
              <div className="item__top">
                <span className="item__title">{row.full_name}</span>
                <strong>{t("{n} buổi", { n: row.completed_sessions })}</strong>
              </div>
              <div className="item__meta">{row.grade ? t("Lớp {grade}", { grade: row.grade }) : t("Chưa ghi lớp")}{!row.active && ` · ${t("Đã ngừng dạy")}`}</div>
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}

export default function MonthlyReportPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  if (user?.role !== "teacher") return <AppShell title={t("Báo cáo tháng")}><Alert>{t("Chỉ giáo viên được xem báo cáo.")}</Alert></AppShell>;
  return (
    <AppShell title={t("Báo cáo tháng")}>
      <div className="page__head">
        <div><h1>{t("Báo cáo tháng")}</h1><p className="page__lead">{t("Số buổi đã kết thúc của từng học sinh.")}</p></div>
      </div>
      <Field label={t("Tháng báo cáo")} hint={t("Tính theo giờ Việt Nam, dựa trên ngày bắt đầu đã xếp lịch.")}>
        {(control) => <input {...control} type="month" required value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />}
      </Field>
      <p className="muted">{t("Chỉ tính buổi giáo viên đã bấm kết thúc. Học sinh đang xóa không xuất hiện; dữ liệu đã xóa hẳn không còn trong báo cáo.")}</p>
      <MonthResult key={month} month={month} />
    </AppShell>
  );
}
