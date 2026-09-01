"""Train a WATCH-COMPATIBLE personalised stress model.

WHY THIS EXISTS
---------------
The existing personalised model uses all 16 WESAD features, and by its own
feature-importance table 72.8% of its decision power comes from
electrodermal activity (46.4%) and skin temperature (26.4%). An Apple Watch
exposes neither through HealthKit.

That left the app in the worst of both worlds: a genuinely trained model sat in
the repository unused, while the live app ran a hand-written heart-rate
heuristic. Feeding the 16-feature model imputed values for the missing 73%
would not fix that -- the pipeline's SimpleImputer means it would RUN without
error, but every prediction would be driven by the median of the training set
rather than by the patient, which is worse than a heuristic because it looks
like a model.

So this trains the same architecture, with the same personalisation and the
same leave-one-subject-out protocol, restricted to the features an Apple Watch
can actually provide. The resulting accuracy is lower and must be reported as
such -- but it is a real trained model that can genuinely drive the live app.

Deliberately kept as a separate file: the 16-feature model stays exactly as it
is, for use with a wearable that provides the full sensor set.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import Pipeline

DATA_FILE = Path("data/processed/wesad_3subjects_features.csv")
OUT_MODEL = Path("models/wesad_stress_model_watch.joblib")
OUT_RESULTS = Path("models/watch_loso_results.json")

# Exactly what Apple Watch + HealthKit can supply.
#   heart_rate_*      <- HKQuantityTypeIdentifierHeartRate
#   ibi_mean_seconds  <- derived from beat-to-beat intervals
#   sdnn_ms           <- HKQuantityTypeIdentifierHeartRateVariabilitySDNN
#   rmssd_ms          <- derivable from beat-to-beat intervals
#   acc_magnitude_*   <- motion / activity
# EDA and skin temperature are deliberately excluded: the Watch does not
# provide them, so training on them would produce a model that cannot run.
WATCH_FEATURES = [
    "heart_rate_mean", "heart_rate_std", "heart_rate_range",
    "ibi_mean_seconds", "sdnn_ms", "rmssd_ms",
    "acc_magnitude_mean", "acc_magnitude_window_std",
    "acc_magnitude_variability_mean",
]

BASELINE_CALIBRATION_WINDOWS = 10   # same as the 16-feature model


def build_model() -> Pipeline:
    # Identical architecture and hyperparameters to train_model_personalized.py,
    # so the only variable being changed is the feature set.
    return Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("classifier", RandomForestClassifier(
            n_estimators=500, max_depth=6, min_samples_leaf=3,
            class_weight="balanced", random_state=42, n_jobs=-1,
        )),
    ])


def num(v):
    """CSV cells can be empty where a window had no usable sample. Treat those
    as NaN rather than crashing -- the pipeline's imputer is there for exactly
    this, and dropping the rows would bias the baseline."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan


def load_rows():
    with open(DATA_FILE) as fh:
        return list(csv.DictReader(fh))


def personalise(rows):
    """Convert absolute physiology into change-from-personal-baseline.

    Same rule as the 16-feature model: build each subject's profile from their
    first N known-baseline windows only, then z-score everything against it.
    Using the whole subject's data here would leak the stress windows into the
    baseline and inflate the score.
    """
    out = []
    for subject in sorted({r["subject"] for r in rows}):
        sub = [r for r in rows if r["subject"] == subject]
        sub.sort(key=lambda r: num(r["window_start_s"]))

        baseline = [r for r in sub if int(num(r["target_stress"])) == 0][:BASELINE_CALIBRATION_WINDOWS]
        if len(baseline) < BASELINE_CALIBRATION_WINDOWS:
            raise ValueError(f"Subject {subject} has only {len(baseline)} baseline windows")

        mean, std = {}, {}
        for f in WATCH_FEATURES:
            vals = np.array([num(r[f]) for r in baseline], dtype=float)
            mean[f] = np.nanmean(vals) if np.isfinite(vals).any() else np.nan
            s = np.nanstd(vals, ddof=1) if np.isfinite(vals).sum() > 1 else 0.0
            std[f] = np.nan if s == 0 else s   # a flat feature cannot be z-scored

        for r in sub:
            row = {"subject": subject, "target_stress": int(num(r["target_stress"]))}
            for f in WATCH_FEATURES:
                row[f] = (num(r[f]) - mean[f]) / std[f] if std[f] == std[f] else np.nan
            out.append(row)
    return out


def xy(rows):
    X = np.array([[r[f] for f in WATCH_FEATURES] for r in rows], dtype=float)
    y = np.array([r["target_stress"] for r in rows], dtype=int)
    return X, y


def main():
    rows = personalise(load_rows())
    subjects = sorted({r["subject"] for r in rows})
    print(f"Watch-compatible features: {len(WATCH_FEATURES)}  |  subjects: {subjects}")

    # Leave-one-subject-out: the held-out person is never seen in training,
    # which is the only honest way to estimate performance on a NEW patient.
    per_subject, all_true, all_prob = [], [], []
    for held_out in subjects:
        train = [r for r in rows if r["subject"] != held_out]
        test = [r for r in rows if r["subject"] == held_out]
        Xtr, ytr = xy(train)
        Xte, yte = xy(test)

        model = build_model().fit(Xtr, ytr)
        prob = model.predict_proba(Xte)[:, 1]
        pred = (prob >= 0.5).astype(int)

        res = {
            "held_out_subject": held_out,
            "n_windows": len(yte),
            "accuracy": float(accuracy_score(yte, pred)),
            "balanced_accuracy": float(balanced_accuracy_score(yte, pred)),
            "precision": float(precision_score(yte, pred, zero_division=0)),
            "recall": float(recall_score(yte, pred, zero_division=0)),
            "f1": float(f1_score(yte, pred, zero_division=0)),
            "roc_auc": float(roc_auc_score(yte, prob)) if len(set(yte)) > 1 else None,
        }
        per_subject.append(res)
        all_true.extend(yte.tolist())
        all_prob.extend(prob.tolist())
        print(f"  hold out {held_out}: acc={res['accuracy']:.3f} "
              f"bal_acc={res['balanced_accuracy']:.3f} roc_auc={res['roc_auc']}")

    all_true = np.array(all_true)
    all_pred = (np.array(all_prob) >= 0.5).astype(int)
    pooled = {
        "accuracy": float(accuracy_score(all_true, all_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(all_true, all_pred)),
        "precision": float(precision_score(all_true, all_pred, zero_division=0)),
        "recall": float(recall_score(all_true, all_pred, zero_division=0)),
        "f1": float(f1_score(all_true, all_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(all_true, np.array(all_prob))),
    }
    print("\nPooled leave-one-subject-out:")
    for k, v in pooled.items():
        print(f"  {k:20} {v:.4f}")

    # Final model trained on every subject, for deployment.
    X, y = xy(rows)
    final = build_model().fit(X, y)

    importance = dict(sorted(
        zip(WATCH_FEATURES, final.named_steps["classifier"].feature_importances_.tolist()),
        key=lambda kv: -kv[1],
    ))

    joblib.dump({
        "model": final,
        "feature_columns": WATCH_FEATURES,
        "detection_threshold": 0.5,
        "baseline_calibration_windows": BASELINE_CALIBRATION_WINDOWS,
        "requires_personal_baseline": True,
        "sensor_requirements": "Apple Watch / HealthKit only — no EDA, no skin temperature",
        "loso_metrics": pooled,
        "per_subject": per_subject,
        "n_subjects": len(subjects),
        "feature_importance": importance,
        "honest_note": (
            "Trained ONLY on features an Apple Watch can provide. Scores lower "
            "than the 16-feature WESAD model because EDA and skin temperature -- "
            "72.8% of that model's feature importance -- are unavailable on this "
            "hardware. Reported metrics are leave-one-subject-out over 3 subjects "
            "and are a prototype result, not a population claim."
        ),
    }, OUT_MODEL)

    OUT_RESULTS.write_text(json.dumps(
        {"pooled": pooled, "per_subject": per_subject,
         "features": WATCH_FEATURES, "feature_importance": importance}, indent=2))
    print(f"\nSaved {OUT_MODEL}")
    print("Top features:", list(importance)[:4])


if __name__ == "__main__":
    main()
