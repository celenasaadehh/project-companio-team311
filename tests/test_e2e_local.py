"""Local integration test: sensor window -> risk response shape -> bridge -> therapist decision.
No AWS/database/network required.
"""
from pathlib import Path
import importlib.util
import sys

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RISK = ROOT / "risk_engine"
THERAPIST = ROOT / "therapist_engine"

# Load risk feature module without colliding with therapist_engine's top-level src package.
spec = importlib.util.spec_from_file_location("risk_features", RISK / "src" / "features.py")
risk_features = importlib.util.module_from_spec(spec)
spec.loader.exec_module(risk_features)

saved = joblib.load(RISK / "models" / "wesad_stress_model.joblib")
model = saved["model"]
for _, step in getattr(model, "steps", []):
    if step.__class__.__name__ == "SimpleImputer" and not hasattr(step, "_fill_dtype") and hasattr(step, "_fit_dtype"):
        step._fill_dtype = step._fit_dtype

sys.path.insert(0, str(THERAPIST))
from src.engines.risk_bridge import distress_response_to_risk_state
from src.engines.orchestrator import process_moment
from src.models.patient import PatientProfile
from src.models.therapist_rule import TherapistRule
from src.models.enums import RiskLevel, DecisionSource


def test_sensor_window_to_auditable_decision():
    frame = pd.DataFrame({
        "heart_rate": [96 + (i % 3) for i in range(30)],
        "eda": [4.0 + 0.03 * i for i in range(30)],
        "temperature": [33.8 + 0.005 * i for i in range(30)],
        "acc_magnitude_mean": [1.5 + 0.02 * (i % 4) for i in range(30)],
        "acc_magnitude_std": [0.25] * 30,
        "ibi_mean_seconds": [0.64 + 0.005 * (i % 3) for i in range(30)],
    })
    features = risk_features.extract_window_features(frame)
    assert list(features) == list(saved["feature_columns"])
    X = pd.DataFrame([features], columns=saved["feature_columns"])
    score = float(model.predict_proba(X)[0, 1])
    support = "high" if score >= 0.70 else "elevated" if score >= 0.40 else "low"
    risk_response = {
        "physiological_distress_score": score,
        "support_level": support,
        "model_pattern": "stress-like" if int(model.predict(X)[0]) else "baseline-like",
        "action": "prominent_grounding_offer" if support == "high" else "offer_grounding" if support == "elevated" else "no_grounding_prompt",
    }
    risk_state = distress_response_to_risk_state(risk_response, "P-001")

    profile = PatientProfile(patient_id="P-001", approved_interventions=["offer calm mode", "breathing prompt"], forbidden_interventions=["flashing lights"])
    rules = [TherapistRule(rule_id="TR-001", patient_id="P-001", min_risk_level=RiskLevel.BASELINE,
                           trigger_conditions=["crowd"], approved_action="offer calm mode", priority=10,
                           created_by="therapist:T-007")]
    out = process_moment("P-001", profile, rules, risk_state, ["crowd"], mode="ai")
    decision = out["decision"]
    assert decision.patient_id == "P-001"
    assert decision.decision_source == DecisionSource.THERAPIST_RULE
    assert decision.therapist_rule_id == "TR-001"
    assert decision.selected_action == "offer calm mode"
    assert decision.risk_score == risk_state.risk_score
    assert decision.reason_code
    assert out["spoken_message"]
