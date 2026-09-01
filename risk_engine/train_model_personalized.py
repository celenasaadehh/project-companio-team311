"""
Improved Companio physiological-distress model.

Key fix:
The original model used absolute physiological values across people.
EDA, temperature, HR, and HRV can have very different baselines from
person to person, which can cause false positives.

This version personalizes every subject relative to a short known-calm
baseline calibration period before training/prediction.

Evaluation remains leave-one-subject-out. The classification threshold
for each outer test subject is selected ONLY from the two training
subjects using an inner subject-level validation loop.

IMPORTANT:
- WESAD stress is a physiological-stress proxy, not PTSD.
- This model does not diagnose PTSD or estimate PTSD-attack probability.
"""

from pathlib import Path

import joblib
import numpy as np
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
from sklearn.pipeline import Pipeline


DATA_FILE = Path("data/processed/wesad_3subjects_features.csv")
MODEL_FOLDER = Path("models")
MODEL_FILE = MODEL_FOLDER / "wesad_stress_model_personalized.joblib"
RESULTS_FILE = MODEL_FOLDER / "personalized_loso_results.csv"

ID_COLUMNS = {
    "subject",
    "window_start_s",
    "target_stress",
}

# Ten overlapping 30-second windows at a 15-second step span about
# 2 minutes 45 seconds. In the real product this corresponds to a
# short calm calibration period when the wearable is first set up.
BASELINE_CALIBRATION_WINDOWS = 10

THRESHOLD_CANDIDATES = np.arange(
    0.05,
    0.951,
    0.025,
)


def build_model() -> Pipeline:
    return Pipeline(
        steps=[
            (
                "imputer",
                SimpleImputer(
                    strategy="median",
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


def calculate_baseline_profile(
    subject_df: pd.DataFrame,
    feature_columns: list[str],
) -> dict:
    """
    Build one person's baseline profile from the first known-baseline
    windows only.
    """
    baseline = (
        subject_df[
            subject_df["target_stress"] == 0
        ]
        .sort_values("window_start_s")
        .head(BASELINE_CALIBRATION_WINDOWS)
    )

    if len(baseline) < BASELINE_CALIBRATION_WINDOWS:
        raise ValueError(
            f"Subject {subject_df['subject'].iloc[0]} has only "
            f"{len(baseline)} baseline windows; "
            f"{BASELINE_CALIBRATION_WINDOWS} are required."
        )

    means = baseline[feature_columns].mean()
    stds = baseline[feature_columns].std(ddof=1)

    # Avoid division by zero for a feature that does not vary during
    # the short baseline calibration.
    stds = stds.replace(0, np.nan)

    return {
        "mean": means,
        "std": stds,
    }


def personalize_dataset(
    df: pd.DataFrame,
    feature_columns: list[str],
) -> pd.DataFrame:
    """
    Convert absolute physiology into change-from-personal-baseline
    features for each subject.
    """
    personalized = df.copy()

    for subject in sorted(
        df["subject"].unique()
    ):
        mask = (
            personalized["subject"]
            == subject
        )

        subject_df = df[mask].copy()

        profile = calculate_baseline_profile(
            subject_df,
            feature_columns,
        )

        personalized.loc[
            mask,
            feature_columns,
        ] = (
            (
                df.loc[
                    mask,
                    feature_columns,
                ]
                - profile["mean"]
            )
            / profile["std"]
        )

    return personalized


def choose_threshold_on_training_subjects(
    train_df: pd.DataFrame,
    feature_columns: list[str],
) -> float:
    """
    Choose the probability threshold using only the outer training
    subjects. Each training subject is held out once internally.
    """
    subjects = sorted(
        train_df["subject"].unique()
    )

    inner_probabilities = []
    inner_labels = []

    for validation_subject in subjects:
        inner_train = train_df[
            train_df["subject"]
            != validation_subject
        ]

        inner_validation = train_df[
            train_df["subject"]
            == validation_subject
        ]

        model = build_model()

        model.fit(
            inner_train[feature_columns],
            inner_train["target_stress"],
        )

        probabilities = (
            model.predict_proba(
                inner_validation[
                    feature_columns
                ]
            )[:, 1]
        )

        inner_probabilities.extend(
            probabilities
        )

        inner_labels.extend(
            inner_validation[
                "target_stress"
            ].to_numpy()
        )

    probabilities = np.asarray(
        inner_probabilities
    )

    labels = np.asarray(
        inner_labels
    )

    best_threshold = 0.5
    best_score = None

    for threshold in THRESHOLD_CANDIDATES:
        predictions = (
            probabilities
            >= threshold
        ).astype(int)

        # Primary objective: F1.
        # Tie-breakers: balanced accuracy, then precision.
        score = (
            f1_score(
                labels,
                predictions,
                zero_division=0,
            ),
            balanced_accuracy_score(
                labels,
                predictions,
            ),
            precision_score(
                labels,
                predictions,
                zero_division=0,
            ),
        )

        if (
            best_score is None
            or score > best_score
        ):
            best_score = score
            best_threshold = float(
                threshold
            )

    return best_threshold


def main() -> None:
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Could not find {DATA_FILE}"
        )

    df = pd.read_csv(DATA_FILE)

    feature_columns = [
        column
        for column in df.columns
        if column not in ID_COLUMNS
    ]

    personalized = personalize_dataset(
        df,
        feature_columns,
    )

    subjects = sorted(
        personalized[
            "subject"
        ].unique()
    )

    results = []

    print(
        "\nPERSONALIZED LEAVE-ONE-SUBJECT-OUT EVALUATION"
    )
    print("-" * 70)

    for test_subject in subjects:
        train_df = personalized[
            personalized["subject"]
            != test_subject
        ].copy()

        test_df = personalized[
            personalized["subject"]
            == test_subject
        ].copy()

        threshold = (
            choose_threshold_on_training_subjects(
                train_df,
                feature_columns,
            )
        )

        model = build_model()

        model.fit(
            train_df[feature_columns],
            train_df["target_stress"],
        )

        probabilities = (
            model.predict_proba(
                test_df[
                    feature_columns
                ]
            )[:, 1]
        )

        predictions = (
            probabilities
            >= threshold
        ).astype(int)

        actual = test_df[
            "target_stress"
        ].to_numpy()

        result = {
            "test_subject":
                test_subject,
            "selected_threshold":
                threshold,
            "accuracy":
                accuracy_score(
                    actual,
                    predictions,
                ),
            "balanced_accuracy":
                balanced_accuracy_score(
                    actual,
                    predictions,
                ),
            "precision":
                precision_score(
                    actual,
                    predictions,
                    zero_division=0,
                ),
            "recall":
                recall_score(
                    actual,
                    predictions,
                    zero_division=0,
                ),
            "f1":
                f1_score(
                    actual,
                    predictions,
                    zero_division=0,
                ),
            "roc_auc":
                roc_auc_score(
                    actual,
                    probabilities,
                ),
        }

        results.append(result)

        print(
            f"Test {test_subject} | "
            f"threshold={threshold:.3f} | "
            f"precision={result['precision']:.3f} | "
            f"recall={result['recall']:.3f} | "
            f"F1={result['f1']:.3f} | "
            f"AUC={result['roc_auc']:.3f}"
        )

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

    averages = (
        results_df[
            metric_columns
        ]
        .mean()
    )

    print("\nAVERAGE")
    print("-" * 70)
    print(
        averages
        .round(3)
        .to_string()
    )

    # Train the final personalized model on all subjects.
    final_model = build_model()

    final_model.fit(
        personalized[
            feature_columns
        ],
        personalized[
            "target_stress"
        ],
    )

    # Use the median threshold learned during the unbiased outer folds
    # as the final prototype operating threshold.
    final_threshold = float(
        results_df[
            "selected_threshold"
        ].median()
    )

    MODEL_FOLDER.mkdir(
        parents=True,
        exist_ok=True,
    )

    joblib.dump(
        {
            "model":
                final_model,
            "feature_columns":
                feature_columns,
            "detection_threshold":
                final_threshold,
            "baseline_calibration_windows":
                BASELINE_CALIBRATION_WINDOWS,
            "requires_personal_baseline":
                True,
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

    print("\nSAVED")
    print("-" * 70)
    print(
        "Model:",
        MODEL_FILE,
    )
    print(
        "Results:",
        RESULTS_FILE,
    )
    print(
        "Final prototype threshold:",
        f"{final_threshold:.3f}",
    )
    print(
        "\nThis improved model requires a short calm baseline "
        "calibration for each user before live prediction."
    )


if __name__ == "__main__":
    main()
