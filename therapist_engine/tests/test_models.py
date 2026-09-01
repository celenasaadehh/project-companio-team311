# =============================================================================
# tests/test_models.py
# -----------------------------------------------------------------------------
# These are AUTOMATED TESTS. Each one creates a model with either GOOD or BAD
# data and checks that the model behaves correctly (accepts the good, REJECTS
# the bad). Run them all with:
#
#     python3 -m pytest -q
#
# WHY tests matter: they PROVE our safety rules actually work, and they keep
# working forever. If someone later breaks a rule by accident, a test goes red.
# =============================================================================

# pytest: the test-runner tool. "raises" lets us say "we EXPECT this to error".
import pytest

# ValidationError is the specific error Pydantic throws when data breaks a rule.
# We import it so our tests can check "yes, THAT is the error we expected".
from pydantic import ValidationError

# The models we are testing.
from src.models.identity import IdentityRecord
from src.models.patient import PatientProfile
from src.models.therapist_rule import TherapistRule
from src.models.sensor_event import SensorEvent
from src.models.risk_state import RiskState
from src.models.knowledge_record import KnowledgeRecord
from src.models.decision import Decision
from src.models.enums import (
    AccountRole, SensorType, RiskLevel, SourceType, ReviewStatus, DecisionSource,
)


# =============================================================================
# GROUP A — RiskState: the score and confidence MUST stay within 0..1
# =============================================================================

def test_risk_score_below_zero_is_rejected():
    # A risk score of -0.1 is impossible (scores are 0..1). Expect rejection.
    with pytest.raises(ValidationError):
        RiskState(patient_id="P-001", risk_score=-0.1,
                  risk_level=RiskLevel.HIGH, confidence=0.9)


def test_risk_score_above_one_is_rejected():
    # A risk score of 1.5 is impossible. Expect rejection.
    with pytest.raises(ValidationError):
        RiskState(patient_id="P-001", risk_score=1.5,
                  risk_level=RiskLevel.HIGH, confidence=0.9)


def test_confidence_below_zero_is_rejected():
    # Confidence must also be 0..1. -0.2 should be rejected.
    with pytest.raises(ValidationError):
        RiskState(patient_id="P-001", risk_score=0.5,
                  risk_level=RiskLevel.HIGH, confidence=-0.2)


def test_confidence_above_one_is_rejected():
    # Confidence of 2.0 is out of range. Expect rejection.
    with pytest.raises(ValidationError):
        RiskState(patient_id="P-001", risk_score=0.5,
                  risk_level=RiskLevel.HIGH, confidence=2.0)


def test_valid_risk_state_is_accepted():
    # A well-formed RiskState should be created with NO error.
    rs = RiskState(patient_id="P-001", risk_score=0.72,
                   risk_level=RiskLevel.HIGH, confidence=0.85)
    assert rs.risk_score == 0.72
    assert rs.risk_level == RiskLevel.HIGH


# =============================================================================
# GROUP B — Missing required fields
# =============================================================================

def test_missing_patient_id_is_rejected():
    # patient_id is required on PatientProfile. Leaving it out should error.
    with pytest.raises(ValidationError):
        PatientProfile()  # no patient_id given


def test_missing_decision_source_is_rejected():
    # Every Decision MUST declare which authority produced it.
    with pytest.raises(ValidationError):
        Decision(patient_id="P-001", selected_action="x",
                 confidence=0.5, reason_code="y")  # decision_source missing


# =============================================================================
# GROUP C — KnowledgeRecord: URL must be valid; source text is required
# =============================================================================

def test_malformed_source_url_is_rejected():
    # "not a url" is not a valid web address. HttpUrl should reject it.
    with pytest.raises(ValidationError):
        KnowledgeRecord(knowledge_id="K-1", organization="VA", title="t",
                        url="not a url", source_type=SourceType.FACT_SHEET,
                        exact_source_text="...")


def test_missing_exact_source_text_is_rejected():
    # A knowledge record with no source text has no proof behind it -> rejected.
    with pytest.raises(ValidationError):
        KnowledgeRecord(knowledge_id="K-1", organization="VA", title="t",
                        url="https://www.ptsd.va.gov/",
                        source_type=SourceType.FACT_SHEET)  # no exact_source_text


def test_valid_knowledge_record_defaults_to_pending_review():
    # A brand-new knowledge record should be "pending" until a human approves it.
    k = KnowledgeRecord(knowledge_id="K-1", organization="VA", title="t",
                        url="https://www.ptsd.va.gov/",
                        source_type=SourceType.FACT_SHEET,
                        exact_source_text="PTSD is a mental health problem.")
    assert k.review_status == ReviewStatus.PENDING


# =============================================================================
# GROUP D — Enums: only the allowed menu values are accepted
# =============================================================================

def test_unsupported_sensor_type_is_rejected():
    # "smell" is not a real SensorType. Expect rejection.
    with pytest.raises(ValidationError):
        SensorEvent(patient_id="P-001", sensor_type="smell", value=1.0)


def test_unsupported_risk_level_is_rejected():
    # "panic_attack" is not a RiskLevel (and would be a diagnosis, not a level).
    with pytest.raises(ValidationError):
        RiskState(patient_id="P-001", risk_score=0.5,
                  risk_level="panic_attack", confidence=0.9)


def test_unsupported_decision_source_is_rejected():
    # "vibes" is not a valid DecisionSource. Expect rejection.
    with pytest.raises(ValidationError):
        Decision(patient_id="P-001", decision_source="vibes",
                 selected_action="x", confidence=0.5, reason_code="y")


# =============================================================================
# GROUP E — Safety defaults behave as designed
# =============================================================================

def test_ai_override_defaults_to_false():
    # If a therapist does not set it, the AI must NOT be allowed to override.
    rule = TherapistRule(rule_id="TR-1", patient_id="P-001",
                         approved_action="offer calm mode")
    assert rule.ai_override_allowed is False


def test_sensor_event_auto_generates_id():
    # We never typed an event_id, so it must be auto-generated and start "E-".
    e = SensorEvent(patient_id="P-001", sensor_type=SensorType.HEART_RATE, value=120.0)
    assert e.event_id.startswith("E-")


def test_sensor_value_accepts_number_or_word():
    # value is Union[float, str]: a heart rate (number) AND a camera label (word)
    # are both valid in the same box.
    hr = SensorEvent(patient_id="P-001", sensor_type=SensorType.HEART_RATE, value=120.0)
    cam = SensorEvent(patient_id="P-001", sensor_type=SensorType.VISUAL_SCENE, value="trash_bag")
    assert hr.value == 120.0
    assert cam.value == "trash_bag"


def test_identity_rejects_bad_email():
    # The one form that holds an email must reject an invalid one.
    with pytest.raises(ValidationError):
        IdentityRecord(internal_patient_id="P-001", cognito_user_id="x",
                       email="not-an-email")
