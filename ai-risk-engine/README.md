# Companio AI Risk Engine

This folder contains the current working physiological distress-detection MVP for Companio.

## What it does

The engine analyzes short windows of wearable physiological signals and outputs a physiological distress score.

Current inputs:
- heart rate;
- electrodermal activity (EDA);
- skin temperature;
- accelerometer-derived movement;
- inter-beat interval / HRV features.

The current model is a Random Forest trained on WESAD laboratory stress data.

It does **not** diagnose PTSD and its score is **not** the probability of a PTSD attack.

## Pipeline

```text
Wearable signals
        ↓
1-second synchronization
        ↓
30-second feature extraction
        ↓
Random Forest
        ↓
Physiological distress score
        ↓
Prototype support level/action
```

## Current model features

The current training pipeline uses 16 features derived from HR, EDA, temperature, ACC, and IBI/HRV.

## Evaluation

Current proof-of-concept evaluation uses WESAD subjects S2, S3, and S4 with leave-one-subject-out testing.

Current average unseen-subject results:
- ROC AUC: 0.786
- Balanced accuracy: 0.708
- F1: 0.531

These results are proof-of-concept only.

## API

Start the service:

```bash
uvicorn api:app --reload
```

Health check:

```text
GET /health
```

Prediction endpoint:

```text
POST /predict-distress
```

Example response:

```json
{
  "physiological_distress_score": 0.3794,
  "model_pattern": "baseline-like",
  "support_level": "low",
  "action": "no_grounding_prompt"
}
```

Prototype support thresholds:
- `< 0.40` → low
- `0.40 to < 0.70` → elevated
- `>= 0.70` → high

These thresholds are not clinical cutoffs.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn api:app --reload
```

In another terminal:

```bash
python test_api.py
```

## Main files

- `api.py` — FastAPI service
- `train_model.py` — model training and evaluation
- `test_api.py` — end-to-end API smoke test
- `src/preprocess.py` — sensor synchronization utilities
- `src/features.py` — 30-second feature extraction
- `models/wesad_stress_model.joblib` — trained proof-of-concept model
- `data/processed/wesad_3subjects_features.csv` — small processed training dataset
- `API_HANDOFF.md` — integration contract for the main backend
