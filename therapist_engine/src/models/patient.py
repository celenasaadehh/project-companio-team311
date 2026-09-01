# =============================================================================
# patient.py
# -----------------------------------------------------------------------------
# This file defines ONE form (model): PatientProfile.
#
# PatientProfile holds the CLINICAL / personalization information about a person
# (their triggers, preferences, what interventions are allowed, etc.).
#
# NOTICE WHAT IS MISSING: there is NO name and NO email box here. This form
# knows the person ONLY by their codename "P-001". That is the privacy design:
# clinical data must never carry a real identity.
# =============================================================================


# -----------------------------------------------------------------------------
# IMPORTS
# -----------------------------------------------------------------------------

# NOTE: we do NOT import List or Dict here.
# You never need an import just to USE a list [ ] or a dict { }.
# We only need a way to DESCRIBE what a box holds ("a list OF text").
# Since Python 3.9 you can write that description in lowercase with no import:
#     list[str]         means "a list of text items", e.g. ["crowds", "sirens"]
#     dict[str, float]  means "labels -> decimal numbers", e.g. {"resting_hr": 68.0}
# (The old style used "from typing import List, Dict" — we don't need it.)

# From Pydantic we need BaseModel (the enforcement engine) and Field.
# We use Field here for a special reason explained at physiological_baseline.
from pydantic import BaseModel, Field


# -----------------------------------------------------------------------------
# THE FORM: PatientProfile
# -----------------------------------------------------------------------------
# "(BaseModel)" = turn the enforcement engine ON for this form (your one switch).
# Every line below is a RULE YOU are writing for the engine to enforce.
# -----------------------------------------------------------------------------
class PatientProfile(BaseModel):

    # YOUR RULE: the codename must be present and be text.
    # This links the clinical record to a person WITHOUT storing who they are.
    # Only the separate IdentityRecord knows that "P-001" is really "Ava".
    patient_id: str

    # --- The next several boxes are all LISTS of text ---------------------
    # A List holds many items. We give each list a DEFAULT of "empty list" so a
    # brand-new profile simply starts with nothing in it (rather than being
    # required to fill everything in immediately).
    #
    # WHY "Field(default_factory=list)" instead of just "= []"?
    #   A list is a "mutable" (changeable) object. If we wrote "= []" once, every
    #   PatientProfile could accidentally SHARE the very same list, and adding a
    #   trigger to one patient could leak into another. "default_factory=list"
    #   tells Pydantic: "make a FRESH, separate empty list for each new profile."
    #   This is a classic Python safety habit worth learning early.

    # YOUR RULE: known_triggers is a list of text.
    # Things known to distress THIS patient. Example: ["crowds", "loud bangs"].
    known_triggers: list[str] = Field(default_factory=list)

    # YOUR RULE: warning_signs is a list of text.
    # Early signals that appear BEFORE a crisis, so we can respond sooner.
    # Example: ["clenched jaw", "pacing"].
    warning_signs: list[str] = Field(default_factory=list)

    # YOUR RULE: communication_preferences is a list of text.
    # How this patient wants to be spoken to (therapist-guided personalization).
    # Example: ["short sentences", "no bright flashing text"].
    communication_preferences: list[str] = Field(default_factory=list)

    # YOUR RULE: approved_interventions is a list of text.
    # The ONLY actions the system is allowed to offer this patient. The system
    # may never invent an action that is not on this list.
    # Example: ["calm mode", "breathing prompt"].
    approved_interventions: list[str] = Field(default_factory=list)

    # YOUR RULE: forbidden_interventions is a list of text.
    # Actions explicitly BANNED for this patient (maybe a trigger for them).
    # Example: ["flashing lights"].
    forbidden_interventions: list[str] = Field(default_factory=list)

    # YOUR RULE: environmental_sensitivities is a list of text.
    # Which surroundings matter for THIS person specifically.
    # Example: ["sudden noise", "strobe lighting"].
    environmental_sensitivities: list[str] = Field(default_factory=list)

    # YOUR RULE: escalation_preferences is a list of text.
    # The patient's CONSENT rules about contacting a caregiver.
    # Example: ["ask me before alerting anyone"].
    escalation_preferences: list[str] = Field(default_factory=list)

    # --- A DICT (labelled pairs) instead of a list -----------------------
    # YOUR RULE: physiological_baseline is a dictionary of text -> number.
    # This is this person's NORMAL. We need it because "heart rate 100" means
    # different things for different people. A Dict fits because each value has
    # a LABEL (which measurement) and a NUMBER (their normal for it).
    # Example: {"resting_hr": 68.0, "resting_hrv": 55.0}
    # We again use default_factory (this time "dict") to give each profile its
    # own fresh, empty dictionary.
    physiological_baseline: dict[str, float] = Field(default_factory=dict)
