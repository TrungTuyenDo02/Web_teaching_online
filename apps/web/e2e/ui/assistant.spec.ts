/** Provider và API giả ở ranh giới mạng; không gọi OpenAI thật. */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { STUDENT, TEACHER } from "../fixtures/fake-backend";

test("AI-01 yêu cầu đồng ý trước khi gửi, có nguồn, lỗi hạn mức giữ câu hỏi @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 429/);
  fake.on("GET", /^\/api\/assistant\/status$/, () => ({ status: 200, body: { enabled: true, student_lessons: false, daily_limit: 20 } }));
  let requestCount = 0;
  fake.on("POST", /^\/api\/assistant\/chat$/, ({ body }) => {
    expect((body as {consent: boolean}).consent).toBe(true);
    requestCount++;
    return requestCount === 1 ? { status: 200, body: { answer: "Mở báo cáo tháng [1].", mode: "openai", sources: [{ id: "guide:report", title: "Báo cáo", excerpt: "", path: "/reports", kind: "guide" }] } } : { status: 429, body: { detail: "Đã hết lượt trợ lý AI hôm nay. Hãy thử lại vào ngày mai." } };
  });
  await signIn(page, TEACHER); await page.goto("/");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await chat.getByRole("button", { name: "Hỏi AI", exact: true }).click();
  await chat.getByLabel("Nhập câu hỏi cho trợ giúp").fill("Báo cáo ở đâu?");
  await expect(chat.getByRole("button", { name: "Gửi", exact: true })).toBeDisabled();
  expect(requestCount).toBe(0);
  await chat.getByRole("checkbox").check();
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat.getByRole("log")).toContainText("Mở báo cáo tháng [1].");
  await expect(chat.getByRole("link", { name: "[1] Báo cáo" })).toHaveAttribute("href", "/reports");
  await chat.getByLabel("Nhập câu hỏi cho trợ giúp").fill("Câu tiếp theo");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat.getByRole("alert")).toContainText("Đã hết lượt");
  await expect(chat.getByLabel("Nhập câu hỏi cho trợ giúp")).toHaveValue("Câu tiếp theo");
});

test("AI-02 học sinh không có quản lý tài liệu, AI tắt thì không giả câu trả lời @smoke", async ({ page, fake }) => {
  fake.on("GET", /^\/api\/assistant\/status$/, () => ({ status: 200, body: { enabled: false, student_lessons: false, daily_limit: 20 } }));
  await signIn(page, STUDENT); await page.goto("/");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await chat.getByRole("button", { name: "Hỏi AI", exact: true }).click();
  await expect(chat.getByText("Trợ lý AI chưa được bật hoặc cấu hình.", { exact: true })).toBeVisible();
  await expect(chat.getByRole("link", { name: "Quản lý bài giảng RAG" })).toHaveCount(0);
  expect(fake.calls.some((call) => call.includes("POST /api/assistant/chat"))).toBe(false);
});

test("AI-03 giáo viên thêm rồi gỡ tài liệu qua xác nhận @smoke", async ({ page, fake }) => {
  const rows: { id: string; title: string; content: string; topic_id: string; student_visible: boolean }[] = [];
  fake.on("GET", /^\/api\/topics$/, () => ({ status: 200, body: [{ id: "topic-1", name: "Phân số", grade: "7" }] }));
  fake.on("GET", /^\/api\/assistant\/materials$/, () => ({ status: 200, body: rows }));
  fake.on("POST", /^\/api\/assistant\/materials$/, ({ body }) => { rows.push({ id: "material-1", ...(body as Omit<typeof rows[number], "id">) }); return { status: 200, body: rows[0] }; });
  fake.on("DELETE", /^\/api\/assistant\/materials\/material-1$/, () => { rows.length = 0; return { status: 204 }; });
  await signIn(page, TEACHER); await page.goto("/assistant-materials");
  await page.getByRole("button", { name: "Thêm bài giảng", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Thêm bài giảng" });
  await editor.getByLabel("Tiêu đề bài giảng").fill("Khái niệm phân số");
  await editor.getByLabel("Chủ đề bài giảng").selectOption("topic-1");
  await editor.getByLabel("Nội dung bài giảng").fill("Phân số biểu diễn một phần của đơn vị.");
  await editor.getByLabel(/Tôi đã kiểm tra/).check();
  await editor.getByRole("button", { name: "Lưu bài giảng" }).click();
  await expect(page.getByRole("heading", { name: "Khái niệm phân số", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Gỡ bài giảng", exact: true }).click();
  expect(rows).toHaveLength(1);
  await page.getByRole("dialog", { name: "Gỡ bài giảng?" }).getByRole("button", { name: "Gỡ bài giảng", exact: true }).click();
  await expect(page.getByText("Chưa có bài giảng", { exact: true })).toBeVisible();
});

test("AI-04 Teacher-Ops chỉ giáo viên thấy, đổi chế độ phải đồng ý lại, gọi đúng endpoint chỉ đọc @smoke", async ({ page, fake }) => {
  fake.on("GET", /^\/api\/assistant\/status$/, () => ({ status: 200, body: { enabled: true, student_lessons: false, daily_limit: 20 } }));
  const asked: string[] = [];
  fake.on("POST", /^\/api\/assistant\/teacher-ops$/, ({ body }) => {
    asked.push((body as { question: string }).question);
    return { status: 200, body: { answer: "Tuần này có 2 buổi với Nguyễn Lan Anh.", mode: "openai", sources: [] } };
  });
  await signIn(page, TEACHER); await page.goto("/");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await chat.getByRole("button", { name: "Hỏi AI", exact: true }).click();
  await chat.getByRole("checkbox").check();
  await chat.getByRole("button", { name: "Lịch & lớp", exact: true }).click();
  await expect(chat.getByRole("checkbox")).not.toBeChecked();
  await expect(chat.getByText(/Tên học sinh được thay bằng mã/)).toBeVisible();
  await chat.getByRole("checkbox").check();
  await chat.getByRole("button", { name: "Tuần này tôi có những buổi nào?" }).click();
  await expect(chat.getByRole("log")).toContainText("Tuần này có 2 buổi với Nguyễn Lan Anh.");
  expect(asked).toEqual(["Tuần này tôi có những buổi nào?"]);
  expect(fake.calls.some((call) => call.includes("POST /api/assistant/chat"))).toBe(false);
});

test("AI-05 học sinh không có chế độ Teacher-Ops", async ({ page, fake }) => {
  fake.on("GET", /^\/api\/assistant\/status$/, () => ({ status: 200, body: { enabled: true, student_lessons: false, daily_limit: 20 } }));
  await signIn(page, STUDENT); await page.goto("/");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await expect(chat.getByRole("button", { name: "Hỏi AI", exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Lịch & lớp" })).toHaveCount(0);
});
