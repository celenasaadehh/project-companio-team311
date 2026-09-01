# =============================================================================
# therapist_rule.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): TherapistRule.
#
# A TherapistRule is something a HUMAN CLINICIAN explicitly decided in advance:
# "WHEN <this situation happens>, DO <this approved action>."
#
# This is the HIGHEST authority in the whole system. The core safety rule of the
# project is: the AI does NOT invent treatment; the therapist does. So when a
# TherapistRule applies, the AI must follow it and must NOT silently replace it.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

# datetime: to record WHEN the rule was created and last changed.
from datetime import datetime, timezone

# Optional: some boxes are allowed to be empty (None).
from typing import Optional

# BaseModel (enforcement engine) + Field (for defaults like the timestamp).
from pydantic import BaseModel, Field

# We reuse the RiskLevel menu so the risk part of a condition can only be one of
# the allowed levels (baseline / elevated / high / critical). This is exactly
# WHY separating the condition helps: the risk part is now a real, checked menu
# value instead of a loose piece of text like "risk_level == high".
from .enums import RiskLevel


# -----------------------------------------------------------------------------
# THE FORM: TherapistRule
# -----------------------------------------------------------------------------
class TherapistRule(BaseModel):

    # YOUR RULE: a unique id for THIS one rule, e.g. "TR-001". Text, required.
    rule_id: str

    # YOUR RULE: which patient this rule belongs to. Again ONLY the codename,
    # never a name. Text, required.
    patient_id: str

    # ---------------------------------------------------------------------
    # THE CONDITION, SPLIT INTO TWO SEPARATE, STRUCTURED PARTS
    # ---------------------------------------------------------------------
    # A messy single text list like ["risk_level == high", "trigger == crowd"]
    # would mix two DIFFERENT kinds of condition into one bag, and a computer
    # would have to parse the text to understand it. So we split it:

    # PART 1 — the RISK part of the condition.
    # YOUR RULE: the rule only applies when the live risk is AT LEAST this level.
    # It is a RiskLevel menu value (checked, no typos), or None if this rule
    # does not care about risk at all. Example: RiskLevel.HIGH
    # (The decision engine, later, will read this as "fire when risk >= high".)
    min_risk_level: Optional[RiskLevel] = None

    # PART 2 — the TRIGGER part of the condition.
    # YOUR RULE: which observed trigger(s) make this rule apply. A list of text
    # keywords, e.g. ["crowd"]. Empty list = this rule does not depend on a
    # specific trigger. Kept separate from the risk part on purpose, so each
    # part is unambiguous and independently checkable.
    trigger_conditions: list[str] = Field(default_factory=list)

    # YOUR RULE: the single approved action to take when the conditions match.
    # Text, required — a rule with no action would be meaningless.
    # Example: "offer calm mode"
    approved_action: str

    # YOUR RULE: actions that are explicitly BANNED for this rule, even if the
    # AI later thinks they might help. Example: ["auto-alert caregiver"].
    forbidden_actions: list[str] = Field(default_factory=list)

    # YOUR RULE: priority is a WHOLE NUMBER (int). If two rules match the same
    # moment, the higher number wins. Default 0 = lowest priority.
    # "int" means a whole number (no decimals).
    priority: int = 0

    # YOUR RULE: active is TRUE/FALSE (a "bool", short for boolean).
    # A bool can only ever be True or False. This is an on/off switch: it lets a
    # therapist DISABLE a rule without deleting it. Default True = rule is on.
    active: bool = True

    # YOUR RULE: version is a whole number that we bump up each time the rule is
    # edited (1, then 2, then 3...). This gives us a simple history/paper-trail.
    version: int = 1

    # YOUR RULE: WHEN the rule was first created. Filled in automatically.
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # YOUR RULE: WHEN the rule was last changed. Also auto-filled at creation;
    # later, whenever we edit the rule, we would update this too.
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # YOUR RULE: WHO wrote the rule, for accountability. Optional text — we may
    # not always have it, e.g. "therapist:T-007".
    created_by: Optional[str] = None

    # ---------------------------------------------------------------------
    # THE MOST IMPORTANT SAFETY LINE IN THIS FILE
    # ---------------------------------------------------------------------
    # YOUR RULE: may the AI ever OVERRIDE (ignore/replace) this therapist rule?
    # It is a bool, and its DEFAULT is False.
    #
    # WHY default to False?
    #   The project's #1 principle is "the AI does not create treatment; the
    #   therapist does." A safe default means: if a therapist FORGETS to set
    #   this, the system automatically refuses to let the AI override them.
    #   In other words, the "someone forgot to decide" case lands on the SAFE,
    #   cautious side — never on the risky side. This is called being
    #   "safe by default", and it is a deliberate safety choice.
    ai_override_allowed: bool = False
