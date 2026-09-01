# =============================================================================
# api/main.py  -  THE BACKEND (the app talks to this)
# =============================================================================
# WHAT THIS IS:
#   A FastAPI web server that exposes the whole brain (engines + ML models + RAG)
#   over the internet, so the phone app can call it.
#
# HOW TO RUN (from the therapist_engine/ folder):
#   python3 -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
#   Then open http://localhost:8000/docs  (auto test page).
#
# >>> WHERE AWS PLUGS IN <<<  (search this file for "CONNECT AWS")
#   Every spot that will become an AWS service is marked with "# === CONNECT AWS".
#   Right now everything runs LOCALLY and FREE. See CONNECT_AWS.md for the guide.
# =============================================================================

import os
from pathlib import Path

import joblib
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from pydantic import BaseModel, Field

# The brain (Phase 1 + Phase 2).
from src.models.patient import PatientProfile
from src.models.therapist_rule import TherapistRule
from src.engines.conditional_bans import apply_conditional_bans
from src.models.risk_state import RiskState
from src.models.enums import RiskLevel
from src.engines.orchestrator import process_moment
from src.engines.text_distress_detector import predict_distress
# The glasses' senses (Rekognition + Transcribe, AWS-ready).
from perception.vision import analyze_image
from perception.audio import analyze_audio

BASE = Path(__file__).parent.parent  # the therapist_engine/ folder


# -----------------------------------------------------------------------------
# CONFIG (reads from environment / .env). Local + free by default.
# === CONNECT AWS: set USE_AWS=true and fill these once your AWS is ready. ===
# -----------------------------------------------------------------------------
USE_AWS = os.getenv("USE_AWS", "false").lower() == "true"
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
# Table names (used only when USE_AWS is true). Defaults point at the REAL
# tables (not the old accidental ptsd_clinical_profile/ptsd_therapist_rules
# ones - see PROJECT_COMPLETION_CHECKLIST.md / the root docs for why those
# must never be used).
DDB_PROFILE_TABLE = os.getenv("DDB_PROFILE_TABLE", "CompanioClinicalProfiles")
DDB_RULES_TABLE = os.getenv("DDB_RULES_TABLE", "CompanioTherapistRules")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "")


app = FastAPI(title="Companio API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# LOAD THE TRAINED ML MODELS (once, at startup). Graceful if a file is missing.
# -----------------------------------------------------------------------------
def _safe_load(path):
    try:
        return joblib.load(path)
    except Exception:
        return None

RECOMMENDER = _safe_load(BASE / "ml" / "recommender_model.joblib")          # text -> stage
# The distress detector (text -> stress?) is the fine-tuned DistilBERT model,
# loaded lazily by src/engines/text_distress_detector.py - the actual best of
# the 3 trained approaches, not the TF-IDF stand-in this used to load.
# TF-IDF and MiniLM are archived (not deleted) in ml/archived_weaker_models/ -
# see that folder's README for the real numbers and how to bring one back.

# The (archived) comparison approaches, for the app's "model comparison"
# screen. Only DistilBERT is live; the other two are historical reference.
MODEL_SCORES = [
    {"approach": "TF-IDF + LogisticRegression", "accuracy": 0.678, "f1": 0.714, "roc_auc": 0.766, "note": "archived — fast, self-contained"},
    {"approach": "Sentence embeddings (MiniLM)", "accuracy": 0.732, "f1": 0.715, "roc_auc": 0.831, "note": "archived — better meaning"},
    {"approach": "Fine-tuned DistilBERT", "accuracy": 0.785, "f1": 0.788, "roc_auc": 0.857, "note": "live — best, actually wired into /api/detect"},
]


# -----------------------------------------------------------------------------
# DATA STORE.  Local dicts now.  === CONNECT AWS: replace with DynamoDB reads. ===
# -----------------------------------------------------------------------------
PROFILES = {
    "P-001": PatientProfile(
        patient_id="P-001",
        known_triggers=["crowd", "loud bangs"],
        approved_interventions=["offer calm mode", "breathing prompt"],
        forbidden_interventions=["flashing lights"],
        communication_preferences=["short sentences"],
        physiological_baseline={"resting_hr": 68.0},
    )
}
RULES = {
    "P-001": [
        TherapistRule(
            rule_id="TR-001", patient_id="P-001", min_risk_level=RiskLevel.HIGH,
            trigger_conditions=["crowd"], approved_action="offer calm mode",
            priority=10, created_by="therapist:T-007",
        )
    ]
}

# Demo roster for the THERAPIST dashboard (a list of patients, not just one).
# === CONNECT AWS: this list would come from a DynamoDB query of the therapist's patients. ===
PATIENT_ROSTER = [
    {"patient_id": "P-001", "name": "Ava T.", "age": 19, "risk": "low", "status": "Stable", "last": "Anxiety spike - yesterday"},
    {"patient_id": "P-002", "name": "Sam R.", "age": 34, "risk": "elevated", "status": "Monitored", "last": "Sleep disturbance - today"},
    {"patient_id": "P-003", "name": "Maya L.", "age": 27, "risk": "high", "status": "Needs review", "last": "Flashback episode - 2h ago"},
    {"patient_id": "P-004", "name": "Jon D.", "age": 41, "risk": "low", "status": "Stable", "last": "Grounding used - 3d ago"},
    {"patient_id": "P-005", "name": "Nadia K.", "age": 23, "risk": "elevated", "status": "Monitored", "last": "Crowd trigger - this morning"},
]

# A running log of decisions (so the demo can show the "Decisions table" grow).
DECISION_LOG = []


# DynamoDB is created lazily; boto3 reads credentials from the environment / aws
# config — this code NEVER hardcodes secrets. All reads fall back to the local
# dicts on any error, so the demo never breaks if a table isn't ready.
_ddb = None
def _ddb_table(name):
    global _ddb
    if _ddb is None:
        import boto3
        _ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
    return _ddb.Table(name)

def _f(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default

def get_profile(pid: str):
    # === CONNECT AWS: reads the patient's row from DynamoDB when USE_AWS=true. ===
    if USE_AWS:
        try:
            item = _ddb_table(DDB_PROFILE_TABLE).get_item(Key={"patient_id": pid}).get("Item")
            if item:
                base = {k: _f(v) for k, v in (item.get("physiological_baseline") or {}).items()}
                return PatientProfile(
                    patient_id=item["patient_id"],
                    known_triggers=list(item.get("known_triggers", [])),
                    approved_interventions=list(item.get("approved_interventions", [])),
                    forbidden_interventions=list(item.get("forbidden_interventions", [])),
                    communication_preferences=list(item.get("communication_preferences", [])),
                    physiological_baseline=base,
                )
        except Exception:
            pass  # fall back to local
    return PROFILES.get(pid)

def get_rules(pid: str):
    # === CONNECT AWS: queries the rules table for this patient when USE_AWS=true. ===
    if USE_AWS:
        try:
            from boto3.dynamodb.conditions import Key
            items = _ddb_table(DDB_RULES_TABLE).query(KeyConditionExpression=Key("patient_id").eq(pid)).get("Items", [])
            rules = []
            for it in items:
                rules.append(TherapistRule(
                    rule_id=it["rule_id"], patient_id=it["patient_id"],
                    min_risk_level=RiskLevel(str(it.get("min_risk_level", "high")).lower()),
                    trigger_conditions=list(it.get("trigger_conditions", [])),
                    approved_action=it.get("approved_action", ""),
                    priority=int(_f(it.get("priority", 0))),
                    created_by=it.get("created_by", "therapist"),
                ))
            if rules:
                return rules
        except Exception:
            pass  # fall back to local
    return RULES.get(pid, [])


# --- Load the VA knowledge base + a simple search index (RAG) ---------------
_KB_RECORDS, _KB_VECTORIZER, _KB_MATRIX = [], None, None
def _load_knowledge():
    global _KB_RECORDS, _KB_VECTORIZER, _KB_MATRIX
    import json
    from sklearn.feature_extraction.text import TfidfVectorizer
    kb_file = BASE / "knowledge" / "va_knowledge.json"
    if not kb_file.exists():
        return
    _KB_RECORDS = json.loads(kb_file.read_text())
    texts = [f"{r.get('title','')} {r.get('structured_interpretation','')} {r.get('exact_source_text','')}"
             for r in _KB_RECORDS]
    _KB_VECTORIZER = TfidfVectorizer(stop_words="english")
    _KB_MATRIX = _KB_VECTORIZER.fit_transform(texts)
_load_knowledge()


# =============================================================================
# REQUEST SHAPES
# =============================================================================
class HistoryEntry(BaseModel):
    action: str
    reward: int   # 1 = risk went down afterward, 0 = it didn't

class RuleIn(BaseModel):
    """The caller's own copy of one therapist rule.

    Same reasoning as ProfileIn. get_rules() reads DynamoDB only when USE_AWS
    is true, and it defaults to false -- so for a real Cognito patient it fell
    through to the local in-memory RULES dict, which holds only the built-in
    demo patients. The effect was severe and silent: every trace reported
    "Checked 0 stored rule(s)", no therapist rule could ever match for a real
    patient, and known triggers a clinician had written an explicit rule for
    were handled by the ML reasoner instead. The deterministic, clinician-
    authored layer that is meant to OUTRANK the models was effectively dead.

    The mobile app already fetches these through the Lambda under the signed-in
    user's JWT, so passing them through restores rule-first behaviour without
    this engine needing AWS credentials of its own.
    """
    rule_id: str
    patient_id: str
    min_risk_level: Optional[RiskLevel] = None
    trigger_conditions: list[str] = Field(default_factory=list)
    approved_action: str
    forbidden_actions: list[str] = Field(default_factory=list)
    priority: int = 0
    active: bool = True
    version: int = 1


class ProfileIn(BaseModel):
    """The caller's own copy of the patient's clinical profile.

    The mobile app already fetches this from DynamoDB through the Lambda
    (GET /clinical-profile/{id}) using the signed-in user's Cognito JWT. Letting
    it pass that profile through means this engine can reason about a REAL
    patient without needing its own AWS credentials on the machine it runs on.
    Without this, get_profile() only ever knew the built-in demo patient and
    every real patient 404'd -- which silently pushed the app onto the AWS
    safe_fallback path, so the same canned line came back every single time and
    the AI reasoner never actually ran.
    """
    known_triggers: list[str] = []
    # Situational bans: {action, condition_type, value, reason}. Kept separate
    # from forbidden_interventions so an absolute ban stays absolute.
    conditional_forbidden: list[dict] = []
    approved_interventions: list[str] = []
    forbidden_interventions: list[str] = []
    communication_preferences: list[str] = []
    physiological_baseline: dict = {}


class MomentIn(BaseModel):
    patient_id: str = "P-001"
    risk_level: RiskLevel = RiskLevel.HIGH
    risk_score: float = 0.72
    observed_triggers: list[str] = []
    mode: str = "ai"          # "ai" or "rules_only"
    transcript: str = ""     # what the patient said, if anything (from Transcribe)
    intervention_history: list[HistoryEntry] = []  # this patient's past outcomes, for the bandit
    profile: Optional[ProfileIn] = None   # caller-supplied real profile (see ProfileIn)
    exclude_actions: list[str] = []    # interventions already tried that did NOT help
    # Therapist rules supplied by the caller; used only when this engine has
    # none of its own for this patient (see RuleIn).
    rules: Optional[list[RuleIn]] = None
    # Context the patient declared, e.g. ["exercise"], used by conditional bans.
    declared_context: list[str] = []

class TextIn(BaseModel):
    text: str

class ObserveIn(BaseModel):
    demo_scene: str = "crowd"       # what the camera "sees" (offline demo hint)
    demo_transcript: str = ""       # what the patient "says" (offline demo hint)
    demo_noise: str = "low"         # surroundings loudness (offline demo hint)
    image_b64: str = ""             # REAL camera frame (base64) -> AWS Rekognition when USE_AWS=true


# =============================================================================
# ENDPOINTS  (the "menu" the app can call)
# =============================================================================
@app.get("/")
def health():
    return {"status": "ok", "service": "tatainaamazonchatn API", "aws": USE_AWS,
            "detector_loaded": globals().get("DETECTOR") is not None,
            "recommender_loaded": globals().get("RECOMMENDER") is not None,
            "knowledge_records": len(_KB_RECORDS)}

@app.get("/api/patient/{pid}")
def patient(pid: str):
    prof = get_profile(pid)
    if prof is None:
        raise HTTPException(404, "unknown patient")
    # SAFE VIEW: never dump identity. === CONNECT AWS: name would come from the
    # separate Identity table (Cognito-linked), not this clinical record. ===
    return {"patient_id": pid, "display_name": "Ava",
            "known_triggers": prof.known_triggers,
            "approved_interventions": prof.approved_interventions}

@app.get("/api/patients")
def patients():
    # The therapist's whole caseload (for the dashboard).
    return PATIENT_ROSTER

@app.get("/api/database")
def database():
    # Shows how the data is stored - PRIVACY-SEPARATED tables.
    # === CONNECT AWS: each of these becomes a DynamoDB table. ===
    n = len(PATIENT_ROSTER)
    return {
        "privacy": "Identity is walled off from clinical data. Clinical tables use only the codename (P-001); only the Identity table maps P-001 to a real person.",
        "tables": [
            {"name": "Identity", "key": "internal_patient_id", "records": n, "note": "name + email live ONLY here", "sample": "P-001 -> Ava T. (cognito-abc-123)"},
            {"name": "Clinical profile", "key": "patient_id", "records": n, "note": "codename only - NO name/email", "sample": "P-001: triggers=[crowd, loud bangs]"},
            {"name": "Therapist rules", "key": "patient_id", "records": sum(len(v) for v in RULES.values()), "note": "the AI cannot override these", "sample": "TR-001: risk>=high & crowd -> calm mode"},
            {"name": "Decisions", "key": "patient_id", "records": len(DECISION_LOG), "note": "logs WHO decided + WHY", "sample": "source=therapist_rule"},
            {"name": "Knowledge (VA)", "key": "knowledge_id", "records": len(_KB_RECORDS), "note": "general PTSD evidence - not tied to a person", "sample": "Ketamine for PTSD (VA trial)"},
        ],
    }

@app.get("/api/patient/{pid}/detail")
def patient_detail(pid: str):
    # The full THERAPIST WORKSPACE for one patient (everything in the design PDF).
    prof = get_profile(pid) or PROFILES["P-001"]
    rec = next((p for p in PATIENT_ROSTER if p["patient_id"] == pid), PATIENT_ROSTER[0])
    return {
        "patient_id": pid, "name": rec["name"], "age": rec.get("age"),
        "risk": rec.get("risk"), "status": rec.get("status"),
        "overview": {
            "progress": "Improving - sleep and stress trending better",
            "last_session": "Aug 22 - crowd exposure + grounding",
            "goals": ["Reduce avoidance of public spaces", "Consistent sleep routine", "Daily grounding practice"],
        },
        "sessions": [
            {"date": "Aug 22", "type": "CBT", "note": "Practiced grounding for crowds"},
            {"date": "Aug 8", "type": "Check-in", "note": "Medication adherence good"},
        ],
        "assessments": [
            {"name": "PHQ-9", "score": 8, "band": "mild"},
            {"name": "GAD-7", "score": 11, "band": "moderate"},
            {"name": "PSS", "score": 18, "band": "moderate"},
        ],
        "treatment_plan": {
            "approved_interventions": prof.approved_interventions,
            "forbidden_interventions": prof.forbidden_interventions,
            "known_triggers": prof.known_triggers,
            "communication_preferences": prof.communication_preferences,
        },
        "risk_signals": {
            "window_seconds": 30, "distress_score": 0.34, "support_level": "low",
            "contributing": ["hr near baseline", "eda stable"],
            "note": "Physiological distress - not a PTSD diagnosis.",
        },
        "rules": [r.model_dump(mode="json") for r in get_rules(pid)],
        "documents": ["Treatment plan.pdf", "GAD-7 results.pdf", "Grounding worksheet.pdf"],
        "audit": [
            {"when": "Aug 20", "who": "therapist:T-007", "change": "Added rule TR-001 (crowd -> calm mode)"},
            {"when": "Aug 22", "who": "system", "change": "Decision logged: therapist_rule -> offer calm mode"},
        ],
    }

@app.post("/api/decide")
def decide(m: MomentIn):
    prof = get_profile(m.patient_id)

    # Fall back to the profile the caller supplied (see ProfileIn). This is
    # the patient's REAL clinical profile, fetched by the app from DynamoDB
    # under their own Cognito identity -- not invented here.
    if prof is None and m.profile is not None:
        prof = PatientProfile(
            patient_id=m.patient_id,
            known_triggers=list(m.profile.known_triggers),
            approved_interventions=list(m.profile.approved_interventions),
            forbidden_interventions=list(m.profile.forbidden_interventions),
            communication_preferences=list(m.profile.communication_preferences),
            physiological_baseline=dict(m.profile.physiological_baseline or {}),
        )

    if prof is None:
        raise HTTPException(404, "unknown patient")

    # Anything the patient has already told us did NOT help is treated exactly
    # like a forbidden intervention for THIS moment, so the reasoner is forced
    # to propose something different instead of repeating a failed suggestion.
    # It must ALSO leave the approved list, not just join the forbidden one:
    # a failed action still present in approved could be picked by the bandit,
    # vetoed by the forbidden guardrail, and the whole proposal abandoned --
    # escalating while untried approved options remained. Every approved
    # option gets its turn before the engine gives up on the list.
    if m.exclude_actions:
        tried = {str(a).strip().lower() for a in m.exclude_actions}
        prof = prof.model_copy(update={
            "approved_interventions": [
                a for a in prof.approved_interventions
                if str(a).strip().lower() not in tried
            ],
            "forbidden_interventions": list(prof.forbidden_interventions) + list(m.exclude_actions),
        })

    risk = RiskState(patient_id=m.patient_id, risk_score=m.risk_score,
                     risk_level=m.risk_level, confidence=0.85)

    rules = get_rules(m.patient_id)
    # Fall back to the caller's rules exactly as the profile falls back above.
    # Without this the therapist-rule layer never fires for a real patient.
    if not rules and m.rules:
        rules = [
            TherapistRule(
                rule_id=r.rule_id, patient_id=r.patient_id,
                min_risk_level=r.min_risk_level, trigger_conditions=list(r.trigger_conditions),
                approved_action=r.approved_action, forbidden_actions=list(r.forbidden_actions),
                priority=r.priority, active=r.active, version=r.version,
            )
            for r in m.rules
        ]
    # Situational bans are resolved against THIS moment, then the narrowed list
    # is what every downstream layer sees -- so a rule, the recommender and the
    # bandit are all working from the same set.
    conditional = list((m.profile.conditional_forbidden if m.profile else None) or [])
    if conditional:
        moment_ctx = {
            "risk_level": getattr(risk.risk_level, "value", str(risk.risk_level)),
            "observed_triggers": m.observed_triggers,
            "declared_context": m.declared_context or [],
            "already_tried": m.exclude_actions or [],
        }
        allowed, blocked_now = apply_conditional_bans(
            prof.approved_interventions, conditional, moment_ctx)
        prof = prof.model_copy(update={
            "approved_interventions": allowed,
            "forbidden_interventions": list(prof.forbidden_interventions)
                                       + [b["action"] for b in blocked_now],
        })
    else:
        blocked_now = []

    out = process_moment(m.patient_id, prof, rules, risk,
                         m.observed_triggers, mode=m.mode, transcript=m.transcript,
                         intervention_history=[h.model_dump() for h in m.intervention_history],
                         already_tried=list(m.exclude_actions or []))

    # --- Live trace -----------------------------------------------------------
    # A step-by-step account of what each layer of the hierarchy ACTUALLY did on
    # this request, so the app can show the reasoning as it happened rather than
    # only the final sentence. Every entry is derived from real state (the rules
    # that were loaded, the decision that came back, its own reason_code) --
    # nothing here is a scripted narration.
    d = out["decision"]
    src = getattr(d.decision_source, "value", str(d.decision_source))
    reason = d.reason_code or ""
    trace = []

    trace.append({
        "step": "Therapist rules",
        "detail": f"Checked {len(rules)} stored rule(s) for this patient.",
        "result": ("Matched — using it exactly, no model consulted."
                   if src == "therapist_rule" else "No rule covered this situation."),
        "hit": src == "therapist_rule",
    })

    if src != "therapist_rule":
        if m.mode == "rules_only":
            trace.append({"step": "AI reasoning", "detail": "Skipped — rules-only mode.",
                          "result": "Not consulted.", "hit": False})
        else:
            gated = "distress gate" in reason.lower()
            trace.append({
                "step": "Distress gate (DistilBERT)",
                "detail": "Runs when free text is the only signal.",
                "result": ("Text did not sound distressed — no intervention forced."
                           if gated else "Passed through to the recommender."),
                "hit": not gated,
            })
            stage = None
            if "predicted" in reason:
                for word in ("EXPLORE", "COMFORT", "ACT"):
                    if word in reason.upper():
                        stage = word
                        break
            trace.append({
                "step": "Support-stage recommender",
                "detail": "Chooses the kind of support that fits this moment.",
                "result": f"Predicted {stage}." if stage else "Did not reach a stage.",
                "hit": stage is not None,
            })
            trace.append({
                "step": "Intervention bandit",
                "detail": f"Weighs {len(prof.approved_interventions)} approved option(s) against this patient's own outcome history.",
                "result": (f"Selected \u201c{d.selected_action}\u201d."
                           if "bandit" in reason.lower() else
                           (f"Selected \u201c{d.selected_action}\u201d." if d.selected_action else "No option available.")),
                "hit": bool(d.selected_action),
            })
        trace.append({
            "step": "Safety filter",
            "detail": "Deterministic phrase blocking. Fails closed.",
            "result": ("Blocked the wording — replaced with the safe line."
                       if src == "safe_fallback" and "block" in reason.lower()
                       else "Passed — nothing unsafe detected."),
            "hit": True,
        })

    if m.exclude_actions:
        trace.insert(1, {
            "step": "Already tried",
            "detail": "Interventions the patient said did not help.",
            "result": ", ".join(m.exclude_actions) + " — excluded from this decision.",
            "hit": True,
        })

    DECISION_LOG.append(out["decision"])   # === CONNECT AWS: write this row to DynamoDB ===
    DECISION_LOG.append(out["decision"])   # === CONNECT AWS: write this row to DynamoDB ===
    return {"decision": out["decision"].model_dump(mode="json"),
            "spoken_message": out["spoken_message"],
            "trace": trace,
            # Which situational bans fired for this moment, so the therapist can
            # see that an intervention was withheld and why.
            "blocked_by_condition": blocked_now}

@app.post("/api/detect")
def detect(t: TextIn):
    # Your OWN fine-tuned DistilBERT detector (Dreaddit, PTSD+anxiety) - the
    # best of the 3 trained approaches, loaded lazily on first call.
    label = predict_distress(t.text)
    if label is None:
        raise HTTPException(503, "detector model not loaded (run ml/detector_bert/train.py)")
    return {"text": t.text, "distress": label}

@app.post("/api/recommend")
def recommend(t: TextIn):
    # Your OWN trained support-stage recommender (ESConv). Advisory only.
    if RECOMMENDER is None:
        raise HTTPException(503, "recommender model not loaded")
    stage = str(RECOMMENDER.predict([t.text])[0])
    return {"text": t.text, "recommended_stage": stage,
            "note": "advisory only; therapist rules + safety still decide"}

@app.get("/api/knowledge")
def knowledge(q: str, k: int = 3):
    # RAG retrieval over the real VA PTSD Repository.
    # === CONNECT AWS: swap for a Bedrock Knowledge Base query for scale. ===
    if _KB_VECTORIZER is None:
        raise HTTPException(503, "knowledge base not loaded")
    from sklearn.metrics.pairwise import cosine_similarity
    scores = cosine_similarity(_KB_VECTORIZER.transform([q]), _KB_MATRIX)[0]
    top = scores.argsort()[::-1][:k]
    return [{"title": _KB_RECORDS[i].get("title"), "score": round(float(scores[i]), 3),
             "source": _KB_RECORDS[i].get("organization")} for i in top]

@app.get("/api/models")
def models():
    # For the app's "3 approaches" comparison screen.
    return {"task": "distress detection (Dreaddit, PTSD+anxiety)", "approaches": MODEL_SCORES}


# =============================================================================
# WATCH RISK MODEL
# =============================================================================
# The trained physiological model was not driving the live app at all: the
# mobile client scored distress with a hand-written heart-rate/HRV heuristic
# while the real model sat unused in the repository. It could not simply be
# plugged in, because 72.8% of the 16-feature model's importance comes from
# electrodermal activity and skin temperature, which an Apple Watch does not
# expose -- imputing that much of the input would have produced a model that
# ran but read almost nothing about the patient.
#
# risk_engine/train_model_watch.py therefore retrains the SAME architecture,
# personalisation and leave-one-subject-out protocol on only the features an
# Apple Watch can supply. This endpoint serves it, so the live app is driven by
# a trained model instead of a heuristic.
_WATCH_MODEL = None
_WATCH_MODEL_ERROR = None


def _load_watch_model():
    global _WATCH_MODEL, _WATCH_MODEL_ERROR
    if _WATCH_MODEL is not None or _WATCH_MODEL_ERROR is not None:
        return
    try:
        import joblib
        path = BASE.parent / "risk_engine" / "models" / "wesad_stress_model_watch.joblib"
        if not path.exists():
            _WATCH_MODEL_ERROR = f"model file not found at {path}"
            return
        _WATCH_MODEL = joblib.load(path)
    except Exception as exc:                      # pragma: no cover - env dependent
        _WATCH_MODEL_ERROR = f"{type(exc).__name__}: {exc}"


class WatchFeaturesIn(BaseModel):
    """One window of Apple Watch physiology, already z-scored against the
    patient's own calibrated baseline by the caller (same personalisation the
    model was trained with). Missing values are allowed and imputed."""
    heart_rate_mean: Optional[float] = None
    heart_rate_std: Optional[float] = None
    heart_rate_range: Optional[float] = None
    ibi_mean_seconds: Optional[float] = None
    sdnn_ms: Optional[float] = None
    rmssd_ms: Optional[float] = None
    acc_magnitude_mean: Optional[float] = None
    acc_magnitude_window_std: Optional[float] = None
    acc_magnitude_variability_mean: Optional[float] = None


@app.post("/api/risk/watch")
def risk_watch(f: WatchFeaturesIn):
    """Score one window with the trained Watch-compatible model."""
    _load_watch_model()
    if _WATCH_MODEL is None:
        # Fail loudly rather than silently returning a fabricated score. The
        # caller falls back to its own heuristic and SAYS that it did.
        raise HTTPException(503, f"watch risk model unavailable: {_WATCH_MODEL_ERROR}")

    import numpy as _np
    cols = _WATCH_MODEL["feature_columns"]
    vals = f.model_dump()
    X = _np.array([[vals.get(c) if vals.get(c) is not None else _np.nan for c in cols]], dtype=float)

    score = float(_WATCH_MODEL["model"].predict_proba(X)[0][1])
    # Same four-level vocabulary as RiskLevel, so nothing downstream has to
    # translate -- mismatched names were previously rejected outright.
    level = ("critical" if score >= 0.85 else
             "high" if score >= 0.60 else
             "elevated" if score >= 0.35 else "baseline")
    return {
        "risk_score": round(score, 4),
        "risk_level": level,
        "model": "wesad_watch_rf_v1",
        "features_used": cols,
        "loso_metrics": _WATCH_MODEL.get("loso_metrics"),
        "honest_note": _WATCH_MODEL.get("honest_note"),
    }


@app.get("/api/health/models")
def model_health():
    """Startup/liveness check for every model the decisions depend on.

    Without this, a missing artifact is only discovered during a real patient
    event, which is the worst possible moment to learn that a model did not
    load.
    """
    out = {}

    _load_watch_model()
    out["watch_risk_model"] = {"loaded": _WATCH_MODEL is not None, "error": _WATCH_MODEL_ERROR}

    try:
        from src.engines.text_distress_detector import predict_distress
        probe = predict_distress("I feel calm today")
        out["distress_detector"] = {"loaded": probe is not None,
                                    "error": None if probe is not None else "model returned None (torch/transformers or artifact missing)"}
    except Exception as exc:
        out["distress_detector"] = {"loaded": False, "error": f"{type(exc).__name__}: {exc}"}

    try:
        from src.engines.intervention_recommender import recommend_stage
        out["stage_recommender"] = {"loaded": recommend_stage("I am worried") is not None, "error": None}
    except Exception as exc:
        out["stage_recommender"] = {"loaded": False, "error": f"{type(exc).__name__}: {exc}"}

    try:
        from src.engines.intervention_bandit import choose_action
        choose_action(["a", "b"], [])
        out["intervention_bandit"] = {"loaded": True, "error": None}
    except Exception as exc:
        out["intervention_bandit"] = {"loaded": False, "error": f"{type(exc).__name__}: {exc}"}

    try:
        from src.engines.safety import make_safe
        out["safety_filter"] = {"loaded": make_safe("you are safe") is not None, "error": None}
    except Exception as exc:
        out["safety_filter"] = {"loaded": False, "error": f"{type(exc).__name__}: {exc}"}

    try:
        import sklearn
        out["sklearn_version"] = {"version": sklearn.__version__,
                                  "expected": "1.6.1",
                                  "matches": sklearn.__version__ == "1.6.1"}
    except Exception as exc:
        out["sklearn_version"] = {"version": None, "error": str(exc)}

    out["all_critical_ok"] = all(
        v.get("loaded") for k, v in out.items()
        if isinstance(v, dict) and "loaded" in v and k != "watch_risk_model"
    )
    return out


@app.post("/api/observe")
def observe(o: ObserveIn):
    # THE GLASSES' SENSES -> signals the engine can use.
    # Camera -> object labels (Rekognition).  Mic -> words + noise (Transcribe).
    vision = analyze_image(demo_scene=o.demo_scene)
    audio = analyze_audio(demo_transcript=o.demo_transcript, demo_noise=o.demo_noise)
    # If the patient spoke, run their words through YOUR distress detector.
    distress = None
    _det = globals().get("DETECTOR")
    if _det is not None and audio["transcript"].strip():
        distress = str(_det.predict([audio["transcript"]])[0])
    return {
        "observed_triggers": [vision["context"]] if vision["is_definite_trigger"] else [],
        "vision": vision,
        "transcript": audio["transcript"],
        "is_speaking": audio["is_speaking"],
        "noise_level": audio["noise_level"],
        "distress_from_words": distress,
    }


# Common veteran PTSD trigger objects the camera might see, each with WHY it can
# feel threatening + a calming response grounded in VA-recommended coping skills
# (paced breathing and the 5-4-3-2-1 grounding technique).
TRIGGER_LIBRARY = {
    "trash bag": {"why": "roadside objects can resemble a hidden threat for some veterans",
                  "message": "Let's ground together - name 5 things you can see, then 4 you can touch.",
                  "action": "offer calm mode"},
    "crowd": {"why": "crowded, unpredictable spaces can feel overwhelming",
              "message": "I'm here with you. Let's take one slow breath - in for 4, out for 6.",
              "action": "offer calm mode"},
    "fireworks": {"why": "sudden bangs can resemble gunfire",
                  "message": "That sound has passed. Breathe in for 4, hold, out for 6.",
                  "action": "breathing prompt"},
    "truck": {"why": "loud vehicles or backfires can startle",
              "message": "Feel your feet on the ground and breathe slowly.",
              "action": "breathing prompt"},
}


@app.post("/api/glasses/scan")
def glasses_scan(o: ObserveIn):
    # THE GLASSES SEE THE SURROUNDINGS -> is anything a known trigger? -> calm the patient.
    # If a real camera frame is sent AND AWS is on, Rekognition analyzes it for real;
    # otherwise we fall back to the labelled demo scene.
    import base64, os
    image_bytes = None
    if o.image_b64:
        try:
            image_bytes = base64.b64decode(o.image_b64)
        except Exception:
            image_bytes = None
    used_rekognition = bool(image_bytes) and os.getenv("USE_AWS", "false").lower() == "true"
    vision = analyze_image(image_bytes=image_bytes, demo_scene=o.demo_scene)
    source = "aws_rekognition" if used_rekognition else "demo"
    detected, info = None, None
    labels = vision.get("raw_labels", [])
    if vision.get("is_definite_trigger"):
        for lab in labels + [vision.get("context", "")]:
            for key, val in TRIGGER_LIBRARY.items():
                if key in lab.lower() or lab.lower() in key:
                    detected, info = key, val
                    break
            if detected:
                break
    if detected:
        return {
            "detected": detected,
            "is_trigger": True,
            "why": info["why"],
            "message": info["message"],       # the calming words the glasses speak
            "action": info["action"],
            "grounding_source": "VA-recommended coping: paced breathing + 5-4-3-2-1 grounding",
            "labels": labels,
            "context": vision,
            "source": source,
        }
    return {
        "detected": vision.get("context", "unknown"),
        "is_trigger": False,
        "message": "I'm here if you need support.",
        "labels": labels,
        "context": vision,
        "source": source,
    }
