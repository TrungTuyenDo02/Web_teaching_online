import type { ReactNode } from "react";

export type BadgeTone = "scheduled" | "live" | "done" | "warn" | "danger";

/** Nhãn trạng thái nhỏ: luôn có chữ, màu chỉ là phụ (DESIGN.md 5.11). */
export function Badge({ tone = "scheduled", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
