import type { ReactNode } from "react";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Tên đọc khác chữ hiện (phải bắt đầu bằng chữ hiện, WCAG 2.5.3) */
  ariaLabel?: string;
  lang?: string;
}

interface Props<V extends string> {
  /** Tên nhóm cho trình đọc màn hình */
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
}

/** Nhóm nút bật/tắt chọn một (DESIGN.md 5.12): mỗi nút ≥ 44 px, trạng thái qua aria-pressed. */
export function Segmented<V extends string>({ label, options, value, onChange, disabled, className }: Props<V>) {
  return (
    <div className={["segmented", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.lang}
          aria-label={option.ariaLabel}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
