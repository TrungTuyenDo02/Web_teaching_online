import { ButtonLink } from "../ui/Button";
import { Window } from "../ui/Window";
import { t } from "../lib/i18n";

/** Trang lỗi 404 kiểu cửa sổ ERROR (DESIGN.md 5.7): thân thiện, không đổ lỗi người dùng. */
export default function NotFoundPage() {
  return (
    <main className="centered">
      <Window title={t("Không tìm thấy trang")} file="error.exe" variant="danger">
        <p>{t("Ôi, trang này không có ở đây. Có thể đường dẫn đã cũ hoặc bị gõ nhầm.")}</p>
        <div className="btn-row">
          <ButtonLink variant="primary" to="/">
            {t("Về trang chính")}
          </ButtonLink>
        </div>
      </Window>
    </main>
  );
}
