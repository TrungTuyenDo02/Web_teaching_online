"""Kiểm snapshot trước khi lưu: tương thích bảng cũ, giữ đủ files, giới hạn bucket boards."""

import base64
import hashlib
import json
import re
from typing import Any

from app.services import images

type BoardSnapshot = list[dict[str, Any]] | dict[str, Any]
MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024


def encode_snapshot(snapshot: BoardSnapshot) -> bytes:
    data = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Bảng quá lớn để lưu. Dữ liệu vẫn được giữ trên máy chủ bảng.")
    return data


def validate_snapshot(raw: Any) -> BoardSnapshot:
    if isinstance(raw, list):
        elements, files = raw, {}
    elif isinstance(raw, dict) and raw.get("version") == 2:
        elements, files = raw.get("elements"), raw.get("files")
    else:
        raise ValueError("Bảng đã lưu không hợp lệ")
    if not isinstance(elements, list) or not isinstance(files, dict) or len(files) > 20:
        raise ValueError("Bảng đã lưu không hợp lệ")
    encode_snapshot(raw)
    total = 0
    for key, file in files.items():
        if (
            not isinstance(key, str)
            or not re.fullmatch(r"[a-f0-9]{64}", key)
            or not isinstance(file, dict)
            or file.get("id") != key
            or not isinstance(file.get("created"), int | float)
        ):
            raise ValueError("Ảnh bảng không hợp lệ")
        mime, url = file.get("mimeType"), file.get("dataURL")
        if mime not in {"image/png", "image/jpeg", "image/webp"} or not isinstance(url, str):
            raise ValueError("Ảnh bảng không hợp lệ")
        prefix = f"data:{mime};base64,"
        if not url.startswith(prefix) or len(url) > 2_800_000:
            raise ValueError("Ảnh bảng không hợp lệ")
        try:
            data = base64.b64decode(url[len(prefix) :], validate=True)
            cleaned, detected = images.clean(data, 2 * 1024 * 1024)
        except ValueError as exc:
            raise ValueError("Ảnh bảng không hợp lệ") from exc
        if cleaned != data or detected != mime or hashlib.sha256(data).hexdigest() != key:
            raise ValueError("Ảnh bảng không hợp lệ")
        total += len(data)
    if total > 6 * 1024 * 1024:
        raise ValueError("Bảng vượt giới hạn ảnh")
    for el in elements:
        if not isinstance(el, dict) or (
            el.get("type") == "image" and el.get("fileId") not in files
        ):
            raise ValueError("Bảng đã lưu thiếu ảnh hoặc phần tử không hợp lệ")
    return raw
