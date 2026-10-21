import { t } from "../lib/i18n";
import { Badge, type BadgeTone } from "./Badge";

const LABEL: Record<string, string> = {
  scheduled: "Sắp học",
  live: "Đang diễn ra",
  completed: "Đã học",
  cancelled: "Đã hủy",
  no_show: "Vắng",
};

const TONE: Record<string, BadgeTone> = {
  scheduled: "scheduled",
  live: "live",
  completed: "done",
  cancelled: "warn",
  no_show: "danger",
};

/** Nhãn trạng thái buổi học: có chữ, không chỉ dựa vào màu. */
export function SessionStatus({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? "scheduled"}>{LABEL[status] ? t(LABEL[status]) : status}</Badge>;
}
