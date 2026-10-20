import { t } from "../lib/i18n";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

export type ButtonVariant = "primary" | "secondary" | "accent" | "danger" | "ghost";

interface Look {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
}

function classes({ variant = "secondary", size = "md", block }: Look, extra?: string) {
  return ["btn", variant !== "secondary" && `btn--${variant}`, size !== "md" && `btn--${size}`, block && "btn--block", extra]
    .filter(Boolean)
    .join(" ");
}

interface ButtonProps extends Look, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Đang gửi: khóa nút và đổi chữ (giữ nguyên kích thước vùng chạm) */
  busy?: boolean;
  busyLabel?: string;
  children: ReactNode;
}

export function Button({ variant, size, block, busy, busyLabel, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (busyLabel ?? t("Đang xử lý…")) : children}
    </button>
  );
}

interface ButtonLinkProps extends Look, LinkProps {
  children: ReactNode;
}

/** Liên kết trông như nút (điều hướng thật, mở được bằng bàn phím và tab mới). */
export function ButtonLink({ variant, size, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={classes({ variant, size, block }, className)}>
      {children}
    </Link>
  );
}
