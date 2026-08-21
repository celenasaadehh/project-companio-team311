"""
Window-level feature extraction for Companio.

Input:
    A 1-second synchronized DataFrame produced by
    src.preprocess.create_synchronized_table().

Output:
    The exact same physiological features used by the trained model.
"""

import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "heart_rate_mean",
    "heart_rate_std",
    "heart_rate_range",
    "eda_mean",
    "eda_std",
    "eda_range",
    "eda_slope_per_s",
    "temp_mean_c",
    "temp_std_c",
    "temp_slope_c_per_s",
    "acc_magnitude_mean",
    "acc_magnitude_window_std",
    "acc_magnitude_variability_mean",
    "ibi_mean_seconds",
    "sdnn_ms",
    "rmssd_ms",
]


def _safe_std(values):
    values = pd.to_numeric(
        pd.Series(values),
        errors="coerce",
    ).dropna()

    if len(values) < 2:
        return np.nan

    return float(values.std(ddof=1))


def _safe_range(values):
    values = pd.to_numeric(
        pd.Series(values),
        errors="coerce",
    ).dropna()

    if values.empty:
        return np.nan

    return float(values.max() - values.min())


def _slope_per_second(values):
    values = pd.to_numeric(
        pd.Series(values),
        errors="coerce",
    )

    valid = values.notna().to_numpy()

    if valid.sum() < 2:
        return np.nan

    x = np.arange(len(values), dtype=float)[valid]
    y = values.to_numpy(dtype=float)[valid]

    return float(
        np.polyfit(
            x,
            y,
            1,
        )[0]
    )


def extract_window_features(
    window: pd.DataFrame,
) -> dict:
    """
    Extract model features from one synchronized time window.

    A 30-second window is recommended because that is what the
    current proof-of-concept model was trained on.
    """

    required = [
        "heart_rate",
        "eda",
        "temperature",
        "acc_magnitude_mean",
        "acc_magnitude_std",
        "ibi_mean_seconds",
    ]

    missing = [
        column
        for column in required
        if column not in window.columns
    ]

    if missing:
        raise ValueError(
            f"Window is missing columns: {missing}"
        )

    hr = pd.to_numeric(
        window["heart_rate"],
        errors="coerce",
    )

    eda = pd.to_numeric(
        window["eda"],
        errors="coerce",
    )

    temp = pd.to_numeric(
        window["temperature"],
        errors="coerce",
    )

    acc_mean = pd.to_numeric(
        window["acc_magnitude_mean"],
        errors="coerce",
    )

    acc_variability = pd.to_numeric(
        window["acc_magnitude_std"],
        errors="coerce",
    )

    ibi = pd.to_numeric(
        window["ibi_mean_seconds"],
        errors="coerce",
    ).dropna()

    if len(ibi) >= 2:
        sdnn_ms = float(
            ibi.std(ddof=1) * 1000.0
        )

        differences = np.diff(
            ibi.to_numpy(dtype=float)
        )

        rmssd_ms = float(
            np.sqrt(
                np.mean(
                    differences ** 2
                )
            )
            * 1000.0
        )
    else:
        sdnn_ms = np.nan
        rmssd_ms = np.nan

    result = {
        "heart_rate_mean": float(hr.mean()),
        "heart_rate_std": _safe_std(hr),
        "heart_rate_range": _safe_range(hr),

        "eda_mean": float(eda.mean()),
        "eda_std": _safe_std(eda),
        "eda_range": _safe_range(eda),
        "eda_slope_per_s": _slope_per_second(eda),

        "temp_mean_c": float(temp.mean()),
        "temp_std_c": _safe_std(temp),
        "temp_slope_c_per_s": _slope_per_second(temp),

        "acc_magnitude_mean": float(
            acc_mean.mean()
        ),
        "acc_magnitude_window_std": (
            _safe_std(acc_mean)
        ),
        "acc_magnitude_variability_mean": float(
            acc_variability.mean()
        ),

        "ibi_mean_seconds": (
            float(ibi.mean())
            if len(ibi) > 0
            else np.nan
        ),
        "sdnn_ms": sdnn_ms,
        "rmssd_ms": rmssd_ms,
    }

    return result
