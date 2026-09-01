import pytest

from src.engines.decision_engine import decide_from_rules
from src.engines.orchestrator import process_moment
from src.engines.safety import find_violations, make_safe, SAFE_FALLBACK_MESSAGE
from src.models.enums import RiskLevel, DecisionSource
from src.models.patient import PatientProfile
from src.models.risk_state import RiskState
from src.models.therapist_rule import TherapistRule
from perception.vision import analyze_image


def profile():
    return PatientProfile(
        patient_id="P-001",
        known_triggers=["crowd"],
        approved_interventions=["offer calm mode", "breathing prompt"],
        forbidden_interventions=["flashing lights"],
    )


def risk(level=RiskLevel.HIGH, score=0.8):
    return RiskState(patient_id="P-001", risk_score=score, risk_level=level, confidence=0.9)


def rule(rule_id="TR-001", priority=10, active=True, trigger="crowd", action="offer calm mode"):
    return TherapistRule(rule_id=rule_id, patient_id="P-001", min_risk_level=RiskLevel.HIGH,
                         trigger_conditions=[trigger], approved_action=action,
                         priority=priority, active=active, created_by="therapist:T-007")


def test_trigger_match_is_case_and_whitespace_insensitive():
    d = decide_from_rules("P-001", profile(), [rule(trigger=" Crowd ")], risk(), ["CROWD"])
    assert d.decision_source == DecisionSource.THERAPIST_RULE


def test_inactive_rule_never_fires():
    d = decide_from_rules("P-001", profile(), [rule(active=False)], risk(), ["crowd"])
    assert d.decision_source == DecisionSource.SAFE_FALLBACK


def test_highest_priority_wins():
    d = decide_from_rules("P-001", profile(), [rule("TR-LOW", 1), rule("TR-HIGH", 20)], risk(), ["crowd"])
    assert d.therapist_rule_id == "TR-HIGH"


def test_equal_priority_has_deterministic_rule_id_tiebreak():
    d = decide_from_rules("P-001", profile(), [rule("TR-B", 10), rule("TR-A", 10)], risk(), ["crowd"])
    assert d.therapist_rule_id == "TR-A"


def test_forbidden_rule_action_fails_closed():
    p = profile()
    p.approved_interventions.append("flashing lights")
    d = decide_from_rules("P-001", p, [rule(action="flashing lights")], risk(), ["crowd"])
    assert d.decision_source == DecisionSource.SAFE_FALLBACK
    assert "forbidden" in d.reason_code


def test_rules_only_no_match_never_runs_ai():
    out = process_moment("P-001", profile(), [rule()], risk(RiskLevel.ELEVATED, 0.55), ["argument"], mode="rules_only")
    assert out["decision"].decision_source == DecisionSource.SAFE_FALLBACK
    assert out["spoken_message"] == SAFE_FALLBACK_MESSAGE


def test_ai_offers_the_only_approved_action_even_without_a_keyword_match():
    # ai_reasoner.py used to only ever offer an action containing "calm" or
    # "breath" (a hardcoded keyword search) and abstained otherwise, even
    # when a perfectly good approved action existed. Now it uses a real
    # trained model (recommend_stage) to pick among WHATEVER the therapist
    # actually approved, so "call therapist" - a real ACT-style action with
    # no calming keyword in it - should be offered, not withheld.
    p = PatientProfile(patient_id="P-001", approved_interventions=["call therapist"])
    out = process_moment("P-001", p, [], risk(RiskLevel.ELEVATED, 0.55), ["argument"], mode="ai")
    assert out["decision"].decision_source == DecisionSource.AI_REASONING
    assert out["decision"].selected_action == "call therapist"


def test_ai_abstains_when_no_approved_interventions_at_all():
    # The ONLY case that should still fall back safely: there is nothing
    # approved to offer at all.
    p = PatientProfile(patient_id="P-001", approved_interventions=[])
    out = process_moment("P-001", p, [], risk(RiskLevel.ELEVATED, 0.55), ["argument"], mode="ai")
    assert out["decision"].decision_source == DecisionSource.SAFE_FALLBACK


@pytest.mark.parametrize("text,category", [
    ("YOU... ARE   SAFE", "false safety guarantee"),
    ("You are having a PANIC-ATTACK", "diagnosis language"),
    ("Please take your medication", "medication advice"),
    ("Nothing!!! can hurt you", "false safety guarantee"),
])
def test_safety_normalizes_obfuscation(text, category):
    assert category in find_violations(text)
    safe, problems = make_safe(text)
    assert safe == SAFE_FALLBACK_MESSAGE
    assert problems


def test_low_confidence_vision_becomes_unknown():
    result = analyze_image(demo_scene="uncertain")
    assert result["context"] == "unknown"
    assert result["is_definite_trigger"] is False


def test_vision_never_returns_identity_or_emotion_fields():
    result = analyze_image(demo_scene="crowd")
    assert "identity" not in result
    assert "emotion" not in result
