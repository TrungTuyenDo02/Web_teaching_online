from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường hoặc file .env (xem .env.example ở thư mục gốc)."""

    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    app_env: str = "development"
    app_name: str = "GiaSuOnline"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    # Chỉ cần cho dự án Supabase cũ ký HS256; dự án mới ký ES256, API tự lấy khóa công khai (JWKS)
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    livekit_token_ttl_seconds: int = 7200

    whiteboard_jwt_secret: str = ""
    whiteboard_token_ttl_seconds: int = 7200
    whiteboard_public_url: str = "ws://localhost:8787"
    # API gọi máy chủ bảng viết để đóng phòng (địa chỉ nội bộ, không phải của trình duyệt)
    whiteboard_internal_url: str = "http://localhost:8787"

    # Cho phép vào phòng sớm/muộn so với lịch (phút)
    join_early_minutes: int = 15
    join_late_minutes: int = 60

    # Chu kỳ chuyển buổi học quá giờ sang no_show (giây); 0 để tắt
    no_show_interval_seconds: int = 300

    recording_enabled: bool = False

    # AI tắt mặc định; key/model chỉ ở API, không đưa vào cấu hình web.
    assistant_enabled: bool = False
    openai_api_key: str = ""
    openai_chat_model: str = ""
    assistant_daily_user_turns: int = 20
    assistant_daily_total_turns: int = 100
    assistant_max_output_tokens: int = 1000
    # Chỉ mở bài giảng cho HS sau khi nghiệm thu E6/E7 với model thật.
    assistant_student_lessons_enabled: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def missing_required(self) -> list[str]:
        """Các biến bắt buộc khi chạy thật mà chưa được điền."""
        required = {
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SERVICE_ROLE_KEY": self.supabase_service_role_key,
            "LIVEKIT_URL": self.livekit_url,
            "LIVEKIT_API_KEY": self.livekit_api_key,
            "LIVEKIT_API_SECRET": self.livekit_api_secret,
            "WHITEBOARD_JWT_SECRET": self.whiteboard_jwt_secret,
        }
        return [name for name, value in required.items() if not value]


@lru_cache
def get_settings() -> Settings:
    return Settings()
