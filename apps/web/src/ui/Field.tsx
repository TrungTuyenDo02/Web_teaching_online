import { t } from "../lib/i18n";
import { useId, type ReactNode } from "react";

/** Thuộc tính gắn vào ô nhập để nhãn, gợi ý và lỗi được đọc đúng bởi trình đọc màn hình. */
export interface ControlProps {
  id: string;
  className: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  /** Lỗi tại trường; hiện dưới ô và đánh dấu aria-invalid */
  error?: string | null;
  required?: boolean;
  children: (control: ControlProps) => ReactNode;
}

export function Field({ label, hint, error, required, children }: Props) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> ({t("bắt buộc")})</span>}
      </label>
      {children({
        id,
        className: "input",
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
