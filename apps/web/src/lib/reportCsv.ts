import { t } from "./i18n.ts";
import { csvCell } from "./csv.ts";

interface CsvReport {
  month: string;
  students: { full_name: string; grade: string | null; completed_sessions: number }[];
}

/** CSV là dữ liệu tải về, không được biến tên/lớp do người dùng nhập thành công thức Excel. */
export function monthlyReportCsv(report: CsvReport): string {
  const rows = [
    [t("Tháng"), t("Học sinh"), t("Lớp"), t("Số buổi đã kết thúc")],
    ...report.students.map((row) => [report.month, row.full_name, row.grade ?? "", row.completed_sessions]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

