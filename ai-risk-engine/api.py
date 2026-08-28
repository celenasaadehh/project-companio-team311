"""
Personalized FastAPI service for the Companio physiological distress engine.

Flow:
1. POST /calibrate
   - Send at least 10 calm 30-second sensor windows for one user.
   - The API extracts the same 16 features used during training.
   - It saves that user's personal baseline mean/std for each feature.

2. POST /predict-distress
   - Send one new 30-second sensor window for that user.
   - The API converts the current features into change-from-personal-baseline values.
   - The personalized Random Forest returns a physiological distress score.

IMPORTANT:
- This is a proof-of-concept physiological stress/distress model.
- It does NOT diagnose PTSD.
- The score is NOT the probability of a PTSD attack.
"""

from pathlib import Path
import json
import math

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.features import extract_window_features


MODEL_FILE = Path(
    "models/wesad_stress_model_personalized.joblib"
)

BASELINE_FILE = Path(
    "data/user_baselines.json"
)

WINDOW_SECONDS = 30
MIN_CALIBRATION_WINDOWS = 10


app = FastAPI(
    title="Companio Personalized Risk Engine",
    version="0.2.0",
)


if not MODEL_FILE.exists():
    raise RuntimeError(
        f"Could not find personalized model: {MODEL_FILE}. "
        "Run python train_model_personalized.py first."
    )


saved = joblib.load(MODEL_FILE)

model = saved["model"]
feature_columns = saved["feature_columns"]
detection_threshold = float(
    saved["detection_threshold"]
)


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
        description=(
            "30 one-second IBI summaries; null is allowed "
            "when no beat event occurred"
        )
    )


class CalibrationRequest(BaseModel):
    user_id: str
    windows: list[SensorWindow]


class PredictionRequest(BaseModel):
    user_id: str
    window: SensorWindow


def load_baselines() -> dict:
    if not BASELINE_FILE.exists():
        return {}

    with open(
        BASELINE_FILE,
        "r",
        encoding="utf-8",
    ) as file:
        return json.load(file)


def save_baselines(
    baselines: dict,
) -> None:
    BASELINE_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with open(
        BASELINE_FILE,
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            baselines,
            file,
            indent=2,
        )


def sensor_window_to_dataframe(
    window: SensorWindow,
) -> pd.DataFrame:
    values = {
        "heart_rate":
            window.heart_rate,
        "eda":
            window.eda,
        "temperature":
            window.temperature,
        "acc_magnitude_mean":
            window.acc_magnitude_mean,
        "acc_magnitude_std":
            window.acc_magnitude_std,
        "ibi_mean_seconds":
            window.ibi_mean_seconds,
    }

    lengths = {
        name: len(series)
        for name, series in values.items()
    }

    if any(
        length != WINDOW_SECONDS
        for length in lengths.values()
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Every signal must contain exactly "
                f"{WINDOW_SECONDS} one-second values. "
                f"Received lengths: {lengths}"
            ),
        )

    return pd.DataFrame(values)


def extract_feature_row(
    window: SensorWindow,
) -> pd.Series:
    synchronized_window = (
        sensor_window_to_dataframe(
            window
        )
    )

    feature_dict = (
        extract_window_features(
            synchronized_window
        )
    )

    return pd.Series(
        feature_dict,
        index=feature_columns,
        dtype=float,
    )


def support_level(
    score: float,
) -> str:
    """
    Product support bands.

    The model's learned operating threshold is used as the point
    at which the pattern becomes stress-like.

    The elevated/high split is still a prototype product choice.
    """
    high_threshold = min(
        detection_threshold + 0.25,
        0.95,
    )

    if score < detection_threshold:
        return "low"

    if score < high_threshold:
        return "elevated"

    return "high"


@app.get("/health")
def health():
    baselines = load_baselines()

    return {
        "status": "ok",
        "personalized_model_loaded": True,
        "detection_threshold": round(
            detection_threshold,
            4,
        ),
        "calibrated_users": len(
            baselines
        ),
    }


@app.post("/calibrate")
def calibrate(
    request: CalibrationRequest,
):
    if not request.user_id.strip():
        raise HTTPException(
            status_code=400,
            detail="user_id cannot be empty.",
        )

    if (
        len(request.windows)
        < MIN_CALIBRATION_WINDOWS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Calibration requires at least "
                f"{MIN_CALIBRATION_WINDOWS} calm "
                f"30-second windows."
            ),
        )

    feature_rows = [
        extract_feature_row(window)
        for window in request.windows
    ]

    feature_table = pd.DataFrame(
        feature_rows,
        columns=feature_columns,
    )

    means = feature_table.mean()
    stds = feature_table.std(ddof=1)

    mean_dict = {}
    std_dict = {}

    for feature in feature_columns:
        mean_value = float(
            means[feature]
        )

        std_value = float(
            stds[feature]
        )

        mean_dict[feature] = (
            mean_value
            if math.isfinite(mean_value)
            else None
        )

        std_dict[feature] = (
            std_value
            if (
                math.isfinite(std_value)
                and std_value > 0
            )
            else None
        )

    baselines = load_baselines()

    baselines[request.user_id] = {
        "feature_mean": mean_dict,
        "feature_std": std_dict,
        "calibration_windows":
            len(request.windows),
    }

    save_baselines(
        baselines
    )

    return {
        "status": "calibrated",
        "user_id": request.user_id,
        "calibration_windows":
            len(request.windows),
        "message": (
            "Personal calm baseline saved. "
            "Future predictions for this user "
            "will be normalized relative to it."
        ),
    }


@app.post("/predict-distress")
def predict_distress(
    request: PredictionRequest,
):
    baselines = load_baselines()

    if request.user_id not in baselines:
        raise HTTPException(
            status_code=400,
            detail=(
                f"No personal baseline found for "
                f"user '{request.user_id}'. "
                f"Call /calibrate first."
            ),
        )

    current = extract_feature_row(
        request.window
    )

    profile = baselines[
        request.user_id
    ]

    normalized = {}

    for feature in feature_columns:
        value = float(
            current[feature]
        )

        mean_value = profile[
            "feature_mean"
        ].get(feature)

        std_value = profile[
            "feature_std"
        ].get(feature)

        if (
            mean_value is None
            or std_value is None
            or not math.isfinite(value)
        ):
            normalized[feature] = np.nan
        else:
            normalized[feature] = (
                value - mean_value
            ) / std_value

    X = pd.DataFrame(
        [normalized],
        columns=feature_columns,
    )

    distress_score = float(
        model.predict_proba(X)[0, 1]
    )

    model_pattern = (
        "stress-like"
        if distress_score
        >= detection_threshold
        else "baseline-like"
    )

    level = support_level(
        distress_score
    )

    if level == "low":
        action = "no_grounding_prompt"
    elif level == "elevated":
        action = "offer_grounding"
    else:
        action = (
            "prominent_grounding_offer"
        )

    return {
        "user_id": request.user_id,
        "physiological_distress_score":
            round(
                distress_score,
                4,
            ),
        "model_pattern":
            model_pattern,
        "support_level":
            level,
        "action":
            action,
        "detection_threshold":
            round(
                detection_threshold,
                4,
            ),
        "personalized":
            True,
        "note": (
            "WESAD-based physiological distress "
            "proof of concept. This is not a PTSD "
            "diagnosis or PTSD-attack probability."
        ),
    }
