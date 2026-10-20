import { t } from "../lib/i18n";

const LABEL: Record<string, string> = {
  scheduled: "Sắp học",
  live: "Đang diễn ra",
  completed: "Đã học",
  cancelled: "Đã hủy",
  no_show: "Vắng",
};

const TONE: Record<string, string> = {
  scheduled: "scheduled",
  live: "live",
  completed: "done",
  cancelled: "warn",
  no_show: "danger",
};

/** Nhãn trạng thái buổi học: có chữ, không chỉ dựa vào màu. */
export function SessionStatus({ status }: { status: string }) {
  return <span className={`badge badge--${TONE[status] ?? "scheduled"}`}>{LABEL[status] ? t(LABEL[status]) : status}</span>;
}
