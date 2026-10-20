import { t } from "../lib/i18n";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { Window, type WindowVariant } from "./Window";

interface DialogProps {
  open: boolean;
  title: ReactNode;
  file?: string;
  variant?: WindowVariant;
  /** Esc, bấm nút Đóng: không đóng khi đang gửi (busy) */
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}

/**
 * Hộp thoại modal dùng <dialog> gốc của trình duyệt: giữ focus bên trong, Esc để đóng,
 * trả focus về nút đã mở khi đóng. Có một nút Đóng thật (không có nút giả).
 */
export function Dialog({ open, title, file, variant = "lavender", onClose, busy, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={open ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault(); // tự quyết định đóng để giữ trạng thái React khớp
        if (!busy) onClose();
      }}
    >
      {open && (
        <Window
          title={title}
          titleId={titleId}
          file={file}
          variant={variant}
          actions={
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy} aria-label={t("Đóng hộp thoại")}>
              {t("Đóng")}
            </Button>
          }
        >
          {children}
        </Window>
      )}
    </dialog>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  /** Nội dung giải thích hậu quả */
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Bắt buộc tích "tôi hiểu" trước khi xác nhận (thao tác không hoàn tác được) */
  acknowledge?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  acknowledge,
  busy,
  error,
  onConfirm,
  onClose,
}: ConfirmProps) {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) setChecked(false);
  }, [open]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!acknowledge || checked) onConfirm();
  }

  return (
    <Dialog open={open} title={title} file={danger ? "warning.exe" : "confirm.exe"} variant={danger ? "danger" : "lavender"} onClose={onClose} busy={busy}>
      <form className="form" onSubmit={onSubmit}>
        <div className="stack">{children}</div>
        {acknowledge && (
          <label className="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {acknowledge}
          </label>
        )}
        {error && (
          <p className="field__error" role="alert">
            {error}
          </p>
        )}
        <div className="btn-row btn-row--end">
          <Button onClick={onClose} disabled={busy}>
            {t("Thôi")}
          </Button>
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            busy={busy}
            disabled={Boolean(acknowledge) && !checked}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
