"""Boot-time configuration (REQ-VND-3, REQ-VND-5).

Every value comes from the environment and is validated at startup, so a
missing key for the ACTIVE vendor fails before the service accepts a single
request. `STT_VENDOR` is the only switch needed to change vendor.
"""

from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

VendorName = Literal["deepgram", "groq"]

#: Env var holding the API key for each supported vendor.
VENDOR_KEY_ENV = {"deepgram": "DEEPGRAM_API_KEY", "groq": "GROQ_API_KEY"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    stt_vendor: VendorName = "deepgram"
    deepgram_api_key: str | None = None
    groq_api_key: str | None = None

    # Deepgram request parameters, frozen by REQ-VND-1.
    stt_language: str = "es"
    stt_model: str = "nova-3"
    stt_numerals: bool = True
    stt_mip_opt_out: bool = True

    # is_garbage policy thresholds (REQ-STT-3).
    stt_confidence_floor: float = 0.60
    stt_min_speech_ms: int = 300

    # Upload cap, aligned with Starlette's 1 MiB spool threshold so the
    # SpooledTemporaryFile never rolls over to disk (design Decision 6).
    stt_max_upload_bytes: int = 1_048_576

    stt_vendor_timeout_s: float = 30.0
    log_level: str = "INFO"

    deepgram_base_url: str = "https://api.deepgram.com"
    groq_base_url: str = "https://api.groq.com"

    @property
    def active_api_key(self) -> str:
        """API key of the currently selected vendor."""
        return getattr(self, f"{self.stt_vendor}_api_key")

    @model_validator(mode="after")
    def _require_active_vendor_key(self) -> "Settings":
        if not getattr(self, f"{self.stt_vendor}_api_key", None):
            raise ValueError(
                f"{VENDOR_KEY_ENV[self.stt_vendor]} is required when "
                f"STT_VENDOR={self.stt_vendor}"
            )
        return self
