"""
Train the Companio proof-of-concept physiological stress model.

This version matches the signals used by the current Companio pipeline:
HR, EDA, TEMP, ACC, and IBI/HRV.

WESAD laboratory stress is used as a physiological-stress proxy.
This is NOT a clinically validated PTSD detector.
"""

from pathlib import Path

import joblib
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import Pipeline

from src.features import FEATURE_COLUMNS


DATA_FILE = Path(
    "data/processed/wesad_3subjects_features.csv"
)

MODEL_FOLDER = Path("models")
MODEL_FILE = MODEL_FOLDER / "wesad_stress_model.joblib"
RESULTS_FILE = (
    MODEL_FOLDER
    / "leave_one_subject_out_results.csv"
)
IMPORTANCE_FILE = (
    MODEL_FOLDER
    / "feature_importance.csv"
)


def build_model():
    return Pipeline(
        steps=[
            (
                "imputer",
                SimpleImputer(
                    strategy="median"
                ),
            ),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=500,
                    max_depth=6,
                    min_samples_leaf=3,
                    class_weight="balanced",
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def main():
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Could not find {DATA_FILE}"
        )

    df = pd.read_csv(DATA_FILE)

    required_columns = {
        "subject",
        "window_start_s",
        "target_stress",
        *FEATURE_COLUMNS,
    }

    missing = (
        required_columns
        - set(df.columns)
    )

    if missing:
        raise ValueError(
            "Dataset is missing columns: "
            f"{sorted(missing)}"
        )

    X = df[FEATURE_COLUMNS]
    y = df["target_stress"]
    groups = df["subject"]

    print("\nDATASET")
    print("-" * 60)
    print("Rows:", len(df))
    print(
        "Subjects:",
        sorted(
            df["subject"].unique()
        ),
    )
    print(
        "Number of features:",
        len(FEATURE_COLUMNS),
    )

    print("\nClass counts:")
    print(
        df["target_stress"]
        .map(
            {
                0: "baseline",
                1: "stress",
            }
        )
        .value_counts()
    )

    logo = LeaveOneGroupOut()
    results = []

    print(
        "\nLEAVE-ONE-SUBJECT-OUT "
        "EVALUATION"
    )
    print("-" * 60)

    for train_index, test_index in logo.split(
        X,
        y,
        groups,
    ):
        model = build_model()

        train_subjects = sorted(
            groups.iloc[
                train_index
            ].unique()
        )

        test_subject = (
            groups.iloc[
                test_index
            ].iloc[0]
        )

        model.fit(
            X.iloc[train_index],
            y.iloc[train_index],
        )

        predictions = model.predict(
            X.iloc[test_index]
        )

        probabilities = (
            model.predict_proba(
                X.iloc[test_index]
            )[:, 1]
        )

        actual = y.iloc[test_index]

        result = {
            "test_subject": test_subject,
            "accuracy": accuracy_score(
                actual,
                predictions,
            ),
            "balanced_accuracy":
                balanced_accuracy_score(
                    actual,
                    predictions,
                ),
            "precision": precision_score(
                actual,
                predictions,
                zero_division=0,
            ),
            "recall": recall_score(
                actual,
                predictions,
                zero_division=0,
            ),
            "f1": f1_score(
                actual,
                predictions,
                zero_division=0,
            ),
            "roc_auc": roc_auc_score(
                actual,
                probabilities,
            ),
        }

        results.append(result)

        print(
            f"Train {train_subjects} "
            f"-> Test {test_subject}"
        )

        print(
            "  Balanced accuracy: "
            f"{result['balanced_accuracy']:.3f}"
        )

        print(
            "  F1:                "
            f"{result['f1']:.3f}"
        )

        print(
            "  ROC AUC:           "
            f"{result['roc_auc']:.3f}"
        )

        print()

    results_df = pd.DataFrame(
        results
    )

    metric_columns = [
        "accuracy",
        "balanced_accuracy",
        "precision",
        "recall",
        "f1",
        "roc_auc",
    ]

    print(
        "AVERAGE ACROSS "
        "THE 3 TEST SUBJECTS"
    )
    print("-" * 60)

    print(
        results_df[
            metric_columns
        ]
        .mean()
        .round(3)
    )

    # Train final proof-of-concept model
    # using all three subjects.
    final_model = build_model()

    final_model.fit(
        X,
        y,
    )

    MODEL_FOLDER.mkdir(
        parents=True,
        exist_ok=True,
    )

    joblib.dump(
        {
            "model": final_model,
            "feature_columns":
                FEATURE_COLUMNS,
            "training_subjects":
                sorted(
                    df[
                        "subject"
                    ].unique()
                ),
            "window_seconds": 30,
            "target_definition": {
                0: "WESAD baseline",
                1: "WESAD stress",
            },
        },
        MODEL_FILE,
    )

    results_df.to_csv(
        RESULTS_FILE,
        index=False,
    )

    classifier = (
        final_model.named_steps[
            "classifier"
        ]
    )

    importance_df = (
        pd.DataFrame(
            {
                "feature":
                    FEATURE_COLUMNS,
                "importance":
                    classifier
                    .feature_importances_,
            }
        )
        .sort_values(
            "importance",
            ascending=False,
        )
    )

    importance_df.to_csv(
        IMPORTANCE_FILE,
        index=False,
    )

    print("\nTOP 10 FEATURES")
    print("-" * 60)

    print(
        importance_df
        .head(10)
        .to_string(
            index=False
        )
    )

    print("\nSAVED")
    print("-" * 60)
    print(
        "Model:",
        MODEL_FILE,
    )
    print(
        "Evaluation:",
        RESULTS_FILE,
    )
    print(
        "Feature importance:",
        IMPORTANCE_FILE,
    )

    print(
        "\nIMPORTANT: This model "
        "detects patterns from WESAD "
        "laboratory stress data. "
        "It is a proof-of-concept "
        "distress model, not a "
        "clinically validated PTSD "
        "detector."
    )


if __name__ == "__main__":
    main()
