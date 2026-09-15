from functools import lru_cache
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalize_url(url: str) -> str:
    value = url.strip()
    if not value:
        return value

    if value.startswith("https:/") and not value.startswith("https://"):
        value = value.replace("https:/", "https://", 1)

    if value.startswith("http:/") and not value.startswith("http://"):
        value = value.replace("http:/", "http://", 1)

    return value


def _validate_database_url(url: str) -> str:
    if url.startswith("sqlite"):
        return url

    parsed = urlparse(url)

    if not parsed.hostname or "@" in (parsed.hostname or ""):
        raise ValueError(
            "DATABASE_URL looks malformed. Use the Supabase connection URI exactly as copied "
            "(postgresql://postgres.[ref]:[password]@....pooler.supabase.com:6543/postgres). "
            "Do not include your email in the URL. URL-encode special characters in the password."
        )

    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "رَيّ — RAYY API"
    api_v1_prefix: str = "/api/v1"

    # Auth mode: "supabase" (default) validates Supabase-issued access tokens via
    # Supabase's JWKS endpoint. "legacy" validates locally-issued HS256 JWTs signed
    # with `secret_key`. Explicitly set AUTH_MODE=legacy to opt into the legacy path;
    # otherwise the app always runs in Supabase mode.
    auth_mode: str = "supabase"

    # JWT (legacy auth mode only)
    secret_key: str = "dev-secret-key-change-this"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # Supabase
    # NOTE: supabase_jwt_secret is NOT required. Supabase access tokens are verified
    # against Supabase's public JWKS (asymmetric ES256/RS256), not a shared HS256
    # secret. This field is only kept for backward compatibility with old .env files
    # and is unused by the current verification path.
    supabase_url: str = "https://ftaxppokgpmsnuipvvvt.supabase.co"
    supabase_jwt_secret: str = ""

    # Database
    database_url: str = "sqlite:///./data/app.db"

    # CORS
    # Includes the ports Vite falls back to: it auto-increments when the chosen
    # port is already taken (e.g. a previous dev server is still running), so a
    # frontend on 5174/5175 must still be able to reach the API.
    cors_origins: str = (
        "http://localhost:5173,"
        "http://localhost:5174,"
        "http://localhost:5175,"
        "http://localhost:3000,"
        "https://smart-plant-dr.vercel.app"
    )

    # Storage / ML
    uploads_dir: str = "uploads"
    ai_root: str = ""
    # Default to the production 29-class MobileNetV2 bundle that ships with the
    # backend package. The older 65-class EfficientNet-B3 checkpoint in
    # ai/exports/ has NO class-name metadata and falls back to Class_0..Class_64,
    # which must never reach the user-facing diagnosis. Resolving this relative to
    # the backend package directory keeps it independent of the process CWD.
    model_path: str = "app/ml/exports/smart_plant_doctor_model.pth"
    confidence_threshold: float = 0.70
    model_temperature: float = 1.0
    max_upload_size_mb: int = 10
    allowed_image_types: str = "image/jpeg,image/jpg,image/png,image/webp"

    @property
    def allowed_image_type_list(self) -> list[str]:
        return [t.strip() for t in self.allowed_image_types.split(",") if t.strip()]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    # Gemini
    gemini_api_key: str = ""
    # Effective chat model chain (comma-separated, priority order).
    # gemini-3.5-flash-lite is the fastest verified model (~0.8s first token) and
    # is the primary. gemini-3.6-flash is a verified fallback. gemma-4-26b-a4b-it
    # is correct but slow (~35s) and is kept only as a last-resort fallback for an
    # actual provider failure, never when a stream already produced text.
    gemini_chat_models: str = "gemini-3.5-flash-lite,gemini-3.6-flash,gemma-4-26b-a4b-it"

    # Blynk
    blynk_auth_token: str = ""
    blynk_server: str = "https://blr1.blynk.cloud"

    # Public API
    public_api_url: str = "http://localhost:8000"

    @field_validator("blynk_auth_token")
    @classmethod
    def strip_blynk_token(cls, value: str) -> str:
        return value.strip()

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        return _validate_database_url(value)

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, value: str) -> str:
        value = _normalize_url(value)

        if value and not value.startswith(("http://", "https://")):
            raise ValueError("SUPABASE_URL must start with https://")

        return value.rstrip("/")

    @field_validator("auth_mode")
    @classmethod
    def validate_auth_mode(cls, value: str) -> str:
        value = (value or "").strip().lower()
        if value not in ("supabase", "legacy"):
            raise ValueError('AUTH_MODE must be either "supabase" or "legacy"')
        return value

    @model_validator(mode="after")
    def check_auth_mode_requirements(self) -> "Settings":
        if self.auth_mode == "supabase" and not self.supabase_url:
            raise ValueError(
                "AUTH_MODE=supabase requires SUPABASE_URL to be configured so the "
                "backend can fetch Supabase's JWKS to verify access tokens."
            )
        return self

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        parts = [
            _normalize_url(part.strip())
            for part in value.split(",")
            if part.strip()
        ]

        return ",".join(parts)

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    @property
    def use_supabase_auth(self) -> bool:
        return self.auth_mode == "supabase"


@lru_cache
def get_settings() -> Settings:
    return Settings()
