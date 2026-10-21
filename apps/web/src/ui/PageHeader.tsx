import type { ReactNode } from "react";

/** Đầu trang: h1 duy nhất của trang, một câu dẫn, thao tác chính bên phải (DESIGN.md 6). */
export function PageHeader({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page__head">
      <div>
        <h1>{title}</h1>
        {lead && <p className="page__lead">{lead}</p>}
      </div>
      {actions}
    </div>
  );
}
