"""T5 RED — pydantic-settings configuration (REQ-ENG-4, REQ-API-4).

Defaults are the design's Configuration table; every knob is overridable from
the environment without a rebuild, and an invalid value must raise at
construction time (startup) rather than silently falling back to the default.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from matcher.config import Settings

SUPABASE_URL = "https://project.supabase.co"
SUPABASE_KEY = "test-key"


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Drop every matcher variable, then supply only the two required ones.

    `SUPABASE_URL`/`SUPABASE_KEY` have no default by design (D6): a missing
    credential is a permanent misconfiguration, so every other test has to
    provide them explicitly to isolate the knob it is actually asserting.
    """
    for name in (
        "CATALOGUE_DB",
        "SUPABASE_URL",
        "SUPABASE_KEY",
        "SUPABASE_TIMEOUT_SECONDS",
        "REDIS_URL",
        "CATALOGUE_CACHE_TTL_SECONDS",
        "CATALOGUE_REFRESH_LOCK_TTL_SECONDS",
        "MATCH_ACCEPT_SCORE",
        "MATCH_AMBIGUITY_MARGIN",
        "MATCH_TSR_MARGIN",
        "MATCH_MAX_CANDIDATES",
        "MATCH_UNIT_RERANK",
        "STARTUP_RETRIES",
        "STARTUP_RETRY_DELAY_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_KEY", SUPABASE_KEY)


class TestDefaults:
    def test_accept_score_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().match_accept_score == 0.50

    def test_ambiguity_margin_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().match_ambiguity_margin == 0.08

    def test_tsr_margin_default_is_independent_knob(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        settings = Settings()
        assert settings.match_tsr_margin == 0.08
        # Independent field, not an alias of the trigram margin (REQ-ENG-3).
        assert "match_tsr_margin" in Settings.model_fields
        assert (
            Settings.model_fields["match_tsr_margin"]
            is not Settings.model_fields["match_ambiguity_margin"]
        )

    def test_max_candidates_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().match_max_candidates == 5

    def test_unit_rerank_default_is_true(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().match_unit_rerank is True

    def test_the_supabase_and_redis_settings_carry_their_documented_defaults(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        settings = Settings()

        assert settings.redis_url == "redis://localhost:6379/0"
        assert settings.supabase_timeout_seconds == 10.0
        assert settings.catalogue_cache_ttl_seconds == 10800
        assert settings.catalogue_refresh_lock_ttl_seconds == 60

    def test_catalogue_db_no_longer_exists(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """REQ-CSS-1: the SQLite catalogue is gone, not merely unused."""
        _clear_env(monkeypatch)
        settings = Settings()

        assert not hasattr(settings, "catalogue_db")
        assert "catalogue_db" not in Settings.model_fields

    def test_a_trailing_slash_on_the_supabase_url_is_normalized_away(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Every request path is joined onto this value; a stray slash would
        produce `//rest/v1/...`, which PostgREST does not route."""
        _clear_env(monkeypatch)
        monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co/")

        assert Settings().supabase_url == "https://project.supabase.co"

    def test_a_url_without_a_trailing_slash_is_left_alone(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)

        assert Settings().supabase_url == SUPABASE_URL

    def test_startup_retries_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().startup_retries == 3

    def test_startup_retry_delay_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        assert Settings().startup_retry_delay_seconds == 2.0

    def test_exactly_the_supabase_redis_match_and_startup_knobs(
        self,
    ) -> None:
        assert set(Settings.model_fields) == {
            "supabase_url",
            "supabase_key",
            "supabase_timeout_seconds",
            "redis_url",
            "catalogue_cache_ttl_seconds",
            "catalogue_refresh_lock_ttl_seconds",
            "match_accept_score",
            "match_ambiguity_margin",
            "match_tsr_margin",
            "match_max_candidates",
            "match_unit_rerank",
            "startup_retries",
            "startup_retry_delay_seconds",
        }


class TestEnvOverride:
    def test_accept_score_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "0.60")
        assert Settings().match_accept_score == 0.60

    def test_tsr_margin_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_TSR_MARGIN", "0.25")
        assert Settings().match_tsr_margin == 0.25

    def test_unit_rerank_false_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_UNIT_RERANK", "false")
        assert Settings().match_unit_rerank is False

    def test_max_candidates_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_MAX_CANDIDATES", "3")
        assert Settings().match_max_candidates == 3

    def test_startup_retries_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRIES", "7")
        assert Settings().startup_retries == 7

    def test_startup_retry_delay_from_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "0.5")
        assert Settings().startup_retry_delay_seconds == 0.5

    def test_redis_url_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
        assert Settings().redis_url == "redis://redis:6379/0"

    def test_cache_ttl_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("CATALOGUE_CACHE_TTL_SECONDS", "600")
        assert Settings().catalogue_cache_ttl_seconds == 600

    def test_supabase_timeout_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("SUPABASE_TIMEOUT_SECONDS", "2.5")
        assert Settings().supabase_timeout_seconds == 2.5

    def test_env_names_are_case_insensitive(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("match_accept_score", "0.70")
        assert Settings().match_accept_score == 0.70

    def test_constructor_argument_overrides_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "0.60")
        assert Settings(match_accept_score=0.90).match_accept_score == 0.90


class TestInvalidValuesFailFast:
    def test_a_missing_supabase_url_is_a_validation_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """REQ-API-4: a missing credential is permanent and never retried."""
        _clear_env(monkeypatch)
        monkeypatch.delenv("SUPABASE_URL", raising=False)

        with pytest.raises(ValidationError):
            Settings()

    def test_a_missing_supabase_key_is_a_validation_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.delenv("SUPABASE_KEY", raising=False)

        with pytest.raises(ValidationError):
            Settings()

    def test_a_blank_supabase_url_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Compose interpolates `${SUPABASE_URL:-}`, so blank is the shape an
        unset variable actually arrives in."""
        _clear_env(monkeypatch)
        monkeypatch.setenv("SUPABASE_URL", "")

        with pytest.raises(ValidationError):
            Settings()

    def test_a_blank_supabase_key_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("SUPABASE_KEY", "   ")

        with pytest.raises(ValidationError):
            Settings()

    def test_a_ttl_below_sixty_seconds_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A tiny TTL turns the cache into a per-minute Supabase hammer."""
        _clear_env(monkeypatch)
        monkeypatch.setenv("CATALOGUE_CACHE_TTL_SECONDS", "59")

        with pytest.raises(ValidationError):
            Settings()

    def test_a_sixty_second_ttl_is_allowed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("CATALOGUE_CACHE_TTL_SECONDS", "60")

        assert Settings().catalogue_cache_ttl_seconds == 60

    def test_a_zero_supabase_timeout_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("SUPABASE_TIMEOUT_SECONDS", "0")

        with pytest.raises(ValidationError):
            Settings()

    def test_a_zero_refresh_lock_ttl_is_rejected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("CATALOGUE_REFRESH_LOCK_TTL_SECONDS", "0")

        with pytest.raises(ValidationError):
            Settings()

    def test_non_numeric_accept_score_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "not-a-number")
        with pytest.raises(ValidationError):
            Settings()

    def test_non_numeric_accept_score_does_not_silently_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "not-a-number")
        try:
            Settings()
        except ValidationError:
            pass
        else:  # pragma: no cover - guarded by the test above
            pytest.fail("invalid MATCH_ACCEPT_SCORE silently accepted")

    def test_non_integer_max_candidates_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_MAX_CANDIDATES", "many")
        with pytest.raises(ValidationError):
            Settings()

    def test_non_boolean_unit_rerank_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_UNIT_RERANK", "maybe")
        with pytest.raises(ValidationError):
            Settings()

    def test_out_of_range_accept_score_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "1.5")
        with pytest.raises(ValidationError):
            Settings()

    def test_zero_max_candidates_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_MAX_CANDIDATES", "0")
        with pytest.raises(ValidationError):
            Settings()

    def test_negative_startup_retries_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRIES", "-1")
        with pytest.raises(ValidationError):
            Settings()

    def test_zero_startup_retries_is_allowed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Opting out of in-process retry is legitimate; Docker retries too."""
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRIES", "0")
        assert Settings().startup_retries == 0

    def test_negative_startup_retry_delay_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "-0.5")
        with pytest.raises(ValidationError):
            Settings()

    def test_non_numeric_startup_retries_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("STARTUP_RETRIES", "many")
        with pytest.raises(ValidationError):
            Settings()

    def test_unknown_env_var_is_ignored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_SOMETHING_ELSE", "1")
        assert Settings().match_accept_score == 0.50
