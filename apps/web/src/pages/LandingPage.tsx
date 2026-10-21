import { Link } from "react-router-dom";
import { brand } from "../brand";
import { t } from "../lib/i18n";
import { Badge } from "../ui/Badge";
import { ButtonLink } from "../ui/Button";
import { Decor, DecorLayer } from "../ui/Decor";
import { LangSwitch } from "../ui/LangSwitch";
import { Window, type WindowVariant } from "../ui/Window";

// Chỉ nêu điều ứng dụng làm thật (AGENTS.md): video 1-1, bảng bút trên tablet, lưu bảng/bài về nhà, không ghi hình
const FEATURES: { title: string; text: string; file: string; variant: WindowVariant; icon: string }[] = [
  {
    title: "Lớp 1-1 có video",
    text: "Thầy cô và em gặp nhau qua camera, micro ngay trên trình duyệt. Không cần cài ứng dụng.",
    file: "video.exe",
    variant: "periwinkle",
    icon: "◉",
  },
  {
    title: "Bảng viết bằng bút",
    text: "Thầy cô viết trên tablet, em thấy từng nét ngay lập tức, rõ như viết trên giấy.",
    file: "board.exe",
    variant: "pink",
    icon: "✎",
  },
  {
    title: "Xem lại sau buổi học",
    text: "Nội dung đã học, bài về nhà và bảng cuối buổi được lưu để em ôn lại bất cứ lúc nào.",
    file: "history.log",
    variant: "peach",
    icon: "↺",
  },
];

const STEPS = [
  "Thầy cô xếp lịch và gửi tài khoản cho em.",
  "Đến giờ, em đăng nhập và bấm \"Vào lớp\".",
  "Học qua video, theo dõi bảng viết trực tiếp.",
  "Cuối buổi, xem lại bảng và bài về nhà ở mục \"Buổi đã học\".",
];

const PRIVACY = [
  "Không ghi hình buổi học.",
  "Mỗi em chỉ thấy buổi học của mình.",
  "Lưu dữ liệu học tập khi phụ huynh đồng ý; xóa hẳn khi phụ huynh yêu cầu.",
];

/** Trang giới thiệu cho khách chưa đăng nhập (đường dẫn "/"); cùng kiểu cửa sổ với phần trong ứng dụng. */
export default function LandingPage() {
  return (
    <div className="shell landing">
      <DecorLayer />
      <header className="taskbar">
        <Link to="/" className="taskbar__brand">
          <span aria-hidden="true">✦</span> {brand.name}
        </Link>
        <div className="taskbar__user">
          <LangSwitch />
          <ButtonLink size="sm" variant="primary" to="/login">
            {t("Đăng nhập")}
          </ButtonLink>
        </div>
      </header>

      <main id="main" className="page">
        <section className="landing__hero" aria-labelledby="landing-title">
          <div className="landing__intro">
            <Badge tone="live">
              <Decor type="sparkle" size={14} /> {t("Gia sư trực tuyến 1-1")}
            </Badge>
            <h1 id="landing-title" className="landing__title">
              {t("Học cùng thầy cô, như ngồi cạnh nhau")}
            </h1>
            <p className="landing__lead">
              {t("Video, bảng viết tay và bài về nhà trong một trang. Dùng được trên máy tính, tablet và điện thoại.")}
            </p>
            <div className="btn-row">
              <ButtonLink variant="primary" size="lg" to="/login">
                {t("Đăng nhập để vào lớp")}
              </ButtonLink>
              <a className="btn btn--lg btn--ghost" href="#how">
                {t("Cách học")}
              </a>
            </div>
            <p className="muted">{t("Tài khoản do thầy cô cấp cho từng học sinh.")}</p>
          </div>

          <Window title={t("Bảng viết")} file="board.exe" variant="mint" className="landing__board" headingLevel={2}>
            <BoardArt />
          </Window>
        </section>

        <section className="landing__features" aria-label={t("Tính năng")}>
          {FEATURES.map((f) => (
            <Window key={f.file} title={t(f.title)} file={f.file} variant={f.variant} headingLevel={3}>
              <span className="landing__icon" aria-hidden="true">
                {f.icon}
              </span>
              <p>{t(f.text)}</p>
            </Window>
          ))}
        </section>

        <div className="grid-2">
          <Window title={t("Một buổi học diễn ra thế nào")} file="how_to.txt" variant="lavender" id="how">
            <ol className="landing__steps">
              {STEPS.map((step) => (
                <li key={step}>{t(step)}</li>
              ))}
            </ol>
          </Window>
          <Window title={t("Riêng tư cho học sinh")} file="privacy.txt" variant="glass">
            <ul className="landing__checks">
              {PRIVACY.map((item) => (
                <li key={item}>{t(item)}</li>
              ))}
            </ul>
          </Window>
        </div>

        <section className="window landing__cta" aria-labelledby="landing-cta">
          <div className="window__body">
            <h2 id="landing-cta">{t("Sẵn sàng vào lớp?")}</h2>
            <p className="muted">{t("Quên mật khẩu? Nhờ thầy cô đặt lại giúp.")}</p>
            <div className="btn-row">
              <ButtonLink variant="primary" size="lg" to="/login">
                {t("Đăng nhập")}
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing__footer">
        <span>
          ✦ {brand.name} · {t(brand.tagline)}
        </span>
      </footer>
    </div>
  );
}

/** Hình minh họa bảng viết tay (SVG thuần, không tải ảnh). */
function BoardArt() {
  return (
    <svg className="landing__art" viewBox="0 0 320 190" role="img" aria-label={t("Ví dụ bảng viết: hằng đẳng thức")}>
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M16 0H0V16" fill="none" stroke="var(--bg-grid-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="320" height="190" fill="url(#grid)" />
      <text x="24" y="62" className="landing__ink">(a + b)² =</text>
      <text x="56" y="112" className="landing__ink">a² + 2ab + b²</text>
      <path d="M50 124 C 110 134, 200 132, 262 120" fill="none" stroke="var(--pink-400)" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="162" cy="100" rx="36" ry="24" fill="none" stroke="var(--periwinkle-400)" strokeWidth="3" />
      <g transform="translate(250 136) rotate(-35)">
        <rect x="0" y="-6" width="56" height="12" rx="6" fill="var(--peach-300)" stroke="var(--ink-900)" strokeWidth="2" />
        <path d="M0 -6 L-12 0 L0 6 Z" fill="var(--ink-900)" />
      </g>
    </svg>
  );
}
