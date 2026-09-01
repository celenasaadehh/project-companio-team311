# =============================================================================
# decision.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): Decision.
#
# A Decision is the RECORD of what the system finally chose to do at one moment,
# and — most importantly — WHICH AUTHORITY made that choice.
#
# WHY the authority matters most: later, a therapist, an auditor, or you must be
# able to ask "why did the glasses do that?" and get a truthful answer. Was it a
# therapist-approved rule? An AI inference? Or a cautious fallback because we
# were unsure? In a safety system, you must always be able to tell these apart.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

from datetime import datetime, timezone
from typing import Optional

# uuid4: to AUTO-GENERATE the record id (a Decision is created by the system in
# the moment; nobody hand-picks its id).
from uuid import uuid4

from pydantic import BaseModel, Field

# Reuse the DecisionSource menu (therapist_rule / ai_reasoning / safe_fallback).
from .enums import DecisionSource


# -----------------------------------------------------------------------------
# THE FORM: Decision
# -----------------------------------------------------------------------------
class Decision(BaseModel):

    # YOUR RULE: a unique id for this decision. A RECORD id, so we AUTO-GENERATE
    # it (like event_id). Example: "D-7b3f0a12".
    decision_id: str = Field(default_factory=lambda: f"D-{uuid4().hex[:8]}")

    # YOUR RULE: who the decision was for — codename only.
    patient_id: str

    # YOUR RULE: WHEN the decision was made. Auto-filled.
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # ---------------------------------------------------------------------
    # THE MOST IMPORTANT BOX IN THIS FILE
    # ---------------------------------------------------------------------
    # YOUR RULE: which AUTHORITY produced this decision. A DecisionSource menu
    # value, and REQUIRED (every decision must declare where it came from):
    #   THERAPIST_RULE -> a human clinician pre-approved this
    #   AI_REASONING   -> the AI inferred this within its limits
    #   SAFE_FALLBACK  -> we were unsure, so we did the cautious minimum
    # Without this box you could not tell a therapist-approved action apart from
    # an AI guess — which, in a safety system, is unacceptable.
    decision_source: DecisionSource

    # YOUR RULE: IF a therapist rule drove this, which one (its rule_id).
    # Optional — a SAFE_FALLBACK or pure AI decision may have no rule.
    therapist_rule_id: Optional[str] = None

    # YOUR RULE: which official knowledge facts (if any) were used, by their ids.
    # A list of text ids, e.g. ["K-001"]. Empty if none were used.
    knowledge_record_ids: list[str] = Field(default_factory=list)

    # YOUR RULE: the risk score at decision time, 0..1. Optional (a decision
    # might not depend on risk). Range-checked when present.
    risk_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)

    # YOUR RULE: what was actually done. Required text. e.g. "offer calm mode".
    selected_action: str

    # YOUR RULE: how confident the system was, 0..1. Required, range-checked.
    confidence: float = Field(ge=0.0, le=1.0)

    # YOUR RULE: did this decision require alerting a human? True/False.
    # Default False = no escalation unless we explicitly decide otherwise
    # (a safe default: we do not alert people unless a rule/consent says to).
    escalation_required: bool = False

    # YOUR RULE: a short machine-readable reason, for the audit trail.
    # e.g. "matched TR-001". Required so no decision is ever unexplained.
    reason_code: str
