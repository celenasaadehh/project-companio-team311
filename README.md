# Companio

Clinician-governed support for people living with PTSD, in the hours between
therapy sessions.

Companio watches for physiological signs of distress, and when it finds them it
offers **only what that patient's own therapist has approved**. Everything it
does is recorded, explained, and reviewable by the clinician.

It does not diagnose, and it is not a crisis service.

---

## The problem

PTSD episodes happen between appointments. Someone may see a therapist for one
hour a week and face triggers in any of the other 167.

Two gaps make that worse:

**The clinician never sees what happened.** The next session relies on the
patient's recollection of an event they were, by definition, in no state to
remember accurately.

**Generic self-help can cause harm.** Prolonged breathwork can trigger panic;
body scans can deepen dissociation. An app that suggests interventions without
knowing the individual can worsen the episode it is trying to help.

---

## How it decides

Companio never invents treatment. Every action is traceable to something the
clinician entered, and the order of authority is enforced in code:

| Layer | When it applies | Confidence |
|---|---|---|
| **Therapist rule** | A rule covers this situation | 1.0 — no model is consulted |
| **AI reasoning** | No rule covers it | Chooses among *already-approved* interventions |
| **Safety filter** | Always, on the output | Deterministic, fails closed |
| **Safe fallback** | Nothing above can answer | Says so, rather than improvising |

The safety filter blocks false safety guarantees — "you are safe", "there is no
danger" — because the app cannot verify them and being wrong once destroys
trust in everything else it says.

When every approved intervention has been tried and none helped, Companio does
**not** invent a new one. It says what we tried isn't working and offers to
reach a person.

---

## Architecture

```
iPhone (React Native)
  │  Apple HealthKit ── heart rate, HRV, sleep, movement, caffeine
  │  Camera ── one frame, only when physiology rises
  │  Microphone ── only while the patient is speaking to it
  ↓  Cognito JWT on every request
API Gateway ──→ Lambda ──→ DynamoDB (7 tables)
  │                    └─→ S3 (SSE-KMS) → Rekognition / Transcribe
  ↓
Python inference service (FastAPI)
     therapist rules → distress gate → stage recommender → bandit → safety filter
     returns the decision, what to say, and a step-by-step trace
```

Two design commitments follow from the clinical context:

**Identity separation.** Real names and photographs live in `CompanioIdentity`.
Clinical records — profiles, sessions, decisions, media — live in separate
tables that never contain a name, enforced server-side rather than trusted to
the client.

**Nothing fabricated.** Where data is unavailable the interface says so. It
never shows a placeholder number, and never reports a message as delivered when
it was not.

---

## Machine learning

Every model was trained by this team. **No third-party LLM is used anywhere.**

| Model | Purpose | Data | Result |
|---|---|---|---|
| Watch risk model (Random Forest, 9 features) | Distress from Apple Watch signals | WESAD | 75.7% acc · **0.764 ROC-AUC** · LOSO, 3 subjects |
| Full risk model (Random Forest, 16 features) | Distress from a complete sensor set | WESAD | 90.9% acc · 0.987 ROC-AUC · LOSO, 3 subjects |
| Distress detector (fine-tuned DistilBERT) | Is this text actually distressed? | Dreaddit | 78.5% acc · 0.857 ROC-AUC |
| Support-stage recommender | What kind of support fits | First-party | 80% on **15** held-out examples |
| Thompson Sampling bandit | Personalise among approved options | The patient's own outcomes | Learns online |
| Safety filter | Block unsafe phrasing | Deterministic | Fails closed |

### Stated limitations

These are reported because overstating them would be the more serious error.

- **The 16-feature model cannot run on an Apple Watch.** 72.8% of its decision
  power comes from electrodermal activity and skin temperature, which HealthKit
  does not expose. The 9-feature Watch model exists for that reason and scores
  lower. The app names which engine produced every score, and **0.987 is never
  presented as live Watch performance.**
- **Three subjects.** A prototype result, not a population claim.
- **The recommender's 80% is on 15 examples** — too small to support a
  confident accuracy claim. The sample size is reported alongside it.
- **The distress detector is trained on Reddit text,** not clinical speech.
- The comparison models (TF-IDF 0.766, MiniLM 0.831) are kept in
  `therapist_engine/ml/archived_weaker_models/` and reported by `/api/models`,
  so the choice of DistilBERT is evidenced rather than asserted.

---

## Repository

```
mobile/              React Native app (52 source files)
  src/services/      engines, health, episodes, speech, notifications
  src/screens/       patient and therapist interfaces
  src/_unused/       superseded code, kept for reference, imported by nothing
therapist_engine/    FastAPI inference service, decision hierarchy, 46 tests
risk_engine/         physiological models and training (integrated copy + Watch model)
ai-risk-engine/      the original risk-model module, preserved as committed by its author
aws/                 Lambda backend (single file)
shared/              trigger vocabulary — one source of truth for all engines
tools/               regenerates every consumer of that vocabulary
```

### Running it

**Inference service**

```bash
cd therapist_engine && python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Needs `torch`, `transformers`, and **`scikit-learn==1.6.1`** — pinned because
the serialised models were saved with exactly that version.

Check every model loaded before relying on it:

```bash
curl localhost:8000/api/health/models
```

**Mobile app**

```bash
cd mobile && npx expo run:ios --device
```

Requires Xcode and a physical device: HealthKit is unavailable in the Simulator
and in Expo Go.

**Tests**

```bash
cd therapist_engine && python3 -m pytest tests -q      # 46 tests
cd mobile && node ./.undefined_check.js && node ./.export_check.js
```

Those last two catch bugs neither the compiler nor the test suite sees: an
identifier used but never defined, and an import of a name the target file does
not export. The second class fails only at runtime, on the one screen that uses
it.

---

## Privacy

- Photos, audio and images are stored in a KMS-encrypted bucket and reachable
  only through short-lived presigned URLs. There are no public links.
- The patient controls monitoring, camera, microphone, transcript retention,
  audio retention, image retention, therapist alerts and caregiver escalation
  **independently**. Each switch is read by the code that performs the
  behaviour.
- Turning retention off stops the file being kept on the clinical record and
  shown to the therapist. It does not yet erase the object from storage, and
  the interface does not claim otherwise.
- Monitoring can be paused for a chosen period.

---

## Known limitations

- **Monitoring is not continuous in the background.** The state machine
  advances while the app is foregrounded. True background monitoring needs
  native HealthKit background delivery.
- **No smart-glasses hardware.** The phone camera is the capture device;
  provenance is recorded as `phone_camera`, never as glasses.
- **No wake word.** Voice starts when the patient taps.
- **The inference service must be reachable.** Hosted away from the device, the
  app falls back to the Lambda path, which matches therapist rules but does not
  run the trained models. The interface says which engine answered.

---

## Not medical advice

Companio supports care between sessions. It does not diagnose, does not replace
a clinician, and is not monitored in real time. In a crisis, call 911 or 988.
