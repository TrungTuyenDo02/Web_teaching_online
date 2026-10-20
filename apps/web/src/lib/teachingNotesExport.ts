import { csvCell } from "./csv.ts";
import { locale, t } from "./i18n.ts";

interface ExportRecord {
  scheduled_start: string; summary_md: string; understanding_level: string;
  improve_points: string; homework_text: string; topic_ids: string[];
}
interface Topic { id: string; name: string; grade: string }

export function teachingNotesExport(studentName: string, month: string, records: ExportRecord[], topics: Topic[], format: "csv" | "md"): string {
  const names = (ids: string[]) => ids.map((id) => {
    const topic = topics.find((t) => t.id === id);
    return topic ? `${topic.name}${topic.grade ? t(" (lớp {grade})", { grade: topic.grade }) : ""}` : t("Chủ đề không còn trong danh mục");
  }).join("; ");
  const date = (iso: string) => new Intl.DateTimeFormat(locale(), {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
  if (format === "csv") {
    const rows = [
      ["Học sinh", "Tháng", "Bắt đầu (giờ Việt Nam)", "Nhận xét riêng", "Mức độ nắm bài", "Cần cải thiện", "Bài tập ghi riêng", "Chủ đề đã dạy"].map((label) => t(label)),
      ...records.map((r) => [studentName, month, date(r.scheduled_start), r.summary_md, r.understanding_level, r.improve_points, r.homework_text, names(r.topic_ids)]),
    ];
    return "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  // Nội dung do người dùng nhập đặt trong code fence đủ dài, không biến thành HTML/liên kết khi mở Markdown.
  const block = (text: string) => {
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((s) => s.length));
    const fence = "`".repeat(longest + 1);
    return `${fence}text\n${text}\n${fence}`;
  };
  return `# ${t("Ghi chú riêng của giáo viên")}\n\n${block(`${studentName} · ${month} · ${t("giờ Việt Nam")}`)}\n\n` + records.map((r) =>
    `## ${date(r.scheduled_start)}\n\n` + [
      ["Nhận xét riêng", r.summary_md], ["Mức độ nắm bài", r.understanding_level],
      ["Cần cải thiện", r.improve_points], ["Bài tập ghi riêng", r.homework_text], ["Chủ đề đã dạy", names(r.topic_ids)],
    ].map(([label, text]) => `### ${t(label!)}\n\n${block(text || t("Chưa ghi"))}\n`).join("\n"),
  ).join("\n");
}
