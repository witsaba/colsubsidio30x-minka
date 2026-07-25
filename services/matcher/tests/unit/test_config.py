"""T5 RED — pydantic-settings configuration (REQ-ENG-4, REQ-API-4).

Defaults are the design's Configuration table; every knob is overridable from
the environment without a rebuild, and an invalid value must raise at
construction time (startup) rather than silently falling back to the default.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from matcher.config import Settings


def _clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "CATALOGUE_DB",
        "MATCH_ACCEPT_SCORE",
        "MATCH_AMBIGUITY_MARGIN",
        "MATCH_TSR_MARGIN",
        "MATCH_MAX_CANDIDATES",
        "MATCH_UNIT_RERANK",
    ):
        monkeypatch.delenv(name, raising=False)


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

    def test_catalogue_db_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        assert Settings().catalogue_db == Path("data/bodegas-y-stock.sqlite")

    def test_exactly_five_match_knobs_plus_catalogue_db(self) -> None:
        assert set(Settings.model_fields) == {
            "catalogue_db",
            "match_accept_score",
            "match_ambiguity_margin",
            "match_tsr_margin",
            "match_max_candidates",
            "match_unit_rerank",
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

    def test_catalogue_db_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("CATALOGUE_DB", "/data/bodegas-y-stock.sqlite")
        assert Settings().catalogue_db == Path("/data/bodegas-y-stock.sqlite")

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

    def test_unknown_env_var_is_ignored(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _clear_env(monkeypatch)
        monkeypatch.setenv("MATCH_SOMETHING_ELSE", "1")
        assert Settings().match_accept_score == 0.50
