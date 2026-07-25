"""Boot-time configuration (REQ-VND-3, REQ-VND-5).

Every value comes from the environment and is validated at startup, so a
missing key for the ACTIVE vendor fails before the service accepts a single
request. `STT_VENDOR` is the only switch needed to change vendor.
"""

from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

VendorName = Literal["deepgram", "groq", "elevenlabs"]

#: Env var holding the API key for each supported vendor.
VENDOR_KEY_ENV = {
    "deepgram": "DEEPGRAM_API_KEY",
    "groq": "GROQ_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    stt_vendor: VendorName = "deepgram"
    deepgram_api_key: str | None = None
    groq_api_key: str | None = None
    elevenlabs_api_key: str | None = None

    # Deepgram request parameters, frozen by REQ-VND-1.
    stt_language: str = "es"
    stt_model: str = "nova-3"
    stt_numerals: bool = True
    stt_mip_opt_out: bool = True

    #: ElevenLabs Scribe model: `scribe_v1` or `scribe_v2` (REQ-VND-9).
    stt_elevenlabs_model: str = "scribe_v1"

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
    #: Automatic failover to another vendor once the primary is exhausted.
    #: Only takes effect when the chosen vendor's key is configured.
    stt_fallback_enabled: bool = True
    #: Which vendor to fail over to. `None` means auto: the first vendor other
    #: than the primary with a configured key, in `FALLBACK_PRIORITY` order.
    #: With three vendors "the other one" is no longer a definition, so an
    #: operator can name it (REQ-VND-9).
    stt_fallback_vendor: VendorName | None = None
    #: Ceiling on ALL vendor work for one request - every attempt, every
    #: backoff, and the failover together. Without it the defaults above
    #: multiply out to 30 + 0.5 + 30 + 30 s of waiting before a 502
    #: (REQ-VND-8).
    stt_total_deadline_s: float = Field(default=45.0, gt=0)

    log_level: str = "INFO"

    deepgram_base_url: str = "https://api.deepgram.com"
    groq_base_url: str = "https://api.groq.com"
    elevenlabs_base_url: str = "https://api.elevenlabs.io"

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

    @field_validator("stt_fallback_vendor", mode="before")
    @classmethod
    def _blank_fallback_is_unset(cls, value: object) -> object:
        """`STT_FALLBACK_VENDOR: ${STT_FALLBACK_VENDOR:-}` sends an empty string.

        Compose has no way to omit a variable it declares, so treat a blank as
        "not configured" rather than rejecting the deployment's own default.
        """
        return None if value == "" else value

    @model_validator(mode="after")
    def _require_active_vendor_key(self) -> "Settings":
        if not getattr(self, f"{self.stt_vendor}_api_key", None):
            raise ValueError(
                f"{VENDOR_KEY_ENV[self.stt_vendor]} is required when "
                f"STT_VENDOR={self.stt_vendor}"
            )
        return self

    @model_validator(mode="after")
    def _validate_explicit_fallback(self) -> "Settings":
        """An explicitly named fallback must be usable, or boot fails.

        Auto selection silently skips a vendor with no key, which is the right
        behaviour for a default. Naming one and leaving it keyless is a
        different thing: the operator asked for a safety net that would never
        fire, and would only find out during an outage.
        """
        fallback = self.stt_fallback_vendor
        if fallback is None:
            return self
        if fallback == self.stt_vendor:
            raise ValueError(
                f"STT_FALLBACK_VENDOR={fallback} must differ from "
                f"STT_VENDOR={self.stt_vendor}"
            )
        if not self.api_key_for(fallback):
            raise ValueError(
                f"{VENDOR_KEY_ENV[fallback]} is required when "
                f"STT_FALLBACK_VENDOR={fallback}"
            )
        return self
