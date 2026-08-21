# Companio Risk Engine — Backend Handoff

The Python risk engine runs as a FastAPI service.

## Start it

```bash
uvicorn api:app --reload
```

Default local address:

```text
http://127.0.0.1:8000
```

## Health check

```text
GET /health
```

Example response:

```json
{
  "status": "ok",
  "model_loaded": true
}
```

## Prediction endpoint

```text
POST /predict-distress
```

Send exactly 30 one-second values for each signal:

```json
{
  "heart_rate": [/* 30 values */],
  "eda": [/* 30 values */],
  "temperature": [/* 30 values */],
  "acc_magnitude_mean": [/* 30 values */],
  "acc_magnitude_std": [/* 30 values */],
  "ibi_mean_seconds": [/* 30 values; null allowed */]
}
```

Example response:

```json
{
  "physiological_distress_score": 0.3794,
  "model_pattern": "baseline-like",
  "support_level": "low",
  "action": "no_grounding_prompt",
  "note": "WESAD-based physiological stress/distress proof of concept; not a PTSD diagnosis or PTSD-attack probability."
}
```

The score is a physiological stress/distress model output. It is not a probability that the user has PTSD or is having a PTSD attack.
