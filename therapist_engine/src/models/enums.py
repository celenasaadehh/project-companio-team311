# =============================================================================
# enums.py
# -----------------------------------------------------------------------------
# This file holds our "menus" — the fixed lists of allowed answers.
#
# Remember the drop-down idea: some boxes on our forms may ONLY contain one of
# a few specific words. This file is where we define those allowed words, ONE
# time, so every form can reuse the exact same menu.
# =============================================================================


# -----------------------------------------------------------------------------
# This is an IMPORT. It means: "go get a tool from Python's built-in toolbox
# and bring it into this file so we can use it."
#
# "enum" is a toolbox that comes free with Python (we don't install anything).
# From it we grab one specific tool called "Enum" (capital E).
# "Enum" is the tool that lets us build a fixed menu of choices.
# -----------------------------------------------------------------------------
from enum import Enum


# -----------------------------------------------------------------------------
# MENU 1: AccountRole
# -----------------------------------------------------------------------------
# "class" is the Python keyword for "I am defining a new kind of thing."
# Here we define a new kind of thing called AccountRole.
#
# The "(str, Enum)" part means our menu is built from TWO tools mixed together:
#   - Enum  -> makes it a fixed menu of choices
#   - str   -> makes each choice ALSO behave like normal text ("patient", etc.)
#             This is handy later when we save data or show it on a screen.
#
# In plain words: "AccountRole is a menu whose choices are also text."
# -----------------------------------------------------------------------------
class AccountRole(str, Enum):
    # Each line below is ONE choice on the menu.
    # Left side (PATIENT) = the name WE use in our code.
    # Right side ("patient") = the actual text value that gets stored/shown.
    PATIENT = "patient"        # the person receiving support
    THERAPIST = "therapist"    # the clinician who writes the rules
    CAREGIVER = "caregiver"    # a trusted contact who may be alerted


# -----------------------------------------------------------------------------
# MENU 2: SensorType
# -----------------------------------------------------------------------------
# What KIND of reading a sensor produced. We force these to be a fixed menu so
# nobody can type "hart_rate" or "HeartRate" by accident — only the exact words
# below are allowed, so the computer never gets confused by spelling.
# -----------------------------------------------------------------------------
class SensorType(str, Enum):
    HEART_RATE = "heart_rate"                # beats per minute
    HRV = "hrv"                              # heart-rate variability
    MOTION = "motion"                        # movement / accelerometer
    ENVIRONMENTAL_NOISE = "environmental_noise"  # loudness around the person (mic)
    # VISUAL_SCENE = what the CAMERA sees, as plain object/scene LABELS.
    # Example value later: "trash_bag" or "road".
    # NOTE (important): this is only a neutral label of an object. It is NOT a
    # judgement like "danger" or "bomb". The camera reports what is there; the
    # therapist's rules for THIS patient decide whether it matters.
    VISUAL_SCENE = "visual_scene"            # camera object/scene labels
    SELF_REPORT = "self_report"              # the patient's own words
    CONTEXTUAL = "contextual"                # other situational info


# -----------------------------------------------------------------------------
# MENU 3: RiskLevel
# -----------------------------------------------------------------------------
# A human-readable "band" for how elevated the person's body is.
# IMPORTANT: this is NOT a diagnosis. It describes physical elevation only,
# never "PTSD attack". A wrist sensor cannot diagnose a mental-health condition.
# -----------------------------------------------------------------------------
class RiskLevel(str, Enum):
    BASELINE = "baseline"      # normal for this person
    ELEVATED = "elevated"      # somewhat above their normal
    HIGH = "high"              # clearly above normal
    CRITICAL = "critical"      # highest band; follow the escalation plan


# -----------------------------------------------------------------------------
# MENU 4: SourceType
# -----------------------------------------------------------------------------
# When we store an official piece of PTSD knowledge, what KIND of document did
# it come from? This helps us judge how authoritative a fact is.
# -----------------------------------------------------------------------------
class SourceType(str, Enum):
    CLINICAL_GUIDELINE = "clinical_guideline"  # e.g. VA/DoD guidelines
    FACT_SHEET = "fact_sheet"                  # official plain-language page
    RESEARCH_SUMMARY = "research_summary"      # summary of studies
    GOVERNMENT_PAGE = "government_page"         # official gov website page


# -----------------------------------------------------------------------------
# MENU 5: ReviewStatus
# -----------------------------------------------------------------------------
# Has a HUMAN reviewed a piece of knowledge before the system is allowed to use
# it? We never want the system relying on un-reviewed information.
# -----------------------------------------------------------------------------
class ReviewStatus(str, Enum):
    PENDING = "pending"        # added, but not yet checked by a human
    APPROVED = "approved"      # a human confirmed it is OK to use
    REJECTED = "rejected"      # a human said do NOT use this


# -----------------------------------------------------------------------------
# MENU 6: DecisionSource
# -----------------------------------------------------------------------------
# THE most important menu for safety. When the system decides to do something,
# this records WHICH AUTHORITY the decision came from. Later, anyone auditing
# the system can ask "why did it do that?" and get a truthful answer.
# -----------------------------------------------------------------------------
class DecisionSource(str, Enum):
    THERAPIST_RULE = "therapist_rule"  # a human clinician pre-approved this
    AI_REASONING = "ai_reasoning"      # the AI inferred this within its limits
    SAFE_FALLBACK = "safe_fallback"    # unsure -> did the cautious minimum
    # Not a fallback: a deliberate handover. Distress is high enough that no
    # automated choice is appropriate, so the decision is to reach a person.
    SAFETY_ESCALATION = "safety_escalation"
