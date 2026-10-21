import { env } from "./env";
import { supabase } from "./supabase";
import { t } from "./i18n";

export type Role = "teacher" | "student";
export type DeviceMode = "main" | "board";

export interface Credentials {
  url: string;
  token: string;
}

export interface JoinResponse {
  session_id: string;
  room_name: string;
  role: Role;
  mode: DeviceMode;
  livekit: Credentials | null;
  whiteboard: Credentials;
}

export interface EndSessionBody {
  summary?: string;
  homework_note?: string;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  const resp = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!resp.ok) {
    let detail = t("Lỗi {status}", { status: resp.status });
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* giữ thông báo mặc định */
    }
    throw new Error(detail);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const joinSession = (sessionId: string, mode: DeviceMode) =>
  apiFetch<JoinResponse>(`/api/sessions/${sessionId}/join`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export const endSession = (sessionId: string, body: EndSessionBody) =>
  // finalize_pending: buổi đã tính là xong nhưng còn việc đóng phòng/lưu bảng; gọi lại được
  apiFetch<{ session_id: string; status: string; ended_at: string; finalize_pending: boolean }>(
    `/api/sessions/${sessionId}/end`,
    { method: "POST", body: JSON.stringify(body) },
  );

export interface SessionCreate {
  student_id: string;
  subject?: string;
  topic?: string;
  scheduled_start: string; // ISO có múi giờ
  scheduled_end: string;
}

export const createSession = (body: SessionCreate) =>
  apiFetch<{ id: string }>("/api/sessions", { method: "POST", body: JSON.stringify(body) });

export const cancelSession = (sessionId: string) =>
  apiFetch<{ id: string; status: string }>(`/api/sessions/${sessionId}/cancel`, { method: "POST" });

export const createStudentAccount = (studentId: string, email: string, password: string) =>
  apiFetch<{ student_id: string; profile_id: string; email: string }>(
    `/api/students/${studentId}/account`,
    { method: "POST", body: JSON.stringify({ email, password }) },
  );

export type SessionUpdate = Partial<Omit<SessionCreate, "student_id">>;

export const updateSession = (sessionId: string, body: SessionUpdate) =>
  apiFetch<{ id: string }>(`/api/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(body) });

/** Khớp StudentRow trong apps/api/app/models.py */
export interface Student {
  id: string;
  profile_id: string | null;
  full_name: string;
  grade: string | null;
  goals: string | null;
  notes: string | null;
  guardian_name: string | null;
  guardian_contact: string | null;
  consent_at: string | null;
  active: boolean;
  /** Đang xóa hẳn mà chưa xong (lỗi giữa chừng); bấm xóa lần nữa hoặc chờ hệ thống tự làm tiếp */
  deleting_at: string | null;
  /** Số buổi giáo viên đã bấm "Kết thúc" */
  completed_sessions: number;
}

/** Chuỗi rỗng nghĩa là xóa giá trị; consent: máy chủ ghi thời điểm đồng ý. */
export interface StudentInput {
  full_name?: string;
  grade?: string;
  goals?: string;
  notes?: string;
  guardian_name?: string;
  guardian_contact?: string;
  consent?: boolean;
  active?: boolean;
}

export const listStudents = () => apiFetch<Student[]>("/api/students");

export interface MonthlySessionReport {
  month: string;
  timezone: string;
  period_start: string;
  period_end: string;
  total: number;
  students: { student_id: string; full_name: string; grade: string | null; active: boolean; completed_sessions: number }[];
}

export const monthlySessionReport = (month: string) =>
  apiFetch<MonthlySessionReport>(`/api/reports/sessions?month=${encodeURIComponent(month)}`);

export interface TeachingTopic { id: string; name: string; grade: string }
export interface TeachingRecord {
  session_id: string;
  scheduled_start: string;
  subject: string | null;
  scheduled_topic: string | null;
  revision: number;
  updated_at: string | null;
  summary_md: string;
  understanding_level: string;
  improve_points: string;
  homework_text: string;
  topic_ids: string[];
}
export type TeachingNoteInput = Pick<TeachingRecord, "summary_md" | "understanding_level" | "improve_points" | "homework_text" | "topic_ids"> & { expected_revision: number };
export const listTeachingTopics = () => apiFetch<TeachingTopic[]>("/api/topics");
export const createTeachingTopic = (name: string, grade: string) =>
  apiFetch<TeachingTopic>("/api/topics", { method: "POST", body: JSON.stringify({ name, grade }) });
export const getTeachingRecord = (sessionId: string) => apiFetch<TeachingRecord>(`/api/sessions/${sessionId}/teaching-note`);
export const saveTeachingRecord = (sessionId: string, body: TeachingNoteInput) =>
  apiFetch<TeachingRecord>(`/api/sessions/${sessionId}/teaching-note`, { method: "PUT", body: JSON.stringify(body) });
export const listTeachingRecords = (studentId: string, month: string) =>
  apiFetch<TeachingRecord[]>(`/api/students/${studentId}/teaching-notes?month=${encodeURIComponent(month)}`);

export const createStudent = (body: StudentInput) =>
  apiFetch<Student>("/api/students", { method: "POST", body: JSON.stringify(body) });

export const updateStudent = (studentId: string, body: StudentInput) =>
  apiFetch<Student>(`/api/students/${studentId}`, { method: "PATCH", body: JSON.stringify(body) });

export const deleteStudent = (studentId: string) =>
  apiFetch<void>(`/api/students/${studentId}`, { method: "DELETE" });

export const resetStudentPassword = (studentId: string, password: string) =>
  apiFetch<void>(`/api/students/${studentId}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });

/** Lịch cố định hằng tuần (khớp WeeklySlot trong apps/api/app/models.py). weekday: 1 = thứ Hai … 7 = Chủ nhật */
export interface WeeklySlot {
  id: string;
  student_id: string;
  weekday: number;
  start_time: string; // "HH:MM" giờ Việt Nam
  duration_minutes: number;
  subject: string | null;
  topic: string | null;
  starts_on: string;
  active: boolean;
}

export interface WeeklySlotInput {
  student_id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  subject?: string;
  starts_on?: string;
}

export const listWeeklySlots = () => apiFetch<WeeklySlot[]>("/api/weekly-slots");

export interface AssistantStatus { enabled: boolean; student_lessons: boolean; daily_limit: number }
export interface AssistantSource { id: string; title: string; excerpt: string; path: string; kind: "guide" | "lesson" }
export interface AssistantAnswer { answer: string; sources: AssistantSource[]; mode: "openai" }
export interface AssistantMaterial { id: string; teacher_id: string; topic_id: string; title: string; content: string; student_visible: boolean; created_at: string }
export type AssistantMaterialInput = Pick<AssistantMaterial, "topic_id" | "title" | "content" | "student_visible">;
export const assistantStatus = () => apiFetch<AssistantStatus>("/api/assistant/status");
export const askAssistant = (body: { question: string; language: "vi" | "en"; consent: true; history: { question: string; answer: string }[] }, signal?: AbortSignal) =>
  apiFetch<AssistantAnswer>("/api/assistant/chat", { method: "POST", body: JSON.stringify(body), signal });
export const listAssistantMaterials = () => apiFetch<AssistantMaterial[]>("/api/assistant/materials");
export const getAssistantMaterial = (id: string) => apiFetch<AssistantMaterial>(`/api/assistant/materials/${id}`);
export const createAssistantMaterial = (body: AssistantMaterialInput) => apiFetch<AssistantMaterial>("/api/assistant/materials", { method: "POST", body: JSON.stringify(body) });
export const deleteAssistantMaterial = (id: string) => apiFetch<void>(`/api/assistant/materials/${id}`, { method: "DELETE" });

export const createWeeklySlot = (body: WeeklySlotInput) =>
  apiFetch<{ slot: WeeklySlot; created: number; skipped: string[] }>("/api/weekly-slots", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const stopWeeklySlot = (slotId: string) =>
  apiFetch<{ slot: WeeklySlot; cancelled: number }>(`/api/weekly-slots/${slotId}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false }),
  });

