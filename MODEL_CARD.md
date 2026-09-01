# tatainaamazonchat Model Card

## ⚠️ CRITICAL — training-data licensing must be resolved before commercial launch

Verified directly against each dataset's own published terms on 2026-08-30
(not secondhand — quoted verbatim from the primary source in each case).
**Every trained model currently in this app was trained on data whose
license explicitly restricts it to non-commercial/academic research use.**
This is a real licensing blocker for an App Store commercial product, not a
formality — it needs a decision (request a commercial license from each
dataset's authors, or retrain on properly-licensed / first-party data)
before public commercial launch.

| Dataset | Used by | License, verbatim from the source |
|---|---|---|
| **WESAD** | `risk_engine/` — the flagship 90.9%-accuracy physiological risk model | *"You may use this data for scientific, non-commercial purposes..."* — explicitly non-commercial |
| **ESConv** | `therapist_engine/ml/recommender_model.joblib` — live, drives the unseen-trigger decision | *"Data and codes are for academic research use only."* |
| **Dreaddit** | `therapist_engine/ml/detector_bert/` (live) + the two archived detectors | No explicit license published anywhere found after a real search (GitHub, Columbia's site, IEEE DataPort). Undocumented ≠ permitted — treat as NOT cleared for commercial use until the authors confirm otherwise. |

**What this does NOT mean:** the engineering built on top of these models —
the decision hierarchy, the safety gate, the bandit, the AWS backend — is
unaffected and doesn't need to change. **What it DOES mean:** the specific
trained model files need either a commercial-use grant from each dataset's
authors, or retraining on data that's actually licensed for this. The
`intervention_bandit.py` layer is the one piece already immune to this
problem — it learns entirely from the app's own first-party usage data, not
from any external dataset.

## Status
Research/competition prototype. Not clinically validated. Not diagnostic. No model output should be interpreted as proof of PTSD, a panic attack, safety, or a need for medication.

## Physiological distress model
- Dataset: WESAD proof-of-concept data used by the current training pipeline.
- Model: Random Forest pipeline persisted in `risk_engine/models/wesad_stress_model.joblib`.
- Input contract: six synchronized one-second streams, 30 values each; IBI may contain limited missing values.
- Features: 16 fixed features in `risk_engine/src/features.py`.
- Product support thresholds: `<0.40 low`, `0.40–<0.70 elevated`, `>=0.70 high`. These are prototype product thresholds, **not clinical cutoffs**.
- Evaluation artifact: `leave_one_subject_out_results.csv` for subjects S2/S3/S4.
- Major limitation: only a very small subject evaluation set is represented in the committed artifact. Performance varies strongly by subject, so generalization cannot be assumed.
- Runtime reproducibility: scikit-learn is pinned to 1.6.1 and `/health` exposes the model SHA-256.

## Text distress detector
Current metrics from `therapist_engine/ml/detector_metrics.json`:

| Model | Accuracy | Precision | Recall | F1 | ROC AUC |
|---|---:|---:|---:|---:|---:|
| TF-IDF + Logistic Regression | 0.6783 | 0.6598 | 0.7778 | 0.7139 | 0.7663 |
| MiniLM + Logistic Regression | 0.7315 | 0.7902 | 0.6531 | 0.7151 | 0.8311 |
| DistilBERT | **0.7846** | **0.8011** | **0.7751** | **0.7879** | **0.8570** |

**DistilBERT is the live model** — `src/engines/text_distress_detector.py` loads it directly and it's what `/api/detect` actually calls. TF-IDF and MiniLM are archived (not deleted) in `ml/archived_weaker_models/`, kept for comparison only, not wired into anything. Text distress is an advisory signal only and must not become a diagnosis.

## Support recommender + bandit (unseen-trigger handling)
The ESConv recommender is advisory and subordinate to therapist rules + safety. It picks a support stage (EXPLORE/COMFORT/ACT); when multiple of the patient's approved actions match that stage, `intervention_bandit.py` (Thompson Sampling) picks among them using this specific patient's own real outcome history — cold-starting fairly with no data, and increasingly favoring whatever has actually worked for them. The AI reasoner no longer abstains just because no calming/breathing keyword matched — it offers the best available approved action rather than staying silent when the patient has approved at least one.

## Known failure boundaries
- Physiological elevation is not specific to PTSD.
- Sensor motion/contact problems can create misleading features.
- Dataset distributions may differ from the target population/devices.
- Text can be ambiguous, sarcastic, adversarial, multilingual, or out of distribution.
- Perception context can be uncertain; low-confidence context is explicitly `unknown`.
- No model is allowed to bypass therapist rules or the deterministic safety gate.

### Recommender training data — switched off ESConv entirely (2026-08-30)
ESConv's own license restricts it to academic research use only (see the
warning at the top of this file) — a real conflict with a commercial
product, not a formality. The recommender now trains on
`ml/data/companio_stage_examples.json`: ~75 original examples, written
specifically for PTSD-trigger situations, owned outright, zero licensing
risk. **Not yet reviewed by a licensed clinician** — treat class
assignments and coverage as a reasonable starting point, not validated.

**Held-out accuracy: 0.800, macro-F1 0.798 — but treat this number with real
suspicion, not pride.** It's measured on only 15 held-out examples (a tiny
dataset's honest cost), all written by the same author in a similar
register, which makes the task look easier than real, messy patient
language will be. A quick manual test against deliberately different,
casual phrasing ("omg my chest is so tight i think im gonna lose it")
mIsclassified at least one clearly-COMFORT case as EXPLORE — real-world
accuracy on genuinely diverse input is almost certainly lower than 80%.
This number should NOT be quoted as "better than the old 43.6%" — they're
not comparable; one is measured on 3,007 diverse real examples, the other
on 15 examples from one author's writing style. **Priority next step: get a
licensed clinician to review/expand this dataset, and re-evaluate on a
larger, more diverse held-out set before trusting this number.**

### Distress gate (new, 2026-08-30)
The recommender's training data has zero "the person is actually fine"
examples (ESConv-descended data, and this replacement, are both drawn from
conversations where support was needed) — so on its own it will confidently
guess a stage even for calm, non-distressed text. `ai_reasoner.py` now
checks DistilBERT first when free text is the ONLY available signal (no
observed visual trigger, no elevated risk score): if BERT says the text
doesn't sound distressed, no intervention is forced — the patient just gets
a warm acknowledgment. A real observed trigger or elevated risk score always
still gets a full response, regardless of how the patient's words sound —
verified by test (`tests/test_intervention_bandit.py`).
