import { useCallback, useEffect, useRef, useState } from "react";
import { brand } from "../brand";
import { errorMessage } from "./data";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Tải lại (sau thao tác ghi); giữ dữ liệu cũ trên màn hình trong lúc tải */
  reload: () => Promise<void>;
}

/** Tiêu đề tab nói rõ trang (WCAG 2.4.2); trả lại tên chung khi rời trang. `title` đã qua t() nên theo ngôn ngữ. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${brand.name}` : brand.name;
    return () => {
      document.title = brand.name;
    };
  }, [title]);
}

/** Tải dữ liệu khi mở trang; lỗi được đổi thành câu tiếng Việt để hiện ErrorState. */
export function useAsync<T>(loader: () => Promise<T>, fallbackError: string): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loaderRef.current();
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (alive.current) setError(errorMessage(err, fallbackError));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [fallbackError]);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, error, loading, reload };
}

/** Thời điểm hiện tại, cập nhật mỗi phút (đủ cho "bắt đầu sau N phút"). */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
