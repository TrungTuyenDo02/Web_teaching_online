/**
 * Hai ngôn ngữ (vi mặc định, en) không thêm thư viện: câu tiếng Việt trong code chính là khóa tra bản
 * tiếng Anh ở `i18n-en.ts`. Thiếu bản dịch thì hiện tiếng Việt; test web-i18n.test.ts bắt khóa thiếu.
 * Không dùng React để lib/schedule.ts (chạy trong Node) dùng được; component đăng ký qua `useLang`.
 */
import { useSyncExternalStore } from "react";
import { en } from "./i18n-en.ts";

export type Lang = "vi" | "en";

const KEY = "lang";
const listeners = new Set<() => void>();

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "vi";
  } catch {
    return "vi"; // Node, chế độ riêng tư chặn bộ nhớ
  }
}

let current: Lang = stored();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const lang = () => current;
export const locale = () => (current === "en" ? "en-GB" : "vi-VN");

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* chỉ là tiện ích, không lưu được thì thôi */
  }
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}

/** `t("Còn {n} phút", { n: 5 })`: câu tiếng Việt là khóa; biến trong ngoặc nhọn được thay sau khi dịch. */
export function t(vi: string, vars?: Record<string, string | number>): string {
  const text = current === "en" ? (en[vi] ?? vi) : vi;
  return vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : text;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Đọc ngôn ngữ và vẽ lại khi đổi. App gọi một lần nên cả cây trang vẽ lại với chữ mới. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, lang, lang);
}
