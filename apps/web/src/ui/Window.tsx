import { useId, type ReactNode } from "react";

export type WindowVariant = "lavender" | "pink" | "peach" | "periwinkle" | "mint" | "danger" | "glass";

interface Props {
  /** Tiêu đề tiếng Việt (là heading của vùng) */
  title: ReactNode;
  /** Tên tệp trang trí trên title bar, chỉ ký tự ASCII (font pixel không có dấu tiếng Việt) */
  file?: string;
  variant?: WindowVariant;
  /** Nút thật trên title bar (mỗi nút ≥ 44px); không có nút đóng/thu nhỏ giả */
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  /** Thân không có padding (bảng, danh sách sát mép) */
  flush?: boolean;
  className?: string;
  id?: string;
  /** Id cho tiêu đề (Dialog dùng để đặt tên cho thẻ <dialog>) */
  titleId?: string;
  children: ReactNode;
}

/** Cửa sổ có title bar (DESIGN.md 5.1). Ba chấm trang trí không phải nút và không nhận focus. */
export function Window({
  title,
  file,
  variant = "lavender",
  actions,
  headingLevel = 2,
  flush,
  className,
  id,
  titleId: givenTitleId,
  children,
}: Props) {
  const ownTitleId = useId();
  const titleId = givenTitleId ?? ownTitleId;
  const Heading = `h${headingLevel}` as const;
  const classes = ["window", `window--${variant}`, flush && "window--flush", className].filter(Boolean);
  return (
    <section className={classes.join(" ")} aria-labelledby={titleId} id={id}>
      <div className="window__titlebar">
        <span className="window__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div className="window__title">
          <Heading id={titleId}>{title}</Heading>
          {file && (
            <span className="window__file" aria-hidden="true">
              {file}
            </span>
          )}
        </div>
        {actions && <div className="window__actions">{actions}</div>}
      </div>
      <div className="window__body">{children}</div>
    </section>
  );
}
