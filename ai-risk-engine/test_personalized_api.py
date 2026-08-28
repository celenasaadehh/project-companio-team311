"""
End-to-end smoke test for the personalized Companio API.

This uses S2 only as a FUNCTIONALITY TEST:
- 10 known WESAD-baseline windows calibrate demo_s2.
- One later baseline window is tested.
- One WESAD-stress window is tested.

Do not report these scores as unseen-person evaluation because
the final personalized model was trained on S2, S3, and S4.
"""

from pathlib import Path

import pandas as pd
import requests


SYNC_FILE = Path(
    "data/processed/S2_synchronized_1_second.csv"
)

FEATURE_DATA_FILE = Path(
    "data/processed/wesad_3subjects_features.csv"
)

BASE_URL = "http://127.0.0.1:8000"

USER_ID = "demo_s2"
WINDOW_SECONDS = 30

# Verified alignment between the raw S2 synchronized CSV and S2.pkl.
S2_EXPERIMENT_OFFSET_SECONDS = 1535


def load_data():
    if not SYNC_FILE.exists():
        raise FileNotFoundError(
            f"Could not find {SYNC_FILE}. "
            "If it only exists in your backup, copy it into "
            "data/processed/ for this local test."
        )

    if not FEATURE_DATA_FILE.exists():
        raise FileNotFoundError(
            f"Could not find {FEATURE_DATA_FILE}."
        )

    synchronized = pd.read_csv(
        SYNC_FILE
    )

    features = pd.read_csv(
        FEATURE_DATA_FILE
    )

    s2 = (
        features[
            features["subject"] == "S2"
        ]
        .sort_values(
            "window_start_s"
        )
        .reset_index(drop=True)
    )

    return synchronized, s2


def make_payload_window(
    synchronized,
    wesad_start_seconds,
):
    raw_start = (
        int(wesad_start_seconds)
        + S2_EXPERIMENT_OFFSET_SECONDS
    )

    raw_end = (
        raw_start
        + WINDOW_SECONDS
    )

    window = synchronized[
        (
            synchronized[
                "relative_second"
            ] >= raw_start
        )
        & (
            synchronized[
                "relative_second"
            ] < raw_end
        )
    ].copy()

    if len(window) != WINDOW_SECONDS:
        raise ValueError(
            f"Expected {WINDOW_SECONDS} rows "
            f"for window starting at {wesad_start_seconds}, "
            f"found {len(window)}."
        )

    return {
        "heart_rate":
            window[
                "heart_rate"
            ].tolist(),
        "eda":
            window[
                "eda"
            ].tolist(),
        "temperature":
            window[
                "temperature"
            ].tolist(),
        "acc_magnitude_mean":
            window[
                "acc_magnitude_mean"
            ].tolist(),
        "acc_magnitude_std":
            window[
                "acc_magnitude_std"
            ].tolist(),
        "ibi_mean_seconds": [
            None
            if pd.isna(value)
            else float(value)
            for value in window[
                "ibi_mean_seconds"
            ]
        ],
    }


def main():
    synchronized, s2 = load_data()

    baseline_rows = s2[
        s2["target_stress"] == 0
    ]

    stress_rows = s2[
        s2["target_stress"] == 1
    ]

    calibration_rows = (
        baseline_rows
        .head(10)
    )

    calibration_windows = [
        make_payload_window(
            synchronized,
            row["window_start_s"],
        )
        for _, row
        in calibration_rows.iterrows()
    ]

    calibration_response = (
        requests.post(
            f"{BASE_URL}/calibrate",
            json={
                "user_id": USER_ID,
                "windows":
                    calibration_windows,
            },
            timeout=30,
        )
    )

    print(
        "\nCALIBRATION HTTP:",
        calibration_response.status_code,
    )
    print(
        calibration_response.json()
    )

    calibration_used_starts = set(
        calibration_rows[
            "window_start_s"
        ].tolist()
    )

    later_baselines = (
        baseline_rows[
            ~baseline_rows[
                "window_start_s"
            ].isin(
                calibration_used_starts
            )
        ]
    )

    baseline_test_row = (
        later_baselines.iloc[0]
    )

    stress_test_row = (
        stress_rows.iloc[
            len(stress_rows) // 2
        ]
    )

    tests = [
        (
            "KNOWN BASELINE WINDOW",
            baseline_test_row,
        ),
        (
            "KNOWN STRESS WINDOW",
            stress_test_row,
        ),
    ]

    for title, row in tests:
        payload_window = (
            make_payload_window(
                synchronized,
                row[
                    "window_start_s"
                ],
            )
        )

        response = requests.post(
            f"{BASE_URL}/predict-distress",
            json={
                "user_id": USER_ID,
                "window":
                    payload_window,
            },
            timeout=30,
        )

        print(
            f"\n{title}"
        )
        print("-" * 60)
        print(
            "HTTP:",
            response.status_code,
        )
        print(
            response.json()
        )


if __name__ == "__main__":
    main()
