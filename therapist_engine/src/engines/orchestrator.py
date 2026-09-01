# =============================================================================
# orchestrator.py  -  THE FRONT DOOR (one function runs the whole moment)
# =============================================================================
# THE STORY (read this first):
#   You have 4 workers now:
#     - decision_engine.py   = the boss (checks the therapist's rules)
#     - ai_reasoner.py       = the helper (reasons for UNSEEN moments)
#     - safety.py            = the guard (checks the words are safe)
#     - risk_bridge.py       = the translator (already turned sensors into a RiskState)
#
#   This file is the MANAGER that calls them in the right order and returns ONE
#   final answer. Instead of the outside world juggling 4 workers, it just calls
#   process_moment(...) and gets back a decision + the words to show.
#
#   THE ORDER IT FOLLOWS (your decision hierarchy):
#     1. Is there a therapist RULE for this moment? -> use it (SEEN, safest).
#     2. No rule + mode "rules_only"                -> safe fallback (Option 1).
#     3. No rule + mode "ai"                         -> let the AI reason (UNSEEN),
#        then run its words through the safety guard  (Option 2).
#     4. If the AI can't help safely                 -> safe fallback.
# =============================================================================

from typing import Optional

# Borrow the Phase-1 forms it passes around (re-explained briefly):
from src.models.patient import PatientProfile      # the clinical record (approved/forbidden lists)
from src.models.therapist_rule import TherapistRule  # one therapist rule
from src.models.risk_state import RiskState         # the current risk (from the bridge)
from src.models.decision import Decision            # the final answer record
from src.models.enums import DecisionSource         # menu: therapist_rule / ai_reasoning / safe_fallback

# Borrow the 3 workers:
from src.engines.decision_engine import decide_from_rules       # worker 1 (the boss)
from src.engines.ai_reasoner import reason_for_unseen_moment    # worker 2 (the helper)
from src.engines.safety import make_safe, SAFE_FALLBACK_MESSAGE # worker 3 (the guard) + neutral line


# =============================================================================
# process_moment  -  the single function the rest of the app calls
# =============================================================================
# IN PLAIN ENGLISH:
#   GOES IN : patient_id        = "P-001"
#             profile           = the PatientProfile
#             rules             = a list of that patient's TherapistRules
#             risk_state        = the current RiskState
#             observed_triggers = what the camera/mic saw, e.g. ["crowd"]
#             mode              = "ai" (use the AI for unseen moments) or
#                                 "rules_only" (Option 1: never use the AI)
#             transcript        = what the patient actually said, if anything
#                                 (only used for UNSEEN moments, step 3 below)
#   COMES OUT: a dictionary with two things:
#             "decision"       = the Decision record (what + who decided + why)
#             "spoken_message" = the actual words to show on the glasses
# =============================================================================
def process_moment(
    patient_id: str,
    profile: PatientProfile,
    rules: list[TherapistRule],
    risk_state: RiskState,
    observed_triggers: list[str],
    mode: str = "ai",
    transcript: str = "",
    intervention_history: Optional[list[dict]] = None,
    already_tried: Optional[list] = None,
) -> dict:

    # STEP 1 - SEEN path: ask the boss if a therapist rule matches this moment.
    # decide_from_rules returns a Decision that is EITHER a therapist_rule match
    # OR a safe_fallback (when nothing matched).
    decision = decide_from_rules(patient_id, profile, rules, risk_state, observed_triggers,
                                 already_tried=already_tried)

    # If a real therapist rule matched, we are done - use it. It's the safest,
    # highest-authority answer. We phrase a simple spoken line from its action.
    if decision.decision_source == DecisionSource.THERAPIST_RULE:
        # SPEAK TO THE PATIENT, NOT ABOUT THEM.
        #
        # A rule's stored fields are written by and for a clinician -- an
        # action like "guide the patient through grounding and slow breathing"
        # is a note about what should happen, not something to say out loud to
        # the person having the episode. Reading it back verbatim addressed
        # them in the third person, by name, mid-crisis.
        #
        # If the therapist wrote explicit patient-facing words, use those
        # exactly. Otherwise turn the clinical action into a second-person
        # invitation, and strip the clinician-facing framing.
        said = (getattr(decision, "patient_message", None) or "").strip()
        if not said:
            action = (decision.selected_action or "").strip()
            lowered = action.lower()
            for prefix in (
                "guide the patient through ", "guide the patient ", "guide them through ",
                "offer the patient ", "offer them ", "encourage the patient to ",
                "encourage them to ", "prompt the patient to ", "prompt them to ",
                "help the patient ", "help them ", "offer ", "guide ",
            ):
                if lowered.startswith(prefix):
                    action = action[len(prefix):]
                    break
            action = action.rstrip(".")
            said = (
                f"Let's try {action} together. I'm here with you."
                if action else
                "I'm here with you. Let's take this one breath at a time."
            )

        return {"decision": decision, "spoken_message": said}

    # ---- If we reach here, NO rule matched (this is an UNSEEN moment). ----

    # STEP 2 - Option 1 ("rules_only"): the pure rule-based engine stops here and
    # gives the safe, honest fallback. No AI is ever consulted.
    if mode == "rules_only":
        return {"decision": decision, "spoken_message": SAFE_FALLBACK_MESSAGE}

    # STEP 3 - Option 2 ("ai"): let the helper REASON about this unseen moment.
    # It returns a proposal (a bag with a "message" and maybe a "suggested_action"),
    # or None if it cannot help safely.
    proposal = reason_for_unseen_moment(
        profile, risk_state, observed_triggers,
        transcript=transcript, intervention_history=intervention_history,
    )
    if proposal is None:
        # The reasoner had nothing safe to offer. This is the "we have run out
        # of options" case: usually every approved intervention has already been
        # tried and excluded, or the care plan is empty.
        #
        # Inventing a new technique here would be exactly the wrong move -- the
        # care plan is the boundary, and going past it means offering a PTSD
        # patient something no clinician approved for them. So the honest
        # response is to say plainly that what we tried has not worked and offer
        # a person, rather than repeating a calm line that suggests breathing --
        # which may be the very thing that just failed, or is on the forbidden
        # list.
        exhausted = bool(getattr(risk_state, "risk_level", None)) and decision.escalation_required
        if exhausted:
            said = ("What we've tried isn't helping, and I don't want to keep "
                    "suggesting the same things. Would it help if I let your "
                    "therapist know you need them right now?")
        else:
            said = SAFE_FALLBACK_MESSAGE
        return {"decision": decision, "spoken_message": said}

    # STEP 4 - GUARD: scan the AI's words with the safety net BEFORE using them.
    # make_safe returns (safe_text, problems). If problems were found, safe_text is
    # already the neutral fallback line, and we keep the cautious fallback decision.
    safe_message, problems = make_safe(proposal["message"])
    if problems:
        return {"decision": decision, "spoken_message": safe_message}

    # STEP 5 - The AI's words passed the guard. Build an AI_REASONING decision that
    # records what happened (this is DIFFERENT from a therapist_rule decision, so an
    # auditor can always tell an AI answer apart from an approved rule).
    ai_decision = Decision(
        patient_id=patient_id,
        decision_source=DecisionSource.AI_REASONING,
        risk_score=risk_state.risk_score,
        # If the AI suggested an action use it; otherwise it's just verbal comfort.
        selected_action=proposal["suggested_action"] or "offer verbal support",
        confidence=proposal["confidence"],   # stays below a rule's 1.0, on purpose
        escalation_required=False,
        reason_code=proposal["rationale"],
    )
    return {"decision": ai_decision, "spoken_message": safe_message}
