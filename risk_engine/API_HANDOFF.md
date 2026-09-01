# Companio AI Risk Engine — API Handoff

This document explains how the main Companio backend should call the personalized physiological distress engine.

## What the service does

The service analyzes 30-second windows of wearable physiology and returns a physiological distress score.

It is personalized: each user must first complete a short calm calibration so the model can compare new physiology against that user's own baseline.

This is a proof-of-concept built using WESAD stress data. It does **not** diagnose PTSD and the score is **not** a probability of a PTSD attack.

---

## Run the service

From the `ai-risk-engine` directory:

```bash
uvicorn api:app --reload
```

Default local URL:

```text
http://127.0.0.1:8000
```

---

## 1. Health check

### Request

```http
GET /health
```

### Example response

```json
{
  "status": "ok",
  "personalized_model_loaded": true,
  "detection_threshold": 0.175,
  "calibrated_users": 1
}
```

---

## 2. Calibrate a user

Call this during initial setup while the user is calm.

The current prototype requires at least 10 separate 30-second windows.

### Request

```http
POST /calibrate
Content-Type: application/json
```

### Body

```json
{
  "user_id": "user_123",
  "windows": [
    {
      "heart_rate": [/* 30 one-second values */],
      "eda": [/* 30 one-second values */],
      "temperature": [/* 30 one-second values */],
      "acc_magnitude_mean": [/* 30 one-second values */],
      "acc_magnitude_std": [/* 30 one-second values */],
      "ibi_mean_seconds": [/* 30 values; null is allowed */]
    }
  ]
}
```

Each sensor array must contain exactly 30 values.

The `windows` array must contain at least 10 calm windows.

### Example response

```json
{
  "status": "calibrated",
  "user_id": "user_123",
  "calibration_windows": 10,
  "message": "Personal calm baseline saved. Future predictions for this user will be normalized relative to it."
}
```

---

## 3. Predict physiological distress

Call this repeatedly during normal operation after the user has been calibrated.

### Request

```http
POST /predict-distress
Content-Type: application/json
```

### Body

```json
{
  "user_id": "user_123",
  "window": {
    "heart_rate": [/* 30 one-second values */],
    "eda": [/* 30 one-second values */],
    "temperature": [/* 30 one-second values */],
    "acc_magnitude_mean": [/* 30 one-second values */],
    "acc_magnitude_std": [/* 30 one-second values */],
    "ibi_mean_seconds": [/* 30 values; null is allowed */]
  }
}
```

### Example response

```json
{
  "user_id": "user_123",
  "physiological_distress_score": 0.82,
  "model_pattern": "stress-like",
  "support_level": "high",
  "action": "prominent_grounding_offer",
  "detection_threshold": 0.175,
  "personalized": true,
  "note": "WESAD-based physiological distress proof of concept. This is not a PTSD diagnosis or PTSD-attack probability."
}
```

---

## Support actions

The API currently returns one of:

```text
no_grounding_prompt
offer_grounding
prominent_grounding_offer
```

The learned model detection threshold in the current prototype is:

```text
0.175
```

The elevated/high support split is still a prototype product rule and should not be presented as a clinical threshold.

---

## Expected backend flow

```text
User creates account
        ↓
Backend assigns user_id
        ↓
User completes calm calibration
        ↓
Backend sends calibration windows to POST /calibrate
        ↓
Risk engine saves personal baseline
        ↓
Wearable/glasses continuously produce sensor data
        ↓
Backend groups data into 30-second windows
        ↓
Backend sends each window to POST /predict-distress
        ↓
Risk engine returns distress score + action
        ↓
Backend sends appropriate grounding/support instruction to glasses/app
```

---

## Important integration notes

- A user must be calibrated before `/predict-distress` can be used.
- The same `user_id` must be used for calibration and later predictions.
- Each signal array must contain exactly 30 one-second values.
- `ibi_mean_seconds` may contain `null`.
- Do not expose this as a PTSD diagnosis, PTSD probability, or medical emergency detector.
- The current model was developed from WESAD stress data using S2, S3, and S4 as a proof of concept.
- Personalized leave-one-subject-out evaluation should be treated as prototype evaluation only, not clinical validation.
