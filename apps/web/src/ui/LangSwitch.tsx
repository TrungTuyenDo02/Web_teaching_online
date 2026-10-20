import { setLang, t, useLang, type Lang } from "../lib/i18n";

// Tên ngôn ngữ viết bằng chính ngôn ngữ đó (không dịch), để ai cũng tìm được ngôn ngữ của mình
const OPTIONS: [Lang, string, string][] = [
  ["vi", "VI", "Tiếng Việt"],
  ["en", "EN", "English"],
];

/** Chọn ngôn ngữ giao diện; lưu trên máy này (lib/i18n.ts). */
export function LangSwitch() {
  const current = useLang();
  return (
    <div className="segmented lang-switch" role="group" aria-label={t("Ngôn ngữ")}>
      {OPTIONS.map(([code, short, name]) => (
        <button key={code} type="button" lang={code} aria-pressed={current === code} aria-label={name} onClick={() => setLang(code)}>
          {short}
        </button>
      ))}
    </div>
  );
}
