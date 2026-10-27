import { t } from "./i18n.ts";

// Không import api.ts: file này chạy cả trong test Node (web-helper-guide.test.ts)
type Role = "teacher" | "student";

export interface GuideReply {
  text: string;
  links: { to: string; label: string }[];
}

/** Bỏ dấu, chỉ giữ chữ và số, cách nhau bởi một dấu cách và có dấu cách hai đầu để so khớp trọn từ. */
const normalize = (value: string) =>
  ` ${value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Hướng dẫn xác định, không gọi model, không đọc dữ liệu cá nhân hay thực hiện thao tác ghi. */
export function answerGuide(question: string, role: Role): GuideReply {
  const q = normalize(question);
  // Trọn từ: "ve" không khớp "veo", "lich" không khớp "lich su" vì lịch sử được xét trước
  const has = (...phrases: string[]) => phrases.some((phrase) => q.includes(` ${phrase} `));
  const teacher = role === "teacher";
  const home = { to: "/", label: t("Mở trang chính") };
  const history = { to: "/history", label: t("Mở buổi đã học") };
  // Thứ tự là độ ưu tiên: cụm cụ thể ("cham bai", "lich su") đứng trước từ chung ("cham", "lich")
  if (has("mat khau", "password", "dang nhap", "login", "tai khoan", "account")) {
    return teacher
      ? { text: t("Trong trang Học sinh, chọn học sinh rồi dùng Tạo tài khoản hoặc Đặt lại mật khẩu. Hãy nhập mật khẩu trong biểu mẫu, không gửi vào cuộc trò chuyện."), links: [{ to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Nếu quên mật khẩu, em nhờ thầy cô đặt lại trong trang Học sinh. Đừng gửi mật khẩu vào cuộc trò chuyện."), links: [] };
  }
  if (has("giai bai", "giai giup", "loi giai", "dap an", "bai toan", "kien thuc", "solve", "explain")) {
    return { text: t("Hiện mình hỗ trợ cách sử dụng ứng dụng, chưa giải đáp kiến thức bài học. Với câu hỏi về bài tập, hãy ghi phần đã thử và chỗ chưa hiểu để trao đổi cùng thầy cô."), links: [history] };
  }
  if (teacher && has("cham nhanh", "cham bai nhanh", "nhan xet mau", "nhan xet co san", "cho cham", "bai tiep theo", "comment bank")) {
    return { text: t("Trong Bài tập, mục Chờ chấm chỉ hiện bài học sinh đã nộp. Bấm Xem và chấm, chạm một nhận xét có sẵn để chèn (gồm các nhận xét thầy cô đã dùng), chọn nhanh điểm rồi bấm Trả bài: bài chờ chấm tiếp theo tự mở. Nhận xét đang viết dở được giữ khi đóng hộp thoại, tới khi tải lại trang."), links: [{ to: "/assignments", label: t("Mở bài tập") }] };
  }
  if (has("nop", "nop bai", "bai tap", "chua tren anh", "bai ve nha", "giao bai", "cham bai", "cham diem", "tra bai", "chua bai", "lam lai", "diem", "chup", "anh bai", "homework", "assignment", "submit", "grade", "score", "redo")) {
    return teacher
      ? { text: t("Mở Bài tập, bấm Giao bài, chọn học sinh, đề bài và hạn nộp. Bài học sinh đã nộp hiện nút Xem và chấm: xem ảnh, Chữa trên ảnh bằng bút, nhập nhận xét và điểm rồi bấm Trả bài. Nếu cần sửa, bấm Yêu cầu làm lại kèm nhận xét."), links: [{ to: "/assignments", label: t("Mở bài tập") }] }
      : { text: t("Ở Trang chính, mục Bài tập, bấm Nộp bài rồi Chụp ảnh hoặc Chọn ảnh có sẵn, tối đa 6 ảnh, mỗi trang một ảnh rõ nét. Xem lại ảnh, bỏ ảnh chụp hỏng rồi bấm Nộp bài. Khi thầy cô trả bài, em thấy điểm, nhận xét và ảnh chữa ngay ở đó; nếu thầy cô yêu cầu làm lại thì bấm Nộp lại. Lời dặn bài về nhà sau mỗi buổi nằm ở Buổi đã học."), links: [home, history] };
  }
  if (has("lich su", "xem lai", "buoi da hoc", "history", "review", "past")) {
    return { text: t("Mở Buổi đã học, chọn buổi để xem nội dung và bài về nhà. Nếu đã lưu bảng, bấm Xem lại bảng để mở bản cuối buổi."), links: [history] };
  }
  if (has("bao cao", "report", "bao nhieu buoi", "so buoi", "thong ke", "count", "csv")) {
    return teacher
      ? { text: t("Mở Báo cáo tháng, chọn tháng để xem số buổi đã kết thúc của từng học sinh và tải CSV. Buổi đang học, đã hủy hoặc vắng không được tính vào số này."), links: [{ to: "/reports", label: t("Mở báo cáo tháng") }] }
      : { text: t("Em xem các buổi đã học của mình ở Buổi đã học. Báo cáo tổng hợp của lớp dành cho thầy cô."), links: [history] };
  }
  if (has("ghi chu", "note", "notes", "chu de", "topic")) {
    return teacher
      ? { text: t("Mở Ghi chú riêng, chọn học sinh và tháng, rồi chọn buổi đã kết thúc để ghi nhận xét và chủ đề đã dạy. Chỉ giáo viên xem được phần này; nội dung và bài về nhà ở lịch sử buổi học vẫn có thể hiển thị cho học sinh."), links: [{ to: "/teaching-notes", label: t("Mở ghi chú riêng") }] }
      : { text: t("Em xem nội dung buổi học và lời nhắn bài về nhà ở Buổi đã học. Ghi chú riêng của giáo viên không hiển thị cho học sinh."), links: [history] };
  }
  if (has("vong", "hu", "echo", "tre", "cham", "lag", "giat", "re", "ngat", "mat tieng", "khong nghe", "am thanh", "sound", "audio", "loa", "tai nghe", "micro", "mic", "camera", "video", "mang", "wifi", "network", "ket noi", "connection", "token", "het han")) {
    return { text: t("Vọng hoặc hú: đeo tai nghe; hai máy cùng phòng thì tắt loa và micro một máy. Tiếng chậm, rè, ngắt quãng: ngồi gần Wi-Fi hoặc cắm dây mạng, dừng tải và xem video khác; ô video hiện chữ mạng yếu ở bên mạng kém. Trình duyệt cần được phép dùng camera và micro. Báo token hết hạn thì tải lại trang hoặc đăng nhập lại; đừng gửi token vào chat."), links: [] };
  }
  if (has("hoc sinh", "student", "students", "ho so", "profile", "xoa", "delete")) {
    return teacher
      ? { text: t("Trang Học sinh có các thao tác thêm, sửa, tạo tài khoản, ngừng dạy và Xem hồ sơ (lịch, buổi đã học, bài tập, điểm). Xóa hẳn chỉ thực hiện sau khi ngừng dạy và có xác nhận; mình không tự xóa hay thay đổi dữ liệu qua chat."), links: [{ to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Em chỉ xem dữ liệu học tập của mình. Nếu cần đổi thông tin tài khoản hoặc lịch học, hãy nhờ thầy cô hỗ trợ."), links: [home] };
  }
  if (has("lich", "schedule", "vao lop", "vao phong", "join", "buoi hoc", "lesson", "ket thuc", "end", "hang tuan", "weekly")) {
    return teacher
      ? { text: t("Ở Trang chính, tạo buổi học và chọn học sinh, thời gian. Đến giờ, bấm Vào phòng trên laptop; tablet dùng chế độ chỉ bảng. Khi dạy xong, bấm Kết thúc để tính buổi và lưu bảng. Lịch hằng tuần nằm trong trang Học sinh."), links: [home, { to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Em mở Trang chính để xem lịch và bấm Vào phòng khi đến giờ. Nếu chưa thấy buổi học hoặc lịch chưa đúng, hãy nhờ thầy cô kiểm tra. Em không tự tạo hay kết thúc buổi học."), links: [home] };
  }
  if (has("bang", "board", "tablet", "but", "pen", "viet", "draw")) {
    return teacher
      ? { text: t("Dùng laptop cho camera và micro, tablet Android cho bảng viết. Trên tablet chọn chế độ chỉ bảng để không vào video. Giáo viên được viết; học sinh chỉ xem. Có thể tải ảnh PNG bằng nút Tải ảnh bảng."), links: [home] }
      : { text: t("Trong phòng học, bảng tự nhận nét viết của thầy cô; tài khoản học sinh ở chế độ chỉ xem. Sau buổi học, em vào Buổi đã học để xem lại bảng đã lưu."), links: [history] };
  }
  return {
    text: teacher
      ? t("Mình chưa hiểu câu này. Mình hướng dẫn được: quản lý học sinh, xếp lịch, giao và chấm bài, bảng viết, báo cáo, ghi chú riêng. Chọn một gợi ý bên dưới hoặc hỏi ngắn, ví dụ “chấm bài”.")
      : t("Mình chưa hiểu câu này. Mình hướng dẫn được: xem lịch, vào lớp, nộp bài tập, xem lại bảng, lỗi tiếng. Chọn một gợi ý bên dưới hoặc hỏi ngắn, ví dụ “nộp bài”."),
    links: [],
  };
}

/** Câu gợi ý cho Teacher-Ops chỉ đọc. */
export function opsSuggestions(): string[] {
  return [t("Tuần này tôi có những buổi nào?"), t("Tháng này mỗi em học mấy buổi?")];
}

/** Gợi ý theo trang đang mở, như trợ giúp của các ứng dụng lớn: đang ở Bài tập thì hỏi về chấm bài. */
export function guideSuggestions(role: Role, path = "/"): string[] {
  if (role === "teacher" && path.startsWith("/assignments")) {
    return [t("Chấm bài nhanh"), t("Yêu cầu làm lại"), t("Chữa trên ảnh"), t("Giao bài mới")];
  }
  if (role === "teacher" && path.startsWith("/students")) {
    return [t("Xem hồ sơ học sinh"), t("Đặt lại mật khẩu"), t("Xếp lịch hằng tuần"), t("Ngừng dạy, xóa học sinh")];
  }
  return role === "teacher"
    ? [t("Quản lý học sinh"), t("Xếp lịch học"), t("Giao và chấm bài"), t("Xem báo cáo tháng")]
    : [t("Xem lịch và vào lớp"), t("Nộp bài tập"), t("Xem lại bảng"), t("Tiếng vọng, trễ")];
}
