import type { Role } from "./api";
import { t } from "./i18n";

export interface GuideReply {
  text: string;
  links: { to: string; label: string }[];
}

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");

/** Hướng dẫn xác định, không gọi model, không đọc dữ liệu cá nhân hay thực hiện thao tác ghi. */
export function answerGuide(question: string, role: Role): GuideReply {
  const q = normalize(question);
  const has = (...words: string[]) => words.some((word) => q.includes(word));
  const home = { to: "/", label: t("Mở trang chính") };
  const history = { to: "/history", label: t("Mở buổi đã học") };
  if (has("mat khau", "password", "dang nhap", "login", "tai khoan", "account")) {
    return role === "teacher"
      ? { text: t("Trong trang Học sinh, chọn học sinh rồi dùng Tạo tài khoản hoặc Đặt lại mật khẩu. Hãy nhập mật khẩu trong biểu mẫu, không gửi vào cuộc trò chuyện."), links: [{ to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Nếu quên mật khẩu, em nhờ thầy cô đặt lại trong trang Học sinh. Đừng gửi mật khẩu vào cuộc trò chuyện."), links: [] };
  }
  if (has("bao cao", "report", "bao nhieu buoi", "so buoi", "count", "csv")) {
    return role === "teacher"
      ? { text: t("Mở Báo cáo tháng, chọn tháng để xem số buổi đã kết thúc của từng học sinh và tải CSV. Buổi đang học, đã hủy hoặc vắng không được tính vào số này."), links: [{ to: "/reports", label: t("Mở báo cáo tháng") }] }
      : { text: t("Em xem các buổi đã học của mình ở Buổi đã học. Báo cáo tổng hợp của lớp dành cho thầy cô."), links: [history] };
  }
  if (has("ghi chu", "note", "chu de", "topic")) {
    return role === "teacher"
      ? { text: t("Mở Ghi chú riêng, chọn học sinh và tháng, rồi chọn buổi đã kết thúc để ghi nhận xét và chủ đề đã dạy. Chỉ giáo viên xem được phần này; nội dung và bài về nhà ở lịch sử buổi học vẫn có thể hiển thị cho học sinh."), links: [{ to: "/teaching-notes", label: t("Mở ghi chú riêng") }] }
      : { text: t("Em xem nội dung buổi học và lời nhắn bài về nhà ở Buổi đã học. Ghi chú riêng của giáo viên không hiển thị cho học sinh."), links: [history] };
  }
  if (has("hoc sinh", "student", "xoa", "delete")) {
    return role === "teacher"
      ? { text: t("Trang Học sinh có các thao tác thêm, sửa, tạo tài khoản và ngừng dạy. Xóa hẳn chỉ thực hiện sau khi ngừng dạy và có xác nhận; mình không tự xóa hay thay đổi dữ liệu qua chat."), links: [{ to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Em chỉ xem dữ liệu học tập của mình. Nếu cần đổi thông tin tài khoản hoặc lịch học, hãy nhờ thầy cô hỗ trợ."), links: [home] };
  }
  if (has("lich", "schedule", "vao lop", "join", "vao phong", "buoi hoc", "lesson", "ket thuc", "end session")) {
    return role === "teacher"
      ? { text: t("Ở Trang chính, tạo buổi học và chọn học sinh, thời gian. Đến giờ, bấm Vào phòng trên laptop; tablet dùng chế độ chỉ bảng. Khi dạy xong, bấm Kết thúc để tính buổi và lưu bảng. Lịch hằng tuần nằm trong trang Học sinh."), links: [home, { to: "/students", label: t("Mở học sinh") }] }
      : { text: t("Em mở Trang chính để xem lịch và bấm Vào phòng khi đến giờ. Nếu chưa thấy buổi học hoặc lịch chưa đúng, hãy nhờ thầy cô kiểm tra. Em không tự tạo hay kết thúc buổi học."), links: [home] };
  }
  if (has("xem lai", "history", "review", "bai ve nha", "homework")) {
    return { text: t("Mở Buổi đã học, chọn buổi để xem nội dung và bài về nhà. Nếu đã lưu bảng, bấm Xem lại bảng để mở bản cuối buổi."), links: [history] };
  }
  if (has("bang", "board", "tablet", "but", "pen", "ve", "draw")) {
    return role === "teacher"
      ? { text: t("Dùng laptop cho camera và micro, tablet Android cho bảng viết. Trên tablet chọn chế độ chỉ bảng để không vào video. Giáo viên được viết; học sinh chỉ xem. Có thể tải ảnh PNG bằng nút Tải ảnh bảng."), links: [home] }
      : { text: t("Trong phòng học, bảng tự nhận nét viết của thầy cô; tài khoản học sinh ở chế độ chỉ xem. Sau buổi học, em vào Buổi đã học để xem lại bảng đã lưu."), links: [history] };
  }
  if (has("token", "het han", "ket noi", "connection", "camera", "micro", "video", "am thanh", "sound", "mang", "network")) {
    return { text: t("Thử tải lại trang và kiểm tra mạng. Nếu báo token không hợp lệ hoặc hết hạn ở nhiều trang, thử đăng nhập lại; nếu vẫn lỗi, báo thầy cô hoặc người quản trị kèm tên trang và chữ lỗi. Đừng gửi token hay mật khẩu. Camera và micro cần được cho phép trong trình duyệt."), links: [] };
  }
  if (has("giai", "toan", "math", "dap an", "answer", "kien thuc", "explain", "bai tap", "exercise")) {
    return { text: t("Hiện mình hỗ trợ cách sử dụng ứng dụng, chưa giải đáp kiến thức bài học. Với câu hỏi về bài tập, hãy ghi phần đã thử và chỗ chưa hiểu để trao đổi cùng thầy cô."), links: [history] };
  }
  return {
    text: role === "teacher"
      ? t("Mình có thể hướng dẫn quản lý học sinh, xếp buổi học, dùng bảng, xem báo cáo và ghi chú riêng. Bạn muốn bắt đầu với việc nào?")
      : t("Mình có thể hướng dẫn em xem lịch, vào lớp, xem lại bảng và tìm bài về nhà. Em muốn mình giúp phần nào?"),
    links: [],
  };
}

export function guideSuggestions(role: Role): string[] {
  return role === "teacher"
    ? [t("Quản lý học sinh"), t("Xếp lịch học"), t("Xem báo cáo tháng"), t("Viết ghi chú riêng")]
    : [t("Xem lịch và vào lớp"), t("Xem lại bảng"), t("Tìm bài về nhà"), t("Quên mật khẩu")];
}
