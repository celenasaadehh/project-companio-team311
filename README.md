# Companio

Clinician-governed support for people living with PTSD, in the hours between
therapy sessions.

Companio watches for physiological signs of distress, and when it finds them
it offers **only what that patient's own therapist has approved**. Everything
it does is recorded, explained, and reviewable by the clinician. It does not
diagnose, and it is not a crisis service.

**Demo video, report and model weights:**
[Google Drive folder](https://drive.google.com/drive/folders/14B_xLF0soz0fvFXfnwFgepPmiz0Nrm_O?usp=share_link)

---

## What it does

- **Watch monitoring** — heart rate, HRV, sleep and movement from Apple
  Health, scored every 5 seconds against the patient's own calm baseline.
- **An episode runs itself** — sustained elevation → "Are you okay?" →
  10 seconds of silence with no declared cause → the camera activates
  (announced, never silent), burst-samples the surroundings every ~6 seconds,
  and checks each frame against the therapist's trigger list.
- **Interventions that deliver** — the therapist's recorded voice plays, a
  video link opens, grounding is spoken step by step, a call sheet dials a
  chosen contact. The approved list is walked in order; escalation to a
  person comes only when everything approved has been tried.
- **Voice** — say or type "I'm anxious"; "Hey Companio" listens in-app, and
  "Hey Siri, Companio" opens the app already listening from the lock screen.
- **The therapist sees everything** — episodes as single incidents, every
  decision with the layer that made it, a scored risk timeline, camera
  captures with image + labels + heart rate vs baseline, and unseen triggers
  flagged for review so the care plan grows from evidence.
- **The patient stays in charge** — declaring "I'm exercising" stands the
  escalation down, and independent switches govern camera, microphone and
  every kind of retention.

Full feature list, episode logic and design commitments: [docs/DESIGN.md](docs/DESIGN.md)

---

## How it decides

| Layer | When it applies |
|---|---|
| **Therapist rule** | A rule covers this situation — no model is consulted |
| **AI reasoning** | No rule covers it — chooses among *already-approved* interventions |
| **Safety filter** | Always, on the output — deterministic, fails closed |
| **Safe fallback** | Nothing above can answer — says so, rather than improvising |

## Machine learning

Every model was trained by this team. **No third-party LLM is used anywhere.**

| Model | Data | Result |
|---|---|---|
| Watch risk model (Random Forest, 9 features) | WESAD | 75.7% acc · 0.764 ROC-AUC · LOSO |
| Full risk model (Random Forest, 16 features) | WESAD | 90.9% acc · 0.987 ROC-AUC · LOSO |
| Distress detector (fine-tuned DistilBERT) | Dreaddit | 78.5% acc · 0.857 ROC-AUC |
| Support-stage recommender | First-party | 80% on 15 held-out examples |
| Thompson Sampling bandit | The patient's own outcomes | Learns online |

Honest caveats for every number (subject counts, sample sizes, what cannot
run on a watch): [docs/DESIGN.md](docs/DESIGN.md#machine-learning-stated-limitations)

## Architecture

```
iPhone (React Native)
  │  HealthKit · Camera · Microphone — each behind its own consent switch
  ↓  Cognito JWT on every request
API Gateway ──→ Lambda ──→ DynamoDB (7 tables)
  │                    └─→ S3 (SSE-KMS) → Rekognition / Transcribe
  ↓
Python inference service (FastAPI)
  therapist rules → distress gate → recommender → bandit → safety filter
```

AWS: Cognito, API Gateway + Lambda, DynamoDB, S3 (KMS), Rekognition,
Transcribe, server-side Expo push. Optional App Runner hosting for the
engine: [deploy/](deploy/README.md)

---

## Running it

```bash
# inference service
cd therapist_engine
python3 -m pip install -r requirements.txt
python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000
curl localhost:8000/api/health/models          # every model should be loaded

# mobile app (needs Xcode + a physical iPhone)
cd mobile && npx expo run:ios --device

# tests
cd therapist_engine && python3 -m pytest tests -q          # 51 tests
cd mobile && node ./.undefined_check.js && node ./.export_check.js
```

The DistilBERT weights (255 MB, above GitHub's file limit) are in the
[Drive folder](https://drive.google.com/drive/folders/14B_xLF0soz0fvFXfnwFgepPmiz0Nrm_O?usp=share_link):
place `model.safetensors` at
`therapist_engine/ml/detector_bert/bert_model/`. Without it the engine still
runs — the health endpoint reports the detector absent and the gate fails
closed.

## Repository

```
mobile/              React Native app
therapist_engine/    FastAPI inference service, decision hierarchy, 51 tests
risk_engine/         physiological models and training
ai-risk-engine/      the original risk-model module, as committed by its author
aws/                 Lambda backend
deploy/              hosting the engine on App Runner (documented, not wired in)
docs/                design notes, limitations, privacy
shared/ · tools/     trigger vocabulary and its generators
```

---

Companio supports care between sessions. It does not diagnose, does not
replace a clinician, and is not monitored in real time. In a crisis, call
911 or 988.
