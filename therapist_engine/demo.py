# =============================================================================
# demo.py
# -----------------------------------------------------------------------------
# This is a little "show me it works" script. It is NOT part of the real system.
# It just creates some fictional records and PRINTS them, so YOU can run it and
# watch the forms (models) come alive with your own eyes.
#
# HOW TO RUN IT:
#   Option A: open this file in VS Code and click the > (Run) button, top-right.
#   Option B: in a terminal, run:   python3 demo.py
# =============================================================================

# Borrow the forms we already built.
from src.models.identity import IdentityRecord
from src.models.patient import PatientProfile
from src.models.therapist_rule import TherapistRule
from src.models.enums import AccountRole, RiskLevel


# A tiny helper so the printout has clear section headings.
def header(title):
    print("\n" + "=" * 60)
    print(title)
    print("=" * 60)


# -----------------------------------------------------------------------------
header("1) IDENTITY RECORD  (the ONE place the real name lives)")
# -----------------------------------------------------------------------------
ava_identity = IdentityRecord(
    internal_patient_id="P-001",
    cognito_user_id="cognito-abc-123",
    display_name="Ava",                 # fictional
    email="ava@example.com",            # fictional
    role=AccountRole.PATIENT,
)
print("codename (internal id):", ava_identity.internal_patient_id)
print("real name             :", ava_identity.display_name)
print("email                 :", ava_identity.email)
print("role                  :", ava_identity.role.value)
print("created_at (auto)     :", ava_identity.created_at)


# -----------------------------------------------------------------------------
header("2) PATIENT PROFILE  (clinical - knows the person ONLY as P-001)")
# -----------------------------------------------------------------------------
ava_profile = PatientProfile(
    patient_id="P-001",                 # SAME codename, but NO name here
    known_triggers=["crowds", "loud bangs"],
    approved_interventions=["calm mode", "breathing prompt"],
    forbidden_interventions=["flashing lights"],
    physiological_baseline={"resting_hr": 68.0},
)
print("patient_id           :", ava_profile.patient_id)
print("triggers             :", ava_profile.known_triggers)
print("approved interventions:", ava_profile.approved_interventions)
print("forbidden            :", ava_profile.forbidden_interventions)
print("baseline             :", ava_profile.physiological_baseline)
print("NOTICE: there is no name or email in this clinical form. Privacy by design.")


# -----------------------------------------------------------------------------
header("3) THERAPIST RULE  (highest authority; AI cannot override by default)")
# -----------------------------------------------------------------------------
rule = TherapistRule(
    rule_id="TR-001",
    patient_id="P-001",
    min_risk_level=RiskLevel.HIGH,       # the RISK part of the condition
    trigger_conditions=["crowd"],        # the TRIGGER part of the condition
    approved_action="offer calm mode",
    forbidden_actions=["auto-alert caregiver"],
    priority=10,
    created_by="therapist:T-007",
)
print("rule_id             :", rule.rule_id)
print("for patient         :", rule.patient_id)
print("fires when risk >=  :", rule.min_risk_level.value)
print("AND trigger is one of:", rule.trigger_conditions)
print("approved action     :", rule.approved_action)
print("active (default)    :", rule.active, "  <- rule is ON by default")
print("version (default)   :", rule.version)
print("ai_override_allowed :", rule.ai_override_allowed, "  <- SAFE DEFAULT: AI may NOT override the therapist")


# -----------------------------------------------------------------------------
header("4) THE RECEPTIONIST AT WORK  (bad data gets REJECTED)")
# -----------------------------------------------------------------------------
print("Trying to create a profile where a trigger is a NUMBER (123)...")
try:
    PatientProfile(patient_id="P-002", known_triggers=[123])
except Exception as e:
    first_problem = str(e).splitlines()[2].strip()
    print("  -> REJECTED. Pydantic said:", first_problem)

print("\nTrying to create an identity with a FAKE email ('not-an-email')...")
try:
    IdentityRecord(internal_patient_id="P-003", cognito_user_id="x", email="not-an-email")
except Exception as e:
    print("  -> REJECTED. The email box refused the value.")

print("\nAll done. Everything above proves your forms work.")
