/**
 * Một chỗ cho mọi lần đọc/ghi dữ liệu của trang: đọc trực tiếp Supabase (RLS lọc theo người dùng),
 * ghi qua API (quyết định 12). Chế độ xem trước (chỉ bản development) thay bằng dữ liệu minh họa
 * qua `setBackend`, các trang và component giữ nguyên.
 */
import * as api from "./api";
import { supabase } from "./supabase";
import { t } from "./i18n";
import { readBoardDocument, type BoardDocument } from "./boardFiles";

export type { AssignmentInput, DeviceMode, JoinResponse, Role, SessionCreate, SessionUpdate, Student, StudentInput, WeeklySlot, WeeklySlotInput } from "./api";

export interface SessionItem {
  id: string;
  student_id: string;
  student_name: string;
  subject: string | null;
  topic: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
}

export interface PastSession {
  id: string;
  student_id: string;
  student_name: string;
  subject: string | null;
  topic: string | null;
  scheduled_start: string;
  summary: string | null;
  homework_note: string | null;
  board_snapshot_path: string | null;
}

export interface StudentOption {
  id: string;
  full_name: string;
}

export type EndResult = Awaited<ReturnType<typeof api.endSession>>;

export interface SubmissionItem extends api.Submission {
  files: api.SubmissionFile[];
  /** Kết quả OCR mới nhất trước; RLS trả rỗng cho học sinh (gợi ý chỉ cho giáo viên) */
  transcripts: api.Transcript[];
}

export interface AssignmentItem extends api.Assignment {
  student_name: string;
  /** Lượt nộp mới nhất trước */
  submissions: SubmissionItem[];
}

export interface Backend {
  assistantStatus: typeof api.assistantStatus;
  askAssistant: typeof api.askAssistant;
  askTeacherOps: typeof api.askTeacherOps;
  listAssistantMaterials: typeof api.listAssistantMaterials;
  getAssistantMaterial: typeof api.getAssistantMaterial;
  createAssistantMaterial: typeof api.createAssistantMaterial;
  deleteAssistantMaterial: typeof api.deleteAssistantMaterial;
  listUpcoming(): Promise<SessionItem[]>;
  /** Buổi đã kết thúc, mới nhất trước (tối đa 50); truyền studentId để chỉ lấy của một học sinh. */
  listHistory(studentId?: string): Promise<PastSession[]>;
  listStudentOptions(): Promise<StudentOption[]>;
  loadBoard(sessionId: string): Promise<unknown[] | BoardDocument>;
  joinSession: typeof api.joinSession;
  endSession: typeof api.endSession;
  createSession: typeof api.createSession;
  updateSession: typeof api.updateSession;
  cancelSession: typeof api.cancelSession;
  listStudents: typeof api.listStudents;
  createStudent: typeof api.createStudent;
  updateStudent: typeof api.updateStudent;
  deleteStudent: typeof api.deleteStudent;
  createStudentAccount: typeof api.createStudentAccount;
  resetStudentPassword: typeof api.resetStudentPassword;
  monthlySessionReport: typeof api.monthlySessionReport;
  listTeachingTopics: typeof api.listTeachingTopics;
  createTeachingTopic: typeof api.createTeachingTopic;
  getTeachingRecord: typeof api.getTeachingRecord;
  saveTeachingRecord: typeof api.saveTeachingRecord;
  listTeachingRecords: typeof api.listTeachingRecords;
  listWeeklySlots: typeof api.listWeeklySlots;
  createWeeklySlot: typeof api.createWeeklySlot;
  stopWeeklySlot: typeof api.stopWeeklySlot;
  listAssignments(): Promise<AssignmentItem[]>;
  /** URL tạm (10 phút) để xem ảnh bài làm; Storage RLS: GV của học sinh hoặc chính học sinh */
  submissionImageUrl(path: string): Promise<string>;
  createAssignment: typeof api.createAssignment;
  submitAssignment: typeof api.submitAssignment;
  addSubmissionImage: typeof api.addSubmissionImage;
  annotateSubmission: typeof api.annotateSubmission;
  deleteAnnotation: typeof api.deleteAnnotation;
  ocrSubmission: typeof api.ocrSubmission;
  returnSubmission: typeof api.returnSubmission;
}

type Joined = { students: { full_name: string } | { full_name: string }[] | null };
const nameOf = (row: Joined) => (Array.isArray(row.students) ? row.students[0] : row.students)?.full_name ?? "";

// Thông báo lỗi của PostgREST là tiếng Anh, kỹ thuật (vd. "JWT expired"): bỏ đi để trang hiện câu tiếng Việt của nó
// (errorMessage dùng câu dự phòng khi lỗi không có nội dung)
function readFailed(): never {
  throw new Error();
}

function client() {
  if (!supabase) throw new Error("Chưa cấu hình Supabase");
  return supabase;
}

const supabaseBackend: Backend = {
  assistantStatus: api.assistantStatus,
  askAssistant: api.askAssistant,
  askTeacherOps: api.askTeacherOps,
  listAssistantMaterials: api.listAssistantMaterials,
  getAssistantMaterial: api.getAssistantMaterial,
  createAssistantMaterial: api.createAssistantMaterial,
  deleteAssistantMaterial: api.deleteAssistantMaterial,
  async listUpcoming() {
    // RLS tự lọc: giáo viên thấy buổi của mình, học sinh chỉ thấy buổi của em
    const { data, error } = await client()
      .from("sessions")
      .select("id, student_id, subject, topic, scheduled_start, scheduled_end, status, students(full_name)")
      .in("status", ["scheduled", "live"])
      .order("scheduled_start", { ascending: true })
      .limit(50);
    if (error) readFailed();
    return ((data ?? []) as unknown as (Omit<SessionItem, "student_name"> & Joined)[]).map((row) => ({
      ...row,
      student_name: nameOf(row),
    }));
  },
  async listHistory(studentId) {
    let query = client()
      .from("sessions")
      .select("id, student_id, subject, topic, scheduled_start, summary, homework_note, board_snapshot_path, students(full_name)")
      .eq("status", "completed");
    if (studentId) query = query.eq("student_id", studentId);
    const { data, error } = await query.order("scheduled_start", { ascending: false }).limit(50);
    if (error) readFailed();
    return ((data ?? []) as unknown as (Omit<PastSession, "student_name"> & Joined)[]).map((row) => ({
      ...row,
      student_name: nameOf(row),
    }));
  },
  async listStudentOptions() {
    const { data, error } = await client().from("students").select("id, full_name").eq("active", true).order("full_name");
    if (error) readFailed();
    return (data ?? []) as StudentOption[];
  },
  async loadBoard(sessionId) {
    // Storage RLS: giáo viên, hoặc đúng học sinh của buổi đó
    const { data, error } = await client().from("sessions").select("board_snapshot_path").eq("id", sessionId).maybeSingle();
    if (error) readFailed();
    if (!data?.board_snapshot_path) throw new Error("Buổi học này không có bảng đã lưu.");
    const file = await client().storage.from("boards").download(data.board_snapshot_path);
    if (file.error) throw new Error("Không tải được bảng đã lưu.");
    const elements: unknown = JSON.parse(await file.data.text());
    return readBoardDocument(elements);
  },
  joinSession: api.joinSession,
  endSession: api.endSession,
  createSession: api.createSession,
  updateSession: api.updateSession,
  cancelSession: api.cancelSession,
  listStudents: api.listStudents,
  createStudent: api.createStudent,
  updateStudent: api.updateStudent,
  deleteStudent: api.deleteStudent,
  createStudentAccount: api.createStudentAccount,
  resetStudentPassword: api.resetStudentPassword,
  monthlySessionReport: api.monthlySessionReport,
  listTeachingTopics: api.listTeachingTopics,
  createTeachingTopic: api.createTeachingTopic,
  getTeachingRecord: api.getTeachingRecord,
  saveTeachingRecord: api.saveTeachingRecord,
  listTeachingRecords: api.listTeachingRecords,
  listWeeklySlots: api.listWeeklySlots,
  createWeeklySlot: api.createWeeklySlot,
  stopWeeklySlot: api.stopWeeklySlot,
  async listAssignments() {
    const { data, error } = await client()
      .from("assignments")
      .select("*, students(full_name), submissions(*, submission_files(*), submission_transcripts(*))")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) readFailed();
    type Row = api.Assignment & Joined & { submissions: (api.Submission & { submission_files: api.SubmissionFile[]; submission_transcripts: api.Transcript[] })[] };
    const newest = <T,>(rows: T[], key: (r: T) => string) => [...rows].sort((a, b) => key(b).localeCompare(key(a)));
    return ((data ?? []) as unknown as Row[]).map(({ submissions, students, ...row }) => ({
      ...row,
      student_name: nameOf({ students }),
      submissions: newest(submissions ?? [], (s) => s.submitted_at).map(({ submission_files, submission_transcripts, ...s }) => ({
        ...s,
        files: [...(submission_files ?? [])],
        transcripts: newest(submission_transcripts ?? [], (x) => x.created_at),
      })),
    }));
  },
  async submissionImageUrl(path) {
    const { data, error } = await client().storage.from("submissions").createSignedUrl(path, 600);
    if (error || !data) throw new Error("Không tải được ảnh bài làm.");
    return data.signedUrl;
  },
  createAssignment: api.createAssignment,
  submitAssignment: api.submitAssignment,
  addSubmissionImage: api.addSubmissionImage,
  annotateSubmission: api.annotateSubmission,
  deleteAnnotation: api.deleteAnnotation,
  ocrSubmission: api.ocrSubmission,
  returnSubmission: api.returnSubmission,
};

export let backend: Backend = supabaseBackend;

/** Chỉ chế độ xem trước (src/dev/preview.tsx, bản development) gọi. */
export function setBackend(next: Backend) {
  backend = next;
}

/** Câu lỗi gốc tiếng Việt (từ API hoặc câu dự phòng): dùng để so khớp, không hiện thẳng ra. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Câu lỗi để hiện, theo ngôn ngữ đang chọn (câu API chưa có bản dịch thì giữ tiếng Việt). */
export function errorMessage(err: unknown, fallback: string): string {
  return t(errorText(err, fallback));
}
