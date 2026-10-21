"""Kiểm tra cấu hình và schema trước khi chạy với dịch vụ thật, CHỈ ĐỌC, không in giá trị bí mật.

Chạy từ apps/api: `.venv/Scripts/python -m app.preflight` (Linux/macOS: `.venv/bin/python`).
In mỗi mục một dòng: ĐẠT / CHƯA ÁP / LỖI kèm mã trạng thái, không in URL, khóa hay dữ liệu.
Không ghi gì vào Supabase, Storage, LiveKit hay máy chủ bảng. Mã thoát 0 khi mọi mục đạt.
"""

import asyncio
import sys

import httpx

from app.config import Settings, get_settings
from app.services.tokens import count_livekit_rooms

# Migration -> (bảng, cột) mà nó thêm. 0003 chỉ đổi quyền của trình duyệt, service role không thấy
# khác biệt: kiểm bằng tài khoản học sinh (docs/acceptance.md).
MIGRATION_PROBES = {
    "0004_session_finalize": ("sessions", "finalized_at"),
    "0005_student_deleting": ("students", "deleting_at"),
    "0006_board_upload_intents": ("board_upload_intents", "id"),
    "0007_upload_intent_cleaned": ("board_upload_intents", "cleaned_at"),
    "0008_private_teaching_notes": ("session_notes", "revision"),
    "0008_teaching_topics": ("teaching_topics", "id"),
    "0008_session_topics": ("session_topics", "topic_id"),
    "0009_weekly_slots": ("weekly_slots", "id"),
    "0009_session_slot": ("sessions", "slot_date"),
}
PLACEHOLDER = "YOUR-PROJECT"


def _code(resp: httpx.Response) -> str:
    try:
        return str(resp.json().get("code", ""))
    except ValueError:
        return ""


def classify_probe(resp: httpx.Response) -> str:
    """Kết quả `select=<cột>&limit=0` của PostgREST: 'applied', 'missing' hoặc 'error <mã>'."""
    if resp.status_code == 200:
        return "applied"
    # 42703: thiếu cột; 42P01/PGRST205: thiếu bảng
    if _code(resp) in {"42703", "42P01", "PGRST205"}:
        return "missing"
    return f"error HTTP {resp.status_code} {_code(resp)}".strip()


def config_issues(settings: Settings) -> list[str]:
    """Tên biến còn thiếu hoặc còn giá trị mẫu (không in giá trị)."""
    issues = [f"{name} thiếu" for name in settings.missing_required()]
    urls = {"SUPABASE_URL": settings.supabase_url, "LIVEKIT_URL": settings.livekit_url}
    issues += [f"{name} còn giá trị mẫu" for name, value in urls.items() if PLACEHOLDER in value]
    # Bật AI mà thiếu key/model thì API trả 503 mọi lượt: báo sớm, không in giá trị
    if settings.assistant_enabled:
        issues += [
            f"{n} thiếu (ASSISTANT_ENABLED=true)"
            for n, v in (
                ("OPENAI_API_KEY", settings.openai_api_key),
                ("OPENAI_CHAT_MODEL", settings.openai_chat_model),
            )
            if not v
        ]
    if settings.ocr_enabled:
        issues += [
            f"{n} thiếu (OCR_ENABLED=true)"
            for n, v in (
                ("GEMINI_API_KEY", settings.gemini_api_key),
                ("GEMINI_OCR_MODEL", settings.gemini_ocr_model),
            )
            if not v
        ]
    return issues


async def run(settings: Settings) -> int:
    failed = 0

    def report(ok: bool, name: str, detail: str = "") -> None:
        nonlocal failed
        failed += not ok
        print(f"{'ĐẠT' if ok else 'LỖI'}  {name}{f': {detail}' if detail else ''}")

    issues = config_issues(settings)
    report(not issues, "biến môi trường", ", ".join(issues))

    base = settings.supabase_url.rstrip("/")
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=10) as client:

        async def get(url: str, **kw) -> httpx.Response:
            try:
                return await client.get(url, **kw)
            except httpx.HTTPError as exc:  # chỉ giữ tên lỗi: thông điệp có thể chứa URL
                return httpx.Response(599, json={"code": type(exc).__name__})

        if base and PLACEHOLDER not in base:
            resp = await get(f"{base}/rest/v1/profiles?select=id&limit=0", headers=headers)
            report(resp.status_code == 200, "Supabase PostgREST bằng service role", _err(resp))

            for migration, (table, column) in MIGRATION_PROBES.items():
                resp = await get(f"{base}/rest/v1/{table}?select={column}&limit=0", headers=headers)
                state = classify_probe(resp)
                if state == "missing":
                    failed += 1
                    print(f"CHƯA ÁP  {migration}")
                else:
                    report(state == "applied", f"migration {migration}", _err(resp))

            for bucket in ("boards", "submissions"):
                resp = await get(f"{base}/storage/v1/bucket/{bucket}", headers=headers)
                private = resp.status_code == 200 and resp.json().get("public") is False
                report(
                    private,
                    f"bucket {bucket} tồn tại, riêng tư",
                    "" if private else _err(resp) or "công khai",
                )

            if not settings.supabase_jwt_secret:
                resp = await get(f"{base}/auth/v1/.well-known/jwks.json")
                keys = len(resp.json().get("keys", [])) if resp.status_code == 200 else 0
                report(keys > 0, "JWKS của Supabase Auth", f"{keys} khóa" if keys else _err(resp))

        resp = await get(f"{settings.whiteboard_internal_url.rstrip('/')}/health")
        report(resp.status_code == 200, "máy chủ bảng (WHITEBOARD_INTERNAL_URL)/health", _err(resp))

    lk_ready = settings.livekit_url and settings.livekit_api_secret
    if lk_ready and PLACEHOLDER not in settings.livekit_url:
        try:
            rooms = await count_livekit_rooms(settings)
            report(True, "LiveKit (liệt kê phòng)", f"{rooms} phòng đang mở")
        except Exception as exc:  # noqa: BLE001 - chỉ báo loại lỗi, không in khóa
            report(False, "LiveKit (liệt kê phòng)", type(exc).__name__)

    print("Kết quả:", "mọi mục đạt" if not failed else f"{failed} mục chưa đạt")
    return 1 if failed else 0


def _err(resp: httpx.Response) -> str:
    return "" if resp.status_code == 200 else f"HTTP {resp.status_code} {_code(resp)}".strip()


if __name__ == "__main__":
    sys.exit(asyncio.run(run(get_settings())))
