# =============================================================================
# decision_engine.py  -  THE BOSS (checks the therapist's rules)
# =============================================================================
# THE STORY (read this first):
#   This is the "brain" of the SEEN world. It answers one question:
#     "Did the therapist already write a rule for a moment like this one?"
#   If YES -> it follows that rule exactly (the safest possible answer).
#   If NO  -> it does NOT guess. It returns a safe, cautious fallback.
#
#   It is "deterministic": the same inputs always give the same output - no
#   randomness, no AI. That predictability is exactly what you want for the
#   therapist-approved core of a medical app.
#
# WHAT IT PRODUCES = a "Decision" (a Phase-1 form). A Decision records: which
#   patient, WHO decided (therapist_rule / ai_reasoning / safe_fallback), the
#   chosen action, a confidence 0..1, and a short reason - so any answer can be
#   explained later ("why did it do that?").
# =============================================================================


# --- Borrow the Phase-1 forms this engine works with (re-explained) ----------
# Optional = a marker meaning "this value might be empty (None)".
from typing import Optional

# PatientProfile = the patient's clinical record. Holds approved_interventions
#   (the ONLY actions allowed for them) and forbidden_interventions. No real name.
from src.engines.trigger_vocabulary import normalize_all
from src.models.patient import PatientProfile
# TherapistRule = one rule the therapist wrote. Holds: patient_id, min_risk_level
#   (fire only when risk is at least this), trigger_conditions (what must be seen),
#   approved_action (what to do), priority (bigger wins), active (on/off switch).
from src.models.therapist_rule import TherapistRule
# RiskState = the current risk (the thing the bridge produced). Holds risk_score
#   (0..1) and risk_level (a word: baseline/elevated/high/critical).
from src.models.risk_state import RiskState
# Decision = the final answer form this engine BUILDS and hands back.
from src.models.decision import Decision
# Two menus: RiskLevel (the level words) and DecisionSource (who decided).
from src.models.enums import RiskLevel, DecisionSource


# =============================================================================
# HELPER: "is the live risk AT LEAST what the rule needs?"
# =============================================================================
# Problem: risk_level is a WORD (baseline/elevated/high/critical). You cannot
# compare words with ">=" ("is high >= elevated?" means nothing to Python).
# Fix: give each word a NUMBER (a rank). Then "high >= elevated" becomes "2 >= 1".
# (This "{word: number}" thing is a dictionary - a labelled lookup table.)
_RISK_RANK = {
    RiskLevel.BASELINE: 0,
    RiskLevel.ELEVATED: 1,
    RiskLevel.HIGH: 2,
    RiskLevel.CRITICAL: 3,
}


def _risk_is_at_least(current: RiskLevel, minimum: RiskLevel) -> bool:
    # "-> bool" means this hands back True or False.
    # Look up each word's rank number, then compare the numbers.
    # Example: current = HIGH (2), minimum = ELEVATED (1) -> 2 >= 1 -> True.
    return _RISK_RANK[current] >= _RISK_RANK[minimum]


# =============================================================================
# THE MAIN FUNCTION: find a matching rule, or fall back safely
# =============================================================================
# IN PLAIN ENGLISH:
#   GOES IN : patient_id        = "P-001"
#             profile           = the PatientProfile (for the approved-action check)
#             rules             = a list of TherapistRules to check
#             risk_state        = the current RiskState (how elevated the body is)
#             observed_triggers = what the camera/mic saw, e.g. ["crowd"]
#   COMES OUT: a Decision (either a therapist_rule match, or a safe fallback)
#
# We trace ONE example the whole way:
#   patient "P-001", risk HIGH, observed ["crowd"], and one rule TR-001 that says
#   "if risk >= high and a crowd is seen -> offer calm mode".
# =============================================================================
def decide_from_rules(
    patient_id: str,
    profile: PatientProfile,
    rules: list[TherapistRule],
    risk_state: RiskState,
    observed_triggers: list[str],
    already_tried: Optional[list] = None,
) -> Decision:

    # STEP 0 - CRITICAL DISTRESS IS NOT A TECHNIQUE PROBLEM.
    #
    # At critical arousal a person cannot reliably carry out an instruction:
    # working memory is gone, and a technique they fail at adds a second problem
    # on top of the episode. Withholding only the demanding interventions and
    # offering a simpler one still leaves an automated system in charge of the
    # worst moment of someone's week.
    #
    # So at critical, Companio stops choosing techniques and hands over to a
    # person. This runs BEFORE rule matching, so it cannot be overridden by a
    # rule -- the therapist decides what happens up to this point, and this is
    # the point past which nobody should be relying on an app.
    if risk_state.risk_level == RiskLevel.CRITICAL:
        return Decision(
            patient_id=patient_id,
            selected_action="offer to contact someone now",
            decision_source=DecisionSource.SAFETY_ESCALATION,
            confidence=1.0,
            escalation_required=True,
            reason_code=(
                "distress is critical -- handing over to a person rather than "
                "offering another technique"
            ),
        )

    # STEP 1 - go through every rule and keep only the ones that FIT this moment.
    # "matching_rules: list[TherapistRule] = []" starts an empty basket of rules.
    matching_rules: list[TherapistRule] = []

    # "for rule in rules:" repeats the block below once for each rule in the list.
    for rule in rules:
        # (a) "if not rule.active:" = if the therapist switched this rule OFF...
        #     "continue" = skip it and jump straight to the next rule.
        if not rule.active:
            continue
        # (b) PRIVACY: the "rules" list should ALREADY contain only THIS patient's
        #     rules (in the real system they come from a per-patient database query
        #     like "get rules WHERE patient_id = P-001" - we never load everyone's
        #     rules together). This line is a DEFENSIVE double-check: if a rule for
        #     a different patient ever slipped in by mistake, "!=" ("not equal")
        #     catches it and "continue" skips it. Belt-and-suspenders, not the main
        #     privacy boundary.
        if rule.patient_id != patient_id:
            continue
        # (c) THE RISK CONDITION.
        #     "is not None" means "the rule actually set a minimum". If it did, the
        #     live risk must be at least that (using our helper). If not -> skip.
        if rule.min_risk_level is not None:
            if not _risk_is_at_least(risk_state.risk_level, rule.min_risk_level):
                continue
        # (d) THE TRIGGER CONDITION.
        #     "if rule.trigger_conditions:" is true only if the rule lists triggers.
        #     The line below builds a small list of triggers that appear in BOTH the
        #     rule's list AND what we observed. "[t for t in A if t in B]" reads as:
        #     "collect each t from A that is also in B".
        if rule.trigger_conditions:
            # Match on CANONICAL concepts from the shared vocabulary, not raw
            # strings. Exact comparison meant a therapist rule written for
            # "trash bag" did not fire when the observation arrived as
            # "garbage bag" -- while the mobile client and the Lambda, which
            # both did alias resolution, treated them as the same thing. The
            # clinician's own rule was the layer most likely to be skipped.
            rule_triggers = normalize_all(rule.trigger_conditions) or {
                str(t).strip().lower() for t in rule.trigger_conditions if str(t).strip()
            }
            observed = normalize_all(observed_triggers) or {
                str(t).strip().lower() for t in observed_triggers if str(t).strip()
            }
            overlap = rule_triggers.intersection(observed)
            # "if not overlap:" = if that shared list is empty -> no trigger matched.
            if not overlap:
                continue
        # If we reach here, every check passed -> this rule FITS. Add it to the basket.
        matching_rules.append(rule)
    # For our example, TR-001 passes all 4 checks, so matching_rules = [TR-001].

    # STEP 2 - if at least one rule fit, choose the best one and use it.
    if matching_rules:
        # "max(list, key=lambda r: r.priority)" picks the rule with the highest
        # priority number. ("lambda r: r.priority" is a tiny throwaway function that
        # says "for a rule r, look at its .priority".)
        # Deterministic tie-break: higher priority wins; equal priority uses rule_id.
        best = sorted(matching_rules, key=lambda r: (-r.priority, r.rule_id))[0]

        # SAFETY DOUBLE-CHECK: even a therapist rule may only offer an action that is
        # on the patient's approved list. "not in" = "is missing from". If the rule's
        # action isn't approved, we refuse it and fall back safely instead.
        # Already tried in this episode and it did not help. The therapist's own
        # instruction has been exhausted, so escalate to a person rather than
        # substituting something the clinician did not choose for this trigger.
        if best.approved_action in (already_tried or []):
            return Decision(
                patient_id=patient_id,
                decision_source=DecisionSource.SAFE_FALLBACK,
                therapist_rule_id=best.rule_id,
                risk_score=risk_state.risk_score,
                selected_action="offer to contact the therapist",
                confidence=0.5,
                escalation_required=True,
                reason_code=(f"rule {best.rule_id} action already tried and did not help "
                             f"-- escalating rather than substituting"),
            )

        if best.approved_action in profile.forbidden_interventions:
            return _safe_fallback(
                patient_id, risk_state,
                reason_code=f"rule {best.rule_id} action is forbidden for patient",
            )

        if (profile.approved_interventions
                and best.approved_action not in profile.approved_interventions):
            return _safe_fallback(
                patient_id,
                risk_state,
                reason_code=f"rule {best.rule_id} action not in approved_interventions",
            )

        # All good -> BUILD the Decision. It records everything for the audit trail:
        # who decided (a therapist rule), which rule, the action, and why.
        return Decision(
            patient_id=patient_id,
            decision_source=DecisionSource.THERAPIST_RULE,  # highest-trust authority
            therapist_rule_id=best.rule_id,                 # e.g. "TR-001"
            risk_score=risk_state.risk_score,
            selected_action=best.approved_action,           # e.g. "offer calm mode"
            confidence=1.0,                                  # a rule is a sure thing
            escalation_required=False,
            reason_code=f"matched {best.rule_id}",           # "matched TR-001"
        )

    # STEP 3 - NO rule fit this moment. We never guess -> return a safe fallback.
    return _safe_fallback(patient_id, risk_state, reason_code="no matching rule")


# =============================================================================
# THE SAFE FALLBACK: the honest, cautious answer when there is no approved rule
# =============================================================================
# It never makes up medical advice. It offers neutral grounding, and if the risk
# is high or critical it flags that a human should be brought in (escalation).
def _safe_fallback(patient_id: str, risk_state: RiskState, reason_code: str) -> Decision:
    # "in (A, B)" checks if the value is one of those. escalate becomes True only
    # when the risk is HIGH or CRITICAL.
    escalate = risk_state.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL)
    return Decision(
        patient_id=patient_id,
        decision_source=DecisionSource.SAFE_FALLBACK,   # honest "we're being cautious"
        risk_score=risk_state.risk_score,
        selected_action="offer neutral grounding; flag for therapist review",
        confidence=0.3,                                 # low: we are deliberately unsure
        escalation_required=escalate,
        reason_code=reason_code,
    )
