"""Boot-time configuration (REQ-VND-3, REQ-VND-5).

Every value comes from the environment and is validated at startup, so a
missing key for the ACTIVE vendor fails before the service accepts a single
request. `STT_VENDOR` is the only switch needed to change vendor.
"""

from typing import Literal

from pydantic import Field, model_validator
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

    # Vendor resilience (REQ-VND-6, REQ-VND-7).
    #: Total attempts against the PRIMARY vendor, initial call included, so 1
    #: means "no retry". Zero would mean "never call the vendor at all".
    stt_retry_attempts: int = Field(default=2, ge=1)
    #: Base backoff between primary attempts; doubles each time (0.5s, 1s, ...).
    stt_retry_backoff_s: float = Field(default=0.5, ge=0.0)
    #: Automatic failover to the other vendor once the primary is exhausted.
    #: Only takes effect when the other vendor's key is configured.
    stt_fallback_enabled: bool = True
    #: Ceiling on ALL vendor work for one request - every attempt, every
    #: backoff, and the failover together. Without it the defaults above
    #: multiply out to 30 + 0.5 + 30 + 30 s of waiting before a 502
    #: (REQ-VND-8).
    stt_total_deadline_s: float = Field(default=45.0, gt=0)

    log_level: str = "INFO"

    deepgram_base_url: str = "https://api.deepgram.com"
    groq_base_url: str = "https://api.groq.com"

    def api_key_for(self, vendor: str) -> str | None:
        """API key of a named vendor, which is not always the active one.

        Failover calls the *other* vendor, so an adapter cannot read a key that
        follows `STT_VENDOR` - it would authenticate with the primary's
        credentials (REQ-VND-7).
        """
        return getattr(self, f"{vendor}_api_key", None)

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
