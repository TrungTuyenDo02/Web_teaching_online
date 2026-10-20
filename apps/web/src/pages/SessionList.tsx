import type { SessionItem } from "../lib/data";
import { durationMinutes, formatDateTime, formatTime } from "../lib/schedule";
import { Button, ButtonLink } from "../ui/Button";
import { SessionStatus } from "../ui/SessionStatus";
import { t } from "../lib/i18n";

export function sessionTitle(item: { subject: string | null; topic: string | null }) {
  return [item.subject || t("Buổi học"), item.topic].filter(Boolean).join(" · ");
}

interface Props {
  items: SessionItem[];
  now: Date;
  /** Giáo viên: có tên học sinh, nút tablet, sửa, hủy */
  teacher: boolean;
  onEdit?: (item: SessionItem) => void;
  onCancel?: (item: SessionItem) => void;
}

/** Danh sách buổi sắp học/hôm nay; mỗi buổi có nút vào lớp ngay trên dòng. */
export function SessionList({ items, now, teacher, onEdit, onCancel }: Props) {
  return (
    <ul className="items">
      {items.map((item) => (
        <li key={item.id} className="item">
          <div className="item__top">
            <span className="item__title">{sessionTitle(item)}</span>
            <SessionStatus status={item.status} />
          </div>
          <div className="item__meta">
            {teacher && <span>{t("Học sinh: {name}", { name: item.student_name || "—" })}</span>}
            <span>
              {formatDateTime(item.scheduled_start, now)}–{formatTime(item.scheduled_end)}
            </span>
            <span>{t("{n} phút", { n: durationMinutes(item) })}</span>
          </div>
          <div className="btn-row">
            <ButtonLink variant="primary" size="sm" to={`/room/${item.id}?mode=main`}>
              {t("Vào lớp")}
            </ButtonLink>
            {teacher && (
              <ButtonLink size="sm" to={`/room/${item.id}?mode=board`}>
                {t("Bảng trên tablet")}
              </ButtonLink>
            )}
            {teacher && item.status === "scheduled" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => onEdit?.(item)}>
                  {t("Sửa")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onCancel?.(item)}>
                  {t("Hủy buổi")}
                </Button>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
