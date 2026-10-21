"""Kiểm ảnh bài làm và gỡ metadata (EXIF/GPS, XMP, chú thích) trước khi lưu hoặc gửi OCR.

Không dùng thư viện ảnh: chỉ đọc cấu trúc đoạn/chunk của JPEG, PNG, WebP, không giải mã điểm ảnh.
Loại ảnh xác định theo chữ ký file, không tin Content-Type do trình duyệt gửi.
"""

import struct
import zlib


class InvalidImage(ValueError):
    pass


def sniff(data: bytes) -> str:
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise InvalidImage("Chỉ nhận ảnh JPEG, PNG hoặc WebP")


# Bỏ APP1 (EXIF/XMP, có GPS), APP13 (IPTC), COM; giữ APP0 (JFIF), APP2 (ICC), APP14
_JPEG_DROP = {0xE1, 0xED, 0xFE}


def _strip_jpeg(data: bytes) -> bytes:
    out = bytearray(b"\xff\xd8")
    i = 2
    while i < len(data):
        if data[i] != 0xFF:
            raise InvalidImage("Ảnh JPEG hỏng")
        marker = data[i + 1] if i + 1 < len(data) else None
        if marker is None:
            raise InvalidImage("Ảnh JPEG hỏng")
        if marker == 0xFF:  # byte đệm
            i += 1
            continue
        if marker == 0xD9 or 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += data[i : i + 2]
            i += 2
            continue
        if i + 4 > len(data):
            raise InvalidImage("Ảnh JPEG hỏng")
        (length,) = struct.unpack(">H", data[i + 2 : i + 4])
        end = i + 2 + length
        if length < 2 or end > len(data):
            raise InvalidImage("Ảnh JPEG hỏng")
        if marker == 0xDA:  # SOS: phần còn lại là dữ liệu ảnh nén tới EOI
            out += data[i:]
            return bytes(out)
        if marker not in _JPEG_DROP:
            out += data[i:end]
        i = end
    raise InvalidImage("Ảnh JPEG hỏng")


_PNG_DROP = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}


def _strip_png(data: bytes) -> bytes:
    out = bytearray(data[:8])
    i = 8
    while i + 12 <= len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        kind = data[i + 4 : i + 8]
        end = i + 12 + length
        if (
            end > len(data)
            or zlib.crc32(data[i + 4 : i + 8 + length])
            != struct.unpack(">I", data[i + 8 + length : end])[0]
        ):
            raise InvalidImage("Ảnh PNG hỏng")
        if kind not in _PNG_DROP:
            out += data[i:end]
        i = end
        if kind == b"IEND":
            return bytes(out)
    raise InvalidImage("Ảnh PNG hỏng")


def _strip_webp(data: bytes) -> bytes:
    (riff_size,) = struct.unpack("<I", data[4:8])
    if riff_size + 8 > len(data) or riff_size < 4:
        raise InvalidImage("Ảnh WebP hỏng")
    body = bytearray()
    i = 12
    while i < riff_size + 8:
        if i + 8 > len(data):
            raise InvalidImage("Ảnh WebP hỏng")
        fourcc = data[i : i + 4]
        (size,) = struct.unpack("<I", data[i + 4 : i + 8])
        end = i + 8 + size + (size & 1)
        if end > riff_size + 8:
            raise InvalidImage("Ảnh WebP hỏng")
        chunk = bytearray(data[i:end])
        if fourcc == b"VP8X" and size >= 1:
            chunk[8] &= ~(0x08 | 0x04) & 0xFF  # bỏ cờ có EXIF / có XMP
        if fourcc not in (b"EXIF", b"XMP "):
            body += chunk
        i = end
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + bytes(body)


def clean(data: bytes, max_bytes: int) -> tuple[bytes, str]:
    """Trả (ảnh đã gỡ metadata, MIME). Lỗi định dạng/dung lượng → InvalidImage (câu tiếng Việt)."""
    if not data:
        raise InvalidImage("Ảnh trống")
    if len(data) > max_bytes:
        raise InvalidImage(f"Ảnh quá lớn (tối đa {max_bytes // (1024 * 1024)} MB)")
    mime = sniff(data)
    try:
        stripped = {"image/jpeg": _strip_jpeg, "image/png": _strip_png, "image/webp": _strip_webp}[
            mime
        ](data)
    except (struct.error, IndexError) as exc:
        raise InvalidImage("Ảnh hỏng hoặc không đọc được") from exc
    return stripped, mime
