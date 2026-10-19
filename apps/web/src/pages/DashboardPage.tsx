import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { brand } from "../brand";
import { supabase } from "../lib/supabase";

interface SessionItem {
  id: string;
  subject: string | null;
  topic: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
  students: { full_name: string } | { full_name: string }[] | null;
}

const statusLabel: Record<string, string> = {
  scheduled: "Sắp học",
  live: "Đang học",
  completed: "Đã xong",
  cancelled: "Đã hủy",
  no_show: "Vắng",
};

function studentName(item: SessionItem): string {
  const s = Array.isArray(item.students) ? item.students[0] : item.students;
  return s?.full_name ?? "";
}

export default function DashboardPage() {
  const { signOut } = useAuth();
  const [items, setItems] = useState<SessionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    // RLS tự lọc: giáo viên thấy buổi học của mình, học sinh chỉ thấy buổi của em
    supabase
      .from("sessions")
      .select("id, subject, topic, scheduled_start, scheduled_end, status, students(full_name)")
      .in("status", ["scheduled", "live"])
      .order("scheduled_start", { ascending: true })
      .limit(20)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setItems((data ?? []) as unknown as SessionItem[]);
      });
  }, []);

  return (
    <main className="page">
      <header className="bar">
        <strong>{brand.name}</strong>
        <button className="ghost" onClick={() => void signOut()}>Đăng xuất</button>
      </header>

      <h2>Buổi học sắp tới</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {!items && !error && <p className="muted">Đang tải…</p>}
      {items?.length === 0 && <p className="muted">Chưa có buổi học nào.</p>}

      <ul className="list">
        {items?.map((item) => (
          <li key={item.id} className="card">
            <div>
              <strong>{item.subject ?? "Buổi học"}</strong>
              {item.topic ? ` · ${item.topic}` : ""}
              <div className="muted">
                {studentName(item)} · {new Date(item.scheduled_start).toLocaleString("vi-VN")} ·{" "}
                {statusLabel[item.status] ?? item.status}
              </div>
            </div>
            <div className="row">
              <Link className="btn" to={`/room/${item.id}?mode=main`}>Vào lớp</Link>
              <Link className="btn ghost" to={`/room/${item.id}?mode=board`}>Dùng làm bảng viết</Link>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
