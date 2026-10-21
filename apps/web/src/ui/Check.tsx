import type { InputHTMLAttributes, ReactNode } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "children"> & { children: ReactNode };

/** Ô tích có nhãn bao ngoài: ô 24 px trong dòng cao 44 px, bấm cả chữ được (DESIGN.md 5.3). */
export function Check({ children, ...input }: Props) {
  return (
    <label className="check">
      <input {...input} type="checkbox" />
      <span>{children}</span>
    </label>
  );
}
