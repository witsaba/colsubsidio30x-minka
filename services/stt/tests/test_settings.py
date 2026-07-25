"""Boot-time configuration validation (REQ-VND-3, REQ-VND-5)."""

import pytest
from pydantic import ValidationError

from src.settings import Settings

ALL_SETTING_ENV_VARS = (
    "STT_VENDOR",
    "DEEPGRAM_API_KEY",
    "GROQ_API_KEY",
    "STT_LANGUAGE",
    "STT_MODEL",
    "STT_NUMERALS",
    "STT_MIP_OPT_OUT",
    "STT_CONFIDENCE_FLOOR",
    "STT_MIN_SPEECH_MS",
    "STT_MAX_UPLOAD_BYTES",
    "STT_VENDOR_TIMEOUT_S",
    "STT_TOTAL_DEADLINE_S",
    "STT_RETRY_ATTEMPTS",
    "STT_RETRY_BACKOFF_S",
    "STT_FALLBACK_ENABLED",
    "STT_FALLBACK_VENDOR",
    "ELEVENLABS_API_KEY",
    "STT_ELEVENLABS_MODEL",
    "LOG_LEVEL",
)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Isolate every test from the developer's shell and from any local .env."""
    for name in ALL_SETTING_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)


def test_missing_key_for_active_vendor_fails_boot(monkeypatch):
    monkeypatch.setenv("STT_VENDOR", "deepgram")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "DEEPGRAM_API_KEY" in str(excinfo.value)


def test_missing_key_for_active_groq_vendor_fails_boot(monkeypatch):
    monkeypatch.setenv("STT_VENDOR", "groq")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "GROQ_API_KEY" in str(excinfo.value)


def test_missing_key_for_non_selected_vendor_is_tolerated(monkeypatch):
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    settings = Settings()

    assert settings.stt_vendor == "deepgram"
    assert settings.groq_api_key is None
    assert settings.active_api_key == "dg-key"


def test_active_api_key_follows_the_vendor_switch(monkeypatch):
    monkeypatch.setenv("STT_VENDOR", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "gq-key")

    settings = Settings()

    assert settings.active_api_key == "gq-key"


def test_invalid_vendor_fails_boot(monkeypatch):
    monkeypatch.setenv("STT_VENDOR", "elevenlabs")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "elevenlabs" in str(excinfo.value)


def test_defaults(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    settings = Settings()

    assert settings.stt_vendor == "deepgram"
    assert settings.stt_min_speech_ms == 300
    assert settings.stt_max_upload_bytes == 1048576
    assert settings.stt_vendor_timeout_s == 30.0
    assert settings.log_level == "INFO"
    assert settings.stt_confidence_floor == 0.60
    assert settings.stt_language == "es"
    assert settings.stt_model == "nova-3"
    assert settings.stt_numerals is True
    assert settings.stt_mip_opt_out is True
    assert settings.stt_retry_attempts == 2
    assert settings.stt_retry_backoff_s == 0.5
    assert settings.stt_fallback_enabled is True
    assert settings.stt_total_deadline_s == 45.0


def test_resilience_settings_are_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_RETRY_ATTEMPTS", "4")
    monkeypatch.setenv("STT_RETRY_BACKOFF_S", "0.25")
    monkeypatch.setenv("STT_FALLBACK_ENABLED", "false")
    monkeypatch.setenv("STT_TOTAL_DEADLINE_S", "12.5")

    settings = Settings()

    assert settings.stt_retry_attempts == 4
    assert settings.stt_retry_backoff_s == 0.25
    assert settings.stt_fallback_enabled is False
    assert settings.stt_total_deadline_s == 12.5


@pytest.mark.parametrize("value", ["0", "-1"])
def test_a_non_positive_total_deadline_is_rejected(monkeypatch, value):
    """A zero budget would time every request out before it started."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_TOTAL_DEADLINE_S", value)

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "stt_total_deadline_s" in str(excinfo.value).lower()


def test_a_retry_budget_below_one_is_rejected(monkeypatch):
    """One attempt means "no retry"; zero would mean "never call the vendor"."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_RETRY_ATTEMPTS", "0")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "stt_retry_attempts" in str(excinfo.value).lower()


def test_the_fallback_vendor_is_unset_by_default(monkeypatch):
    """Unset means auto: pick by priority from whatever keys are configured."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")

    assert Settings().stt_fallback_vendor is None
    assert Settings().stt_elevenlabs_model == "scribe_v1"


def test_an_empty_fallback_vendor_reads_as_unset(monkeypatch):
    """`STT_FALLBACK_VENDOR: ${STT_FALLBACK_VENDOR:-}` sends an empty string."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_FALLBACK_VENDOR", "")

    assert Settings().stt_fallback_vendor is None


def test_an_explicit_fallback_vendor_is_accepted(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-key")
    monkeypatch.setenv("STT_FALLBACK_VENDOR", "elevenlabs")

    assert Settings().stt_fallback_vendor == "elevenlabs"


def test_a_fallback_equal_to_the_primary_fails_boot(monkeypatch):
    """Failing over to the vendor that just failed is not a fallback."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_FALLBACK_VENDOR", "deepgram")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "STT_FALLBACK_VENDOR" in str(excinfo.value)


def test_an_explicit_fallback_without_its_key_fails_boot(monkeypatch):
    """Configuring an unusable fallback is a misconfiguration, not a default."""
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_FALLBACK_VENDOR", "elevenlabs")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "ELEVENLABS_API_KEY" in str(excinfo.value)


def test_an_unknown_fallback_vendor_fails_boot(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_FALLBACK_VENDOR", "whisper-cpp")

    with pytest.raises(ValidationError) as excinfo:
        Settings()

    assert "whisper-cpp" in str(excinfo.value)


def test_api_key_for_resolves_each_vendors_own_key(monkeypatch):
    """Failover calls the non-active vendor, so the key cannot follow the switch."""
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("GROQ_API_KEY", "gq-key")

    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-key")

    settings = Settings()

    assert settings.api_key_for("deepgram") == "dg-key"
    assert settings.api_key_for("groq") == "gq-key"
    assert settings.api_key_for("elevenlabs") == "el-key"


def test_overrides_are_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_MIN_SPEECH_MS", "500")
    monkeypatch.setenv("STT_MAX_UPLOAD_BYTES", "2048")
    monkeypatch.setenv("STT_VENDOR_TIMEOUT_S", "5")
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("STT_CONFIDENCE_FLOOR", "0.8")

    settings = Settings()

    assert settings.stt_min_speech_ms == 500
    assert settings.stt_max_upload_bytes == 2048
    assert settings.stt_vendor_timeout_s == 5.0
    assert settings.log_level == "DEBUG"
    assert settings.stt_confidence_floor == 0.8
