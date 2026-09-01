"""
Test the live Companio FastAPI risk-engine endpoint using
30 seconds of real synchronized S2 sensor data.
"""

from pathlib import Path

import pandas as pd
import requests


SYNC_FILE = Path(
    "data/processed/S2_synchronized_1_second.csv"
)

API_URL = "http://127.0.0.1:8000/predict-distress"
WINDOW_SECONDS = 30


def main():
    if not SYNC_FILE.exists():
        raise FileNotFoundError(
            f"Could not find {SYNC_FILE}"
        )

    df = pd.read_csv(SYNC_FILE)

    if "regular_signals_complete" in df.columns:
        mask = (
            df["regular_signals_complete"]
            .astype(str)
            .str.lower()
            .map({"true": True, "false": False})
            .fillna(False)
        )
        df = df[mask].reset_index(drop=True)

    if len(df) < WINDOW_SECONDS:
        raise ValueError(
            f"Need at least {WINDOW_SECONDS} complete seconds."
        )

    window = df.iloc[:WINDOW_SECONDS].copy()

    payload = {
        "heart_rate":
            window["heart_rate"].tolist(),
        "eda":
            window["eda"].tolist(),
        "temperature":
            window["temperature"].tolist(),
        "acc_magnitude_mean":
            window["acc_magnitude_mean"].tolist(),
        "acc_magnitude_std":
            window["acc_magnitude_std"].tolist(),
        "ibi_mean_seconds":
            [
                None if pd.isna(value) else float(value)
                for value in window["ibi_mean_seconds"]
            ],
    }

    response = requests.post(
        API_URL,
        json=payload,
        timeout=30,
    )

    print("\nHTTP status:", response.status_code)

    if response.ok:
        result = response.json()

        print("\nCOMPANIO API TEST")
        print("-" * 60)
        print(
            "Distress score:",
            result["physiological_distress_score"],
        )
        print(
            "Pattern:",
            result["model_pattern"],
        )
        print(
            "Support level:",
            result["support_level"],
        )
        print(
            "Action:",
            result["action"],
        )
    else:
        print(response.text)


if __name__ == "__main__":
    main()
