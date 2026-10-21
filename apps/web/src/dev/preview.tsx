/**
 * CHẾ ĐỘ XEM TRƯỚC — CHỈ BẢN DEVELOPMENT (main.tsx chỉ nạp file này khi import.meta.env.DEV,
 * bản build production không chứa nó). Mở: http://localhost:5173/?preview=teacher hoặc ?preview=student,
 * tắt: ?preview=off. Dữ liệu là MINH HỌA, nằm trong bộ nhớ trình duyệt, không gọi Supabase/API/LiveKit.
 * Dùng đúng các trang và component thật để xem giao diện khi chưa có tài khoản/dịch vụ.
 *
 * Mô phỏng có chủ đích để xem đủ trạng thái:
 * - Tạo buổi trùng giờ / quá 4 giờ / giờ đã qua: lỗi y như API.
 * - Xóa hẳn học sinh: lần đầu "Chưa xóa xong" (đang xóa), bấm "Xóa tiếp" thì xong.
 * - Kết thúc buổi: lần đầu "bảng chờ lưu", "Thử lại ngay" thì xong.
 */
import { useMemo, type ReactNode } from "react";
import { AuthContext, type AuthState } from "../auth/AuthProvider";
import type { AssignmentItem, Backend, PastSession, SessionItem, Student } from "../lib/data";
import { setBackend } from "../lib/data";
import type { TeachingRecord, TeachingTopic, WeeklySlot } from "../lib/api";

export type PreviewRole = "teacher" | "student";

const TEACHER_ID = "preview-teacher";
const MINUTE = 60_000;

function at(minutesFromNow: number) {
  // Làm tròn 5 phút cho giờ dễ đọc
  const t = Date.now() + minutesFromNow * MINUTE;
  return new Date(Math.round(t / (5 * MINUTE)) * 5 * MINUTE).toISOString();
}

function seed() {
  const students: Student[] = [
    { id: "s1", profile_id: "p1", full_name: "Nguyễn Lan Anh", grade: "8A", goals: "Vững phương trình bậc nhất, chuẩn bị thi học kỳ", notes: "Thích ví dụ hình vẽ", guardian_name: "Mẹ Lan Anh", guardian_contact: "0900 000 001", consent_at: at(-60 * 24 * 30), active: true, deleting_at: null, completed_sessions: 12 },
    { id: "s2", profile_id: "p2", full_name: "Trần Đức Minh", grade: "9", goals: "Ôn thi vào lớp 10", notes: null, guardian_name: null, guardian_contact: null, consent_at: at(-60 * 24 * 10), active: true, deleting_at: null, completed_sessions: 7 },
    { id: "s3", profile_id: null, full_name: "Lê Hoàng Yến", grade: "7", goals: null, notes: null, guardian_name: null, guardian_contact: null, consent_at: null, active: true, deleting_at: null, completed_sessions: 0 },
    { id: "s4", profile_id: "p4", full_name: "Phạm Quốc Bảo", grade: "8B", goals: null, notes: "Tạm nghỉ hè", guardian_name: null, guardian_contact: null, consent_at: at(-60 * 24 * 90), active: false, deleting_at: null, completed_sessions: 21 },
  ];
  const name = (id: string) => students.find((s) => s.id === id)?.full_name ?? "";
  const session = (id: string, studentId: string, start: number, minutes: number, subject: string, topic: string, status = "scheduled"): SessionItem => ({
    id, student_id: studentId, student_name: name(studentId), subject, topic,
    scheduled_start: at(start), scheduled_end: at(start + minutes), status,
  });
  const sessions: SessionItem[] = [
    session("u1", "s1", 25, 60, "Toán", "Phương trình bậc nhất một ẩn"),
    session("u2", "s2", 180, 90, "Toán", "Hệ phương trình"),
    session("u3", "s1", 60 * 24 + 60, 60, "Toán", "Bất phương trình"),
    session("u4", "s3", 60 * 24 * 3, 45, "Toán", "Số hữu tỉ"),
  ];
  const past = (id: string, studentId: string, daysAgo: number, topic: string, summary: string, homework: string | null, board: boolean): PastSession => ({
    id, student_name: name(studentId), subject: "Toán", topic, scheduled_start: at(-60 * 24 * daysAgo),
    summary, homework_note: homework, board_snapshot_path: board ? `${studentId}/${id}.json` : null,
  });
  const history: (PastSession & { student_id: string })[] = [
    { ...past("h1", "s1", 2, "Phân tích đa thức", "Đặt nhân tử chung, dùng hằng đẳng thức", "Bài 1–5 trang 19", true), student_id: "s1" },
    { ...past("h2", "s2", 3, "Hàm số bậc nhất", "Vẽ đồ thị y = ax + b", "Vẽ 3 đồ thị trong phiếu", true), student_id: "s2" },
    { ...past("h3", "s1", 9, "Nhân đa thức", "Nhân đơn thức với đa thức", null, false), student_id: "s1" },
  ];
  // Bài tập: một bài chưa nộp, một bài đã nộp (ảnh mẫu), một bài đã trả
  const assignment = (id: string, studentId: string, title: string, description: string, status: AssignmentItem["status"], daysAgo: number): AssignmentItem => ({
    id, student_id: studentId, student_name: name(studentId), title, description, due_at: at(60 * 24 * 3), status,
    created_at: at(-60 * 24 * daysAgo), submissions: [],
  });
  const assignments: AssignmentItem[] = [
    assignment("a1", "s1", "Bài 1–5 trang 19", "Phân tích đa thức thành nhân tử", "assigned", 2),
    { ...assignment("a2", "s1", "Phiếu luyện phương trình", "Giải và thử lại nghiệm", "submitted", 4),
      submissions: [{ id: "sub-a2", student_id: "s1", assignment_id: "a2", status: "submitted", submitted_at: at(-60 * 20), teacher_comment: null, score: null, returned_at: null,
        files: [{ id: "f-a2", submission_id: "sub-a2", storage_path: "sample:bai-lam", mime_type: "image/svg+xml", size_bytes: null }], transcripts: [] }] },
    { ...assignment("a3", "s2", "Vẽ 3 đồ thị", "Hàm số bậc nhất trong phiếu", "returned", 6),
      submissions: [{ id: "sub-a3", student_id: "s2", assignment_id: "a3", status: "returned", submitted_at: at(-60 * 24 * 5), teacher_comment: "Đồ thị đúng, nhớ ghi tên trục.", score: 8.5, returned_at: at(-60 * 24 * 4),
        files: [{ id: "f-a3", submission_id: "sub-a3", storage_path: "sample:bai-lam", mime_type: "image/svg+xml", size_bytes: null }], transcripts: [] }] },
  ];
  return { assignments, images: {} as Record<string, string>, students, sessions, history, topics: [{ id: "preview-topic-1", name: "Phương trình", grade: "9" }] as TeachingTopic[], privateNotes: {} as Record<string, TeachingRecord>, slots: [] as WeeklySlot[], slotSessions: {} as Record<string, string[]>, emails: new Set(["daco@example.com"]), deleteTries: new Set<string>(), endTries: new Set<string>() };
}

const wait = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T,>(v: T): T => structuredClone(v);

/** Ảnh bài làm mẫu (SVG, không phải ảnh thật của học sinh). */
const SAMPLE_WORK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fffdf6"/><g stroke="#d6e4f5">' + Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${30 + i * 32}" x2="600" y2="${30 + i * 32}"/>`).join("") + '</g><g font-family="Comic Sans MS, cursive" font-size="30" fill="#1b2a6b"><text x="40" y="80">Bài 2: 2x + 3 = 11</text><text x="80" y="150">2x = 11 − 3 = 8</text><text x="80" y="220">x = 8 : 2 = 4</text><text x="40" y="300">Thử lại: 2·4 + 3 = 11 ✓</text></g></svg>')}`;

/** Bảng mẫu cho "Xem lại bảng": vài hình đơn giản. */
const SAMPLE_BOARD = [
  { id: "r1", type: "rectangle", x: 80, y: 80, width: 260, height: 140, strokeColor: "#2a2760", backgroundColor: "#cff1de", fillStyle: "solid", strokeWidth: 2, roughness: 0, opacity: 100, angle: 0, version: 1, versionNonce: 1, isDeleted: false, seed: 1, groupIds: [], boundElements: null, roundness: null, updated: 1, link: null, locked: false, frameId: null },
  { id: "t1", type: "text", x: 110, y: 130, width: 200, height: 35, text: "2x + 3 = 11", fontSize: 28, fontFamily: 1, textAlign: "left", verticalAlign: "top", strokeColor: "#2a2760", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0, opacity: 100, angle: 0, version: 1, versionNonce: 2, isDeleted: false, seed: 2, groupIds: [], boundElements: null, roundness: null, updated: 1, link: null, locked: false, containerId: null, originalText: "2x + 3 = 11", lineHeight: 1.25, autoResize: true, frameId: null },
  { id: "t2", type: "text", x: 110, y: 250, width: 200, height: 35, text: "x = 4", fontSize: 28, fontFamily: 1, textAlign: "left", verticalAlign: "top", strokeColor: "#a3214f", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0, opacity: 100, angle: 0, version: 1, versionNonce: 3, isDeleted: false, seed: 3, groupIds: [], boundElements: null, roundness: null, updated: 1, link: null, locked: false, containerId: null, originalText: "x = 4", lineHeight: 1.25, autoResize: true, frameId: null },
];

function previewBackend(role: PreviewRole): Backend {
  const db = seed();
  const me = "s1"; // học sinh xem trước là Lan Anh
  const mine = <T extends { student_id: string }>(rows: T[]) => (role === "teacher" ? rows : rows.filter((r) => r.student_id === me));
  const student = (id: string) => {
    const s = db.students.find((x) => x.id === id);
    if (!s) throw new Error("Không tìm thấy học sinh");
    return s;
  };
  const session = (id: string) => {
    const s = db.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Không tìm thấy buổi học");
    return s;
  };
  function checkSchedule(start: string, end: string, excludeId?: string) {
    const a = Date.parse(start);
    const b = Date.parse(end);
    if (b - a > 4 * 60 * MINUTE) throw new Error("Một buổi học dài tối đa 4 giờ");
    if (b <= Date.now()) throw new Error("Không xếp được buổi học vào thời gian đã qua");
    const clash = db.sessions.some((s) => s.id !== excludeId && ["scheduled", "live"].includes(s.status) && Date.parse(s.scheduled_start) < b && Date.parse(s.scheduled_end) > a);
    if (clash) throw new Error("Trùng giờ với một buổi học khác");
  }

  function teacherOnly() {
    if (role !== "teacher") throw new Error("Chỉ giáo viên được xem ghi chú riêng");
  }
  function teachingRecord(id: string): TeachingRecord {
    teacherOnly();
    const item = db.history.find((h) => h.id === id);
    if (!item || student(item.student_id).deleting_at) throw new Error("Không tìm thấy buổi học");
    return clone(db.privateNotes[id] ?? {
      session_id: id, scheduled_start: item.scheduled_start, subject: item.subject,
      scheduled_topic: item.topic, revision: 0, updated_at: null,
      summary_md: "", understanding_level: "", improve_points: "", homework_text: "", topic_ids: [],
    });
  }

  // Lịch cố định: sinh 4 tuần tới theo giờ Việt Nam, bỏ ngày trùng giờ (như API, M1a.3)
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  function fillSlot(slot: WeeklySlot) {
    const st = student(slot.student_id);
    let created = 0;
    const skipped: string[] = [];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    const first = slot.starts_on > today ? slot.starts_on : today;
    for (let i = 0; i <= 28; i++) {
      const d = new Date(`${first}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const day = d.toISOString().slice(0, 10);
      if (((d.getUTCDay() + 6) % 7) + 1 !== slot.weekday || day > addDays(today, 28)) continue;
      const start = new Date(`${day}T${slot.start_time}:00+07:00`);
      if (start.getTime() <= Date.now()) continue;
      const end = new Date(start.getTime() + slot.duration_minutes * MINUTE);
      const clash = db.sessions.some((s) => ["scheduled", "live"].includes(s.status) && Date.parse(s.scheduled_start) < end.getTime() && Date.parse(s.scheduled_end) > start.getTime());
      if (clash) {
        skipped.push(start.toISOString());
        continue;
      }
      const id = `slot-${slot.id}-${day}`;
      db.sessions.push({ id, student_id: st.id, student_name: st.full_name, subject: slot.subject, topic: slot.topic, scheduled_start: start.toISOString(), scheduled_end: end.toISOString(), status: "scheduled" });
      (db.slotSessions[slot.id] ??= []).push(id);
      created++;
    }
    return { created, skipped };
  }

  return {
    async assistantStatus() { return { enabled: false, student_lessons: false, daily_limit: 20 }; },
    async askAssistant() { throw new Error("Trợ lý AI chưa được bật hoặc cấu hình."); },
    async askTeacherOps() { throw new Error("Trợ lý AI chưa được bật hoặc cấu hình."); },
    async listAssistantMaterials() { teacherOnly(); return []; },
    async getAssistantMaterial() { throw new Error("Không tìm thấy tài liệu"); },
    async createAssistantMaterial() { throw new Error("Chế độ xem trước không lưu tài liệu."); },
    async deleteAssistantMaterial() { throw new Error("Chế độ xem trước không lưu tài liệu."); },
    async listTeachingTopics() { teacherOnly(); await wait(); return clone(db.topics); },
    async listWeeklySlots() { teacherOnly(); await wait(); return clone(db.slots); },
    async createWeeklySlot(body) {
      teacherOnly();
      await wait();
      const st = student(body.student_id);
      if (!st.active) throw new Error("Học sinh đã ngừng dạy");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
      const slot: WeeklySlot = { id: crypto.randomUUID(), student_id: st.id, weekday: body.weekday, start_time: body.start_time, duration_minutes: body.duration_minutes, subject: body.subject || null, topic: null, starts_on: body.starts_on || today, active: true };
      db.slots.push(slot);
      return { slot: clone(slot), ...fillSlot(slot) };
    },
    async listAssignments() {
      await wait();
      return clone(mine(db.assignments));
    },
    async submissionImageUrl(path) {
      // Ảnh mẫu vẽ bằng SVG; ảnh vừa chọn trong lúc xem trước giữ bằng URL blob của trình duyệt
      return db.images[path] ?? SAMPLE_WORK;
    },
    async createAssignment(body) {
      teacherOnly(); await wait();
      const st = student(body.student_id);
      if (!st.active) throw new Error("Không tìm thấy học sinh");
      const row: AssignmentItem = { id: crypto.randomUUID(), student_id: st.id, student_name: st.full_name, title: body.title, description: body.description || null, due_at: body.due_at, status: "assigned", created_at: new Date().toISOString(), submissions: [] };
      db.assignments.unshift(row);
      const { student_name: _n, submissions: _s, ...plain } = row;
      return clone(plain);
    },
    async submitAssignment(assignmentId, image) {
      await wait();
      const a = mine(db.assignments).find((x) => x.id === assignmentId);
      if (!a || role !== "student") throw new Error("Không tìm thấy bài tập");
      if (a.status === "returned") throw new Error("Bài này thầy cô đã chấm và trả, không nộp thêm được.");
      const id = crypto.randomUUID();
      const path = `${a.student_id}/${id}/1.jpg`;
      db.images[path] = URL.createObjectURL(image);
      const sub = { id, student_id: a.student_id, assignment_id: a.id, status: "submitted" as const, submitted_at: new Date().toISOString(), teacher_comment: null, score: null, returned_at: null };
      a.submissions.unshift({ ...sub, files: [{ id: crypto.randomUUID(), submission_id: id, storage_path: path, mime_type: image.type, size_bytes: image.size }], transcripts: [] });
      a.status = "submitted";
      return clone(sub);
    },
    async addSubmissionImage(submissionId, image) {
      await wait();
      const sub = mine(db.assignments).flatMap((a) => a.submissions).find((s) => s.id === submissionId);
      if (!sub || role !== "student") throw new Error("Không tìm thấy bài nộp");
      if (sub.files.length >= 6) throw new Error("Mỗi bài nộp tối đa 6 ảnh.");
      const path = `${sub.student_id}/${sub.id}/${sub.files.length + 1}.jpg`;
      db.images[path] = URL.createObjectURL(image);
      const file = { id: crypto.randomUUID(), submission_id: sub.id, storage_path: path, mime_type: image.type, size_bytes: image.size };
      sub.files.push(file);
      return clone(file);
    },
    // Không giả kết quả AI: xem trước không gọi Gemini
    async ocrSubmission() { teacherOnly(); await wait(); throw new Error("Đọc bài bằng AI chưa được bật hoặc cấu hình."); },
    async returnSubmission(submissionId, body) {
      teacherOnly(); await wait();
      const a = db.assignments.find((x) => x.submissions.some((s) => s.id === submissionId));
      const sub = a?.submissions.find((s) => s.id === submissionId);
      if (!a || !sub) throw new Error("Không tìm thấy bài nộp");
      Object.assign(sub, { status: "returned", teacher_comment: body.teacher_comment || null, score: body.score, returned_at: new Date().toISOString() });
      a.status = "returned";
      const { files: _f, transcripts: _t, ...plain } = sub;
      return clone(plain);
    },
    async stopWeeklySlot(slotId) {
      teacherOnly();
      await wait();
      const slot = db.slots.find((x) => x.id === slotId);
      if (!slot) throw new Error("Không tìm thấy lịch cố định");
      slot.active = false;
      let cancelled = 0;
      for (const s of db.sessions) {
        if ((db.slotSessions[slotId] ?? []).includes(s.id) && s.status === "scheduled" && Date.parse(s.scheduled_start) > Date.now()) {
          s.status = "cancelled";
          cancelled++;
        }
      }
      return { slot: clone(slot), cancelled };
    },
    async createTeachingTopic(name, grade) {
      teacherOnly(); await wait();
      const old = db.topics.find((t) => t.name === name.trim() && t.grade === grade.trim());
      if (old) return clone(old);
      const item = { id: `topic-${crypto.randomUUID()}`, name: name.trim(), grade: grade.trim() };
      if (!item.name) throw new Error("Tên chủ đề không được để trống");
      db.topics.push(item);
      return clone(item);
    },
    async getTeachingRecord(id) { await wait(); return teachingRecord(id); },
    async saveTeachingRecord(id, body) {
      await wait();
      const current = teachingRecord(id);
      if (current.revision !== body.expected_revision) throw new Error("Ghi chú đã thay đổi ở tab khác. Hãy tải lại trước khi sửa tiếp.");
      if (body.topic_ids.some((tid) => !db.topics.some((t) => t.id === tid))) throw new Error("Có chủ đề không hợp lệ. Hãy tải lại danh mục và chọn lại.");
      const { expected_revision: _, ...fields } = body;
      const saved = { ...current, ...fields, topic_ids: [...new Set(fields.topic_ids)].sort(), revision: current.revision + 1, updated_at: new Date().toISOString() };
      db.privateNotes[id] = clone(saved);
      return clone(saved);
    },
    async listTeachingRecords(studentId, month) {
      teacherOnly(); await wait();
      if (student(studentId).deleting_at) throw new Error("Không tìm thấy học sinh");
      return db.history.filter((h) => {
        const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).formatToParts(new Date(h.scheduled_start));
        const key = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
        return h.student_id === studentId && key === month;
      }).map((h) => teachingRecord(h.id));
    },
    async listUpcoming() {
      await wait();
      return clone(mine(db.sessions).filter((s) => ["scheduled", "live"].includes(s.status)));
    },
    async listHistory() {
      await wait();
      return clone(mine(db.history));
    },
    async listStudentOptions() {
      await wait(150);
      return db.students.filter((s) => s.active && !s.deleting_at).map(({ id, full_name }) => ({ id, full_name }));
    },
    async loadBoard(sessionId) {
      await wait();
      const item = mine(db.history).find((h) => h.id === sessionId);
      if (!item?.board_snapshot_path) throw new Error("Buổi học này không có bảng đã lưu.");
      return clone(SAMPLE_BOARD);
    },
    async joinSession(sessionId, mode) {
      await wait(500);
      const s = mine(db.sessions).find((x) => x.id === sessionId);
      if (!s) throw new Error("Không tìm thấy buổi học");
      if (s.status !== "scheduled" && s.status !== "live") throw new Error("Buổi học đã kết thúc hoặc bị hủy");
      if (role === "teacher") s.status = "live";
      return {
        session_id: s.id, room_name: `room-${s.id}`, role, mode,
        // Địa chỉ rỗng: bảng không kết nối, video hiện khung giữ chỗ (xem VideoPanel, useBoardSync)
        livekit: mode === "main" ? { url: "", token: "" } : null,
        whiteboard: { url: "", token: "" },
      };
    },
    async endSession(sessionId, body) {
      await wait(600);
      const s = session(sessionId);
      const first = !db.endTries.has(sessionId);
      db.endTries.add(sessionId);
      if (s.status === "live") {
        s.status = "completed";
        db.history.unshift({ id: s.id, student_id: s.student_id, student_name: s.student_name, subject: s.subject, topic: s.topic, scheduled_start: s.scheduled_start, summary: body.summary ?? null, homework_note: body.homework_note ?? null, board_snapshot_path: `${s.student_id}/${s.id}.json` });
        student(s.student_id).completed_sessions += 1;
      }
      return { session_id: s.id, status: "completed", ended_at: new Date().toISOString(), finalize_pending: first };
    },
    async createSession(body) {
      await wait();
      checkSchedule(body.scheduled_start, body.scheduled_end);
      const st = student(body.student_id);
      if (!st.active) throw new Error("Học sinh đã ngừng dạy");
      const id = `n${Date.now()}`;
      db.sessions.push({ id, student_id: st.id, student_name: st.full_name, subject: body.subject || null, topic: body.topic || null, scheduled_start: body.scheduled_start, scheduled_end: body.scheduled_end, status: "scheduled" });
      return { id };
    },
    async updateSession(sessionId, body) {
      await wait();
      const s = session(sessionId);
      if (s.status !== "scheduled") throw new Error("Chỉ sửa được buổi học chưa bắt đầu");
      checkSchedule(body.scheduled_start ?? s.scheduled_start, body.scheduled_end ?? s.scheduled_end, s.id);
      Object.assign(s, { ...body, subject: body.subject || null, topic: body.topic || null });
      return { id: s.id };
    },
    async cancelSession(sessionId) {
      await wait();
      const s = session(sessionId);
      if (s.status !== "scheduled") throw new Error("Chỉ hủy được buổi học chưa bắt đầu");
      s.status = "cancelled";
      return { id: s.id, status: s.status };
    },
    async listStudents() {
      await wait();
      return clone(db.students);
    },
    async monthlySessionReport(month) {
      await wait();
      if (role !== "teacher") throw new Error("Chỉ giáo viên được xem báo cáo");
      const year = Number(month.slice(0, 4));
      const number = Number(month.slice(5, 7));
      if (!/^\d{4}-\d{2}$/.test(month) || year < 1 || year > 9999 || number < 1 || number > 12 || month === "0001-01" || month === "9999-12") {
        throw new Error("Tháng báo cáo không hợp lệ (YYYY-MM)");
      }
      const start = new Date(`${month}-01T00:00:00+07:00`);
      const next = `${String(year + (number === 12 ? 1 : 0)).padStart(4, "0")}-${String(number % 12 + 1).padStart(2, "0")}`;
      const end = new Date(`${next}-01T00:00:00+07:00`);
      const rows = db.students.filter((s) => !s.deleting_at).map((s) => ({
        student_id: s.id, full_name: s.full_name, grade: s.grade, active: s.active,
        completed_sessions: db.history.filter((h) => h.student_id === s.id && new Date(h.scheduled_start) >= start && new Date(h.scheduled_start) < end).length,
      }));
      return { month, timezone: "Asia/Ho_Chi_Minh", period_start: start.toISOString(), period_end: end.toISOString(), total: rows.reduce((sum, s) => sum + s.completed_sessions, 0), students: clone(rows) };
    },
    async createStudent(body) {
      await wait();
      const row: Student = { id: `s${Date.now()}`, profile_id: null, full_name: body.full_name?.trim() ?? "", grade: body.grade || null, goals: body.goals || null, notes: body.notes || null, guardian_name: body.guardian_name || null, guardian_contact: body.guardian_contact || null, consent_at: body.consent ? new Date().toISOString() : null, active: true, deleting_at: null, completed_sessions: 0 };
      db.students.push(row);
      return clone(row);
    },
    async updateStudent(studentId, body) {
      await wait();
      const s = student(studentId);
      if (s.deleting_at) throw new Error("Học sinh đang được xóa, hãy bấm xóa lần nữa để hoàn tất");
      const { consent, ...rest } = body;
      for (const [k, v] of Object.entries(rest)) (s as unknown as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() || null : v;
      if (consent !== undefined) s.consent_at = consent ? (s.consent_at ?? new Date().toISOString()) : null;
      return clone(s);
    },
    async deleteStudent(studentId) {
      await wait(700);
      const s = student(studentId);
      if (s.active) throw new Error("Hãy ngừng dạy học sinh trước khi xóa hẳn");
      if (!db.deleteTries.has(studentId)) {
        db.deleteTries.add(studentId);
        s.deleting_at = new Date().toISOString();
        throw new Error("Chưa xóa xong: bảng viết đang được lưu. Hệ thống sẽ tự thử lại; bạn cũng có thể bấm xóa lần nữa.");
      }
      db.students = db.students.filter((x) => x.id !== studentId);
      db.sessions = db.sessions.filter((x) => x.student_id !== studentId);
      for (const item of db.history.filter((x) => x.student_id === studentId)) delete db.privateNotes[item.id];
      db.history = db.history.filter((x) => x.student_id !== studentId);
    },
    async createStudentAccount(studentId, email, _password) {
      await wait();
      const s = student(studentId);
      if (db.emails.has(email.toLowerCase())) throw new Error("Email này đã được dùng cho tài khoản khác");
      db.emails.add(email.toLowerCase());
      s.profile_id = `p-${studentId}`;
      return { student_id: s.id, profile_id: s.profile_id, email: email.toLowerCase() };
    },
    async resetStudentPassword(studentId) {
      await wait();
      if (!student(studentId).profile_id) throw new Error("Học sinh chưa có tài khoản đăng nhập");
    },
  };
}

/** Cài dữ liệu minh họa; trả về Provider thay cho AuthProvider thật. */
export function installPreview(role: PreviewRole) {
  setBackend(previewBackend(role));
  document.body.classList.add("is-preview");
  const user = role === "teacher" ? { id: TEACHER_ID, name: "Cô Minh Thư", role } : { id: "p1", name: "Nguyễn Lan Anh", role };
  return function PreviewAuthProvider({ children }: { children: ReactNode }) {
    const value = useMemo<AuthState>(
      () => ({
        user,
        loading: false,
        preview: true,
        signIn: async () => null,
        signOut: async () => {
          window.location.href = "/?preview=off";
        },
      }),
      [],
    );
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  };
}

export function PreviewBanner() {
  return (
    <div className="preview-banner" role="note">
      <span title="Chế độ xem trước chỉ có trong bản development; không gọi Supabase, API hay LiveKit">Dữ liệu minh họa ·</span>
      <a href="/?preview=teacher">giáo viên</a> · <a href="/?preview=student">học sinh</a> · <a href="/?preview=off">tắt</a>
    </div>
  );
}
