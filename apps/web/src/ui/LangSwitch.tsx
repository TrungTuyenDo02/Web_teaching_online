import { setLang, t, useLang, type Lang } from "../lib/i18n";
import { Segmented } from "./Segmented";

// Tên ngôn ngữ viết bằng chính ngôn ngữ đó (không dịch), để ai cũng tìm được ngôn ngữ của mình.
// Tên đọc bắt đầu bằng chữ đang hiện (VI/EN) để lệnh giọng nói "bấm VI" vẫn khớp (WCAG 2.5.3)
const OPTIONS: [Lang, string, string][] = [
  ["vi", "VI", "Tiếng Việt"],
  ["en", "EN", "English"],
];

/** Chọn ngôn ngữ giao diện; lưu trên máy này (lib/i18n.ts). */
export function LangSwitch() {
  const current = useLang();
  return (
    <Segmented
      className="lang-switch"
      label={t("Ngôn ngữ")}
      value={current}
      onChange={setLang}
      options={OPTIONS.map(([code, short, name]) => ({ value: code, label: short, lang: code, ariaLabel: `${short} – ${name}` }))}
    />
  );
}
