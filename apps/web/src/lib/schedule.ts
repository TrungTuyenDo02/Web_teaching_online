/**
 * Hàm thuần cho lịch học (không React, không Supabase) để test trong Node:
 * services/whiteboard-sync/test/web-schedule.test.ts.
 */
import { locale, t } from "./i18n.ts";

export interface Timed {
  status: string;
  scheduled_start: string;
  scheduled_end: string;
}

const MINUTE = 60_000;

/** Buổi nổi bật: buổi đang diễn ra, nếu không thì buổi sắp học sớm nhất chưa qua giờ kết thúc. */
export function nextSession<T extends Timed>(items: readonly T[], now: Date): T | undefined {
  const live = items.find((s) => s.status === "live");
  if (live) return live;
  return [...items]
    .filter((s) => s.status === "scheduled" && Date.parse(s.scheduled_end) > now.getTime())
    .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start))[0];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Chia phần còn lại (trừ buổi nổi bật) thành hôm nay và các ngày sau, theo giờ địa phương. */
export function groupByDay<T extends Timed>(items: readonly T[], now: Date, exclude?: T) {
  const today: T[] = [];
  const later: T[] = [];
  const sorted = [...items].sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
  for (const s of sorted) {
    if (s === exclude) continue;
    (dayKey(new Date(s.scheduled_start)) === dayKey(now) ? today : later).push(s);
  }
  return { today, later };
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso: string, now: Date): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return t("Hôm nay");
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dayKey(d) === dayKey(tomorrow)) return t("Ngày mai");
  return d.toLocaleDateString(locale(), { weekday: "long", day: "2-digit", month: "2-digit" });
}

export function formatDateTime(iso: string, now: Date): string {
  return `${formatDay(iso, now)} · ${formatTime(iso)}`;
}

/** Câu ngắn về thời điểm bắt đầu: "Đang diễn ra", "Bắt đầu sau 25 phút", "Hôm nay · 14:00". */
export function relativeStart(item: Timed, now: Date): string {
  if (item.status === "live") return t("Đang diễn ra");
  const diff = Date.parse(item.scheduled_start) - now.getTime();
  if (diff <= 0 && Date.parse(item.scheduled_end) > now.getTime()) return t("Đã đến giờ học");
  if (diff > 0 && diff < 60 * MINUTE) return t("Bắt đầu sau {n} phút", { n: Math.max(1, Math.round(diff / MINUTE)) });
  return formatDateTime(item.scheduled_start, now);
}

export function durationMinutes(item: Timed): number {
  return Math.round((Date.parse(item.scheduled_end) - Date.parse(item.scheduled_start)) / MINUTE);
}

/** ISO → giá trị ô datetime-local (giờ địa phương, không múi giờ). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export type SessionField = "student" | "start" | "duration" | "form";

/** Gắn thông báo lỗi của API (tiếng Việt, xem routers/sessions.py) vào đúng trường của form. */
export function sessionErrorField(message: string): SessionField {
  const m = message.toLowerCase();
  if (m.includes("trùng giờ") || m.includes("thời gian đã qua")) return "start";
  if (m.includes("tối đa 4 giờ") || m.includes("giờ kết thúc")) return "duration";
  if (m.includes("học sinh")) return "student";
  return "form";
}
