/**
 * Supabase và API GIẢ ở ranh giới mạng (route của Playwright), dữ liệu riêng cho từng test.
 * Web chạy đúng AuthProvider, lib/api.ts, lib/data.ts thật; chỉ phản hồi HTTP là giả.
 * Đây là test GIAO DIỆN: không chứng minh quyền Auth/RLS hay hành vi Supabase/API/LiveKit thật
 * (các phần đó do pytest, test RLS và nghiệm thu dịch vụ thật kiểm).
 */
import type { BrowserContext, Route } from "@playwright/test";

export type Role = "teacher" | "student";

export interface FakeSession {
  id: string;
  student_id: string;
  student_name: string;
  subject: string | null;
  topic: string | null;
  scheduled_start: string;
  scheduled_end: string;
  status: string;
}

export interface Reply {
  status: number;
  body?: unknown;
}

type Handler = (req: { method: string; path: string; body: unknown }) => Reply | Promise<Reply>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "*",
};

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

export const TEACHER = { id: "e2e-teacher", email: "co.thu@e2e.test", password: "matkhau-thu", full_name: "Cô Thử E2E", role: "teacher" as Role };
export const STUDENT = { id: "e2e-student", email: "em.a@e2e.test", password: "matkhau-thu", full_name: "Em Thử A", role: "student" as Role };

export function inMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export class FakeBackend {
  readonly supabaseOrigin = process.env.E2E_SUPABASE_ORIGIN!;
  readonly apiOrigin = process.env.E2E_API_ORIGIN!;
  accounts = [TEACHER, STUDENT];
  sessions: FakeSession[] = [
    {
      id: "11111111-e2e0-4000-8000-000000000001",
      student_id: "stu-a",
      student_name: STUDENT.full_name,
      subject: "Toán",
      topic: "Phương trình",
      scheduled_start: inMinutes(5),
      scheduled_end: inMinutes(65),
      status: "scheduled",
    },
  ];
  students = [
    { id: "stu-a", profile_id: STUDENT.id, full_name: STUDENT.full_name, grade: "8A", goals: null, notes: null, guardian_name: null, guardian_contact: null, consent_at: inMinutes(-60), active: true, deleting_at: null, completed_sessions: 3 },
  ];
  /** Mọi lời gọi tới Supabase/API giả: "METHOD /đường dẫn" */
  calls: string[] = [];
  /** Lời gọi không có handler: test đỏ ở teardown của fixture */
  unmocked: string[] = [];
  private handlers: { method: string; pattern: RegExp; handler: Handler }[] = [];

  constructor() {
    this.on("GET", /^\/api\/students$/, () => ({ status: 200, body: this.students }));
  }

  /** Handler mới đăng ký được ưu tiên hơn handler cũ. */
  on(method: string, pattern: RegExp, handler: Handler) {
    this.handlers.unshift({ method, pattern, handler });
  }

  /** Trả lần lượt các phản hồi cho một endpoint (hết danh sách thì dùng phản hồi cuối). */
  sequence(method: string, pattern: RegExp, replies: (Reply | (() => Reply | Promise<Reply>))[]) {
    let i = 0;
    this.on(method, pattern, () => {
      const next = replies[Math.min(i++, replies.length - 1)]!;
      return typeof next === "function" ? next() : next;
    });
  }

  async install(context: BrowserContext) {
    await context.route(`${this.supabaseOrigin}/**`, (route) => this.handle(route, "supabase"));
    await context.route(`${this.apiOrigin}/**`, (route) => this.handle(route, "api"));
  }

  private session(account: typeof TEACHER) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = {
      id: account.id,
      aud: "authenticated",
      role: "authenticated",
      email: account.email,
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
    return {
      access_token: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: account.id, exp, aud: "authenticated", role: "authenticated", email: account.email })}.e2e-chu-ky-gia`,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: exp,
      refresh_token: `e2e-refresh-${account.id}`,
      user,
    };
  }

  private current?: typeof TEACHER;

  private async handle(route: Route, origin: "supabase" | "api") {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const key = `${request.method()} ${url.pathname}`;
    this.calls.push(`${key}${url.search}`);
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    // Handler riêng của test (on/sequence) được xét trước phản hồi dựng sẵn, cho cả Supabase và API
    const custom = await this.custom(request.method(), url.pathname, body);
    const reply = custom ?? (origin === "supabase" ? this.supabase(request.method(), url, request.headers(), body) : undefined);
    if (!reply) {
      this.unmocked.push(key);
      return route.fulfill({ status: 599, headers: CORS, json: { detail: `E2E: chưa mock ${key}` } });
    }
    return route.fulfill({ status: reply.status, headers: CORS, json: reply.body ?? null });
  }

  private supabase(method: string, url: URL, headers: Record<string, string>, body: unknown): Reply | undefined {
    const path = url.pathname;
    if (method === "POST" && path === "/auth/v1/token") {
      const { email, password } = (body ?? {}) as { email?: string; password?: string };
      const account = this.accounts.find((a) => a.email === email && a.password === password);
      if (!account) return { status: 400, body: { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" } };
      this.current = account;
      return { status: 200, body: this.session(account) };
    }
    if (method === "GET" && path === "/auth/v1/user" && this.current) return { status: 200, body: this.session(this.current).user };
    if (method === "POST" && path === "/auth/v1/logout") return { status: 204 };
    if (method !== "GET" || !path.startsWith("/rest/v1/")) return undefined;

    const table = path.slice("/rest/v1/".length);
    const one = (headers["accept"] ?? "").includes("vnd.pgrst.object");
    if (table === "profiles") {
      const id = url.searchParams.get("id")?.replace(/^eq\./, "");
      const account = this.accounts.find((a) => a.id === id);
      const row = account ? { role: account.role, full_name: account.full_name } : null;
      if (one) return row ? { status: 200, body: row } : { status: 406, body: { code: "PGRST116", message: "no rows" } };
      return { status: 200, body: row ? [row] : [] };
    }
    if (table === "sessions") {
      const status = url.searchParams.get("status") ?? "";
      const wanted = status.startsWith("in.(") ? status.slice(4, -1).split(",") : [status.replace(/^eq\./, "")];
      const rows = this.sessions
        .filter((s) => wanted.includes(s.status))
        .map(({ student_name, ...s }) => ({ ...s, summary: null, homework_note: null, board_snapshot_path: null, students: { full_name: student_name } }));
      return { status: 200, body: rows };
    }
    if (table === "students") {
      return { status: 200, body: this.students.filter((s) => s.active).map(({ id, full_name }) => ({ id, full_name })) };
    }
    return undefined;
  }

  private async custom(method: string, path: string, body: unknown): Promise<Reply | undefined> {
    const match = this.handlers.find((h) => h.method === method && h.pattern.test(path));
    return match ? match.handler({ method, path, body }) : undefined;
  }
}
