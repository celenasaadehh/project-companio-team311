# =============================================================================
# risk_state.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): RiskState.
#
# RiskState is the OUTPUT of the (future) risk engine. The engine reads many
# SensorEvents (raw readings) and produces ONE summary: "right now, how elevated
# is this person's body, and how sure are we?"
#
# CRITICAL SAFETY IDEA: RiskState describes PHYSICAL ELEVATION only — a number
# and a band. It must NEVER contain a medical diagnosis like "PTSD attack" or
# "panic attack". A wrist sensor + camera can measure that the body is elevated;
# they CANNOT diagnose a mental-health condition. Keeping RiskState to a score
# (not a diagnosis) is a deliberate safety boundary.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

from datetime import datetime, timezone

from pydantic import BaseModel, Field

# Reuse the RiskLevel menu (baseline / elevated / high / critical).
from .enums import RiskLevel


# -----------------------------------------------------------------------------
# THE FORM: RiskState
# -----------------------------------------------------------------------------
class RiskState(BaseModel):

    # YOUR RULE: whose risk this describes — codename only.
    patient_id: str

    # YOUR RULE: WHEN this assessment was made. Auto-filled if not given.
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # YOUR RULE: the risk score, a decimal number BETWEEN 0 and 1.
    # "Field(ge=0.0, le=1.0)" enforces the range (ge = ">= 0", le = "<= 1").
    # We use 0..1 so the number is always comparable and easy to validate.
    #   0.0 = no elevation,  1.0 = maximum elevation.
    # It is REQUIRED (no default): a risk state with no score is meaningless.
    risk_score: float = Field(ge=0.0, le=1.0)

    # YOUR RULE: the human-readable band for that score. A RiskLevel menu value.
    # This is the "high/critical" label the therapist rules compare against.
    risk_level: RiskLevel

    # YOUR RULE: WHY the score is what it is — a list of short text reasons.
    # This gives transparency / an audit trail. Example:
    #   ["hr above baseline", "sudden loud noise"]
    contributing_signals: list[str] = Field(default_factory=list)

    # YOUR RULE: how CONFIDENT the engine is in this assessment, 0..1.
    # Low confidence (e.g. a poor sensor signal) tells later steps to be MORE
    # cautious. Required, and range-checked like risk_score.
    confidence: float = Field(ge=0.0, le=1.0)
