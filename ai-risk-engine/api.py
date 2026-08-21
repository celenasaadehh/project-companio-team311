"""
FastAPI service for the Companio proof-of-concept physiological distress engine.

The endpoint accepts one 30-second synchronized sensor window,
extracts the exact same features used during training,
and returns a physiological distress score plus a support level.

This is NOT a PTSD diagnosis or PTSD-attack probability.
"""

from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.features import extract_window_features


MODEL_FILE = Path("models/wesad_stress_model.joblib")
WINDOW_SECONDS = 30

app = FastAPI(
    title="Companio Risk Engine",
    version="0.1.0",
)

if not MODEL_FILE.exists():
    raise RuntimeError(
        f"Could not find trained model: {MODEL_FILE}"
    )

saved = joblib.load(MODEL_FILE)
model = saved["model"]
feature_columns = saved["feature_columns"]


class SensorWindow(BaseModel):
    heart_rate: list[float] = Field(
        description="30 one-second heart-rate values"
    )
    eda: list[float] = Field(
        description="30 one-second EDA values"
    )
    temperature: list[float] = Field(
        description="30 one-second skin-temperature values"
    )
    acc_magnitude_mean: list[float] = Field(
        description="30 one-second mean acceleration-magnitude values"
    )
    acc_magnitude_std: list[float] = Field(
        description="30 one-second acceleration-variability values"
    )
    ibi_mean_seconds: list[float | None] = Field(
        description="30 one-second IBI summaries; null is allowed when no beat event was recorded"
    )


def get_support_level(score: float) -> str:
    # Prototype product thresholds only; not clinical cutoffs.
    if score < 0.40:
        return "low"
    if score < 0.70:
        return "elevated"
    return "high"


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": True,
    }


@app.post("/predict-distress")
def predict_distress(window: SensorWindow):
    values = {
        "heart_rate": window.heart_rate,
        "eda": window.eda,
        "temperature": window.temperature,
        "acc_magnitude_mean": window.acc_magnitude_mean,
        "acc_magnitude_std": window.acc_magnitude_std,
        "ibi_mean_seconds": window.ibi_mean_seconds,
    }

    lengths = {
        name: len(series)
        for name, series in values.items()
    }

    if any(length != WINDOW_SECONDS for length in lengths.values()):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Every signal must contain exactly "
                f"{WINDOW_SECONDS} one-second values. "
                f"Received lengths: {lengths}"
            ),
        )

    synchronized_window = pd.DataFrame(values)

    feature_dict = extract_window_features(
        synchronized_window
    )

    X = pd.DataFrame(
        [feature_dict],
        columns=feature_columns,
    )

    distress_score = float(
        model.predict_proba(X)[0, 1]
    )

    model_pattern = (
        "stress-like"
        if int(model.predict(X)[0]) == 1
        else "baseline-like"
    )

    support_level = get_support_level(
        distress_score
    )

    if support_level == "low":
        action = "no_grounding_prompt"
    elif support_level == "elevated":
        action = "offer_grounding"
    else:
        action = "prominent_grounding_offer"

    return {
        "physiological_distress_score": round(
            distress_score,
            4,
        ),
        "model_pattern": model_pattern,
        "support_level": support_level,
        "action": action,
        "note": (
            "WESAD-based physiological stress/distress "
            "proof of concept; not a PTSD diagnosis "
            "or PTSD-attack probability."
        ),
    }
