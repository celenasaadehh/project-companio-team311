# Companio

Clinician-governed support for people living with PTSD, in the hours between
therapy sessions.

Companio watches for physiological signs of distress, and when it finds them
it offers **only what that patient's own therapist has approved**. Everything
it does is recorded, explained, and reviewable by the clinician. It does not
diagnose, and it is not a crisis service.

> ### ⚠️ Before running the engine: download the model weights
>
> Four of the five trained models ship in this repository. The fifth — the
> fine-tuned **DistilBERT text-distress detector** — is a single **255 MB**
> file, above GitHub's 100 MB limit, so it is hosted on Google Drive:
>
> **➜ [Download `model.safetensors` from the Google Drive folder](https://drive.google.com/drive/folders/1I4coUgV6tsdymLN9cKL0X1aSp0IF4B9N?usp=sharing)**
>
> Place it at `therapist_engine/ml/detector_bert/bert_model/model.safetensors`
> (its config and tokenizer are already in that folder). Without it the engine
> still runs on the other four models — the health endpoint reports the
> detector as absent and the text gate fails closed rather than guessing.

**Status:** a working prototype. The iOS app is a development build signed
with our Apple Developer account and run on a physical iPhone; the AWS
backend (Cognito, API Gateway, Lambda, DynamoDB, S3, Rekognition, Transcribe)
is deployed and live; the Python inference service runs on a development
machine on the same network as the phone. When it is unreachable the app
falls back to the AWS decision path and records which engine answered.

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
Transcribe, server-side Expo push.

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
cd therapist_engine && python3 -m pytest tests -q   # 105 engine + backend tests
cd mobile && npm run check                          # 75 app tests + 2 static analysers
```

The DistilBERT weights are the one file not in this repository: download
`model.safetensors` from the
[Google Drive folder](https://drive.google.com/drive/folders/1I4coUgV6tsdymLN9cKL0X1aSp0IF4B9N?usp=sharing)
and place it at `therapist_engine/ml/detector_bert/bert_model/` before
starting the engine, or accept four of five models.

The app needs Xcode and a physical iPhone: HealthKit is unavailable in the
Simulator, and the build is signed with our Apple Developer account.

## Repository

```
mobile/              React Native app, 75 tests
therapist_engine/    FastAPI inference service, decision hierarchy, 105 tests
risk_engine/         physiological models and training
ai-risk-engine/      the original risk-model module, as committed by its author
aws/                 Lambda backend
docs/                design notes, limitations, privacy
shared/ · tools/     trigger vocabulary and its generators
```

---

Companio supports care between sessions. It does not diagnose, does not
replace a clinician, and is not monitored in real time. In a crisis, call
911 or 988.
