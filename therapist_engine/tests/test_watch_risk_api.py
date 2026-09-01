"""Real pytest coverage for the Watch risk endpoint.

The previous coverage for this service was a run-by-hand script, which means
the endpoint the live app depends on had no automated safety net. These tests
exercise the actual FastAPI route with the actual serialised model.
"""
import pytest
from fastapi.testclient import TestClient

from api.main import app, _load_watch_model
import api.main as main_mod

client = TestClient(app)


def _model_available():
    _load_watch_model()
    return main_mod._WATCH_MODEL is not None


needs_model = pytest.mark.skipif(
    not _model_available(), reason="watch model artifact not present"
)


@needs_model
def test_calm_window_scores_low():
    # A window at the patient's own baseline (all z-scores ~0, no movement)
    # must not read as distress.
    r = client.post("/api/risk/watch", json={
        "heart_rate_mean": 0.0, "heart_rate_std": 0.2, "heart_rate_range": 0.3,
        "ibi_mean_seconds": 0.0, "sdnn_ms": 0.0, "rmssd_ms": 30.0,
        "acc_magnitude_mean": 0.0, "acc_magnitude_window_std": 0.0,
        "acc_magnitude_variability_mean": 0.0,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["risk_level"] in {"baseline", "elevated"}
    assert 0.0 <= body["risk_score"] <= 1.0


@needs_model
def test_stressed_window_scores_higher_than_calm():
    calm = client.post("/api/risk/watch", json={
        "heart_rate_mean": 0.0, "sdnn_ms": 0.0, "ibi_mean_seconds": 0.0,
        "acc_magnitude_mean": 0.0,
    }).json()["risk_score"]
    stressed = client.post("/api/risk/watch", json={
        # well above the personal baseline, suppressed HRV, shortened beats
        "heart_rate_mean": 2.5, "heart_rate_std": 1.5, "heart_rate_range": 2.0,
        "ibi_mean_seconds": -2.0, "sdnn_ms": -2.0, "rmssd_ms": 5.0,
        "acc_magnitude_mean": 0.1, "acc_magnitude_window_std": 0.1,
        "acc_magnitude_variability_mean": 0.1,
    }).json()["risk_score"]
    assert stressed > calm


@needs_model
def test_missing_features_are_imputed_not_rejected():
    # The phone often cannot supply every window feature; the endpoint accepts
    # partial input and still answers.
    r = client.post("/api/risk/watch", json={"heart_rate_mean": 1.0})
    assert r.status_code == 200
    assert "risk_score" in r.json()


@needs_model
def test_level_vocabulary_matches_engine():
    r = client.post("/api/risk/watch", json={"heart_rate_mean": 0.0}).json()
    assert r["risk_level"] in {"baseline", "elevated", "high", "critical"}


@needs_model
def test_reports_its_own_provenance():
    # The app names which engine produced every score; the endpoint must give
    # it a name and its honest evaluation context to display.
    r = client.post("/api/risk/watch", json={"heart_rate_mean": 0.0}).json()
    assert r["model"] == "wesad_watch_rf_v1"
    assert r.get("features_used")
