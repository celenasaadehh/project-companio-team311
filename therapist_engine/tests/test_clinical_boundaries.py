"""The layers that decide what a patient must never be told or offered.

Conditional bans withhold an intervention only in the situation the
clinician named, the safety filter refuses claims the system cannot verify,
and the bandit chooses only from what remains approved.
"""
import pytest

from src.engines.conditional_bans import apply_conditional_bans, condition_holds
from src.engines.safety import make_safe, SAFE_FALLBACK_MESSAGE
from src.engines.intervention_bandit import choose_action


APPROVED = ["counting backwards", "grounding 5-4-3-2-1", "sister voice"]


def ban(action, condition_type, value=None, reason=None):
    return {"action": action, "condition_type": condition_type,
            "value": value, "reason": reason}


# --------------------------------------------------------------------------
# Conditional bans
# --------------------------------------------------------------------------

def test_without_bans_every_approved_option_survives():
    allowed, blocked = apply_conditional_bans(APPROVED, [], {})
    assert allowed == APPROVED
    assert blocked == []


def test_a_ban_withholds_only_its_own_intervention():
    allowed, blocked = apply_conditional_bans(
        APPROVED, [ban("counting backwards", "always")], {})
    assert "counting backwards" not in allowed
    assert "grounding 5-4-3-2-1" in allowed
    assert blocked[0]["action"] == "counting backwards"


def test_a_risk_level_ban_holds_at_and_above_its_threshold():
    b = [ban("counting backwards", "risk_at_least", "high")]
    at_high, _ = apply_conditional_bans(APPROVED, b, {"risk_level": "high"})
    assert "counting backwards" not in at_high


def test_a_risk_level_ban_does_not_hold_below_its_threshold():
    b = [ban("counting backwards", "risk_at_least", "high")]
    at_elevated, blocked = apply_conditional_bans(
        APPROVED, b, {"risk_level": "elevated"})
    assert "counting backwards" in at_elevated
    assert blocked == []


def test_a_trigger_specific_ban_holds_only_when_that_trigger_is_seen():
    b = [ban("sister voice", "trigger_present", "trash bag")]
    seen, _ = apply_conditional_bans(APPROVED, b, {"observed_triggers": ["trash bag"]})
    unseen, _ = apply_conditional_bans(APPROVED, b, {"observed_triggers": ["truck"]})
    assert "sister voice" not in seen
    assert "sister voice" in unseen


def test_a_declared_context_ban_holds_only_when_the_patient_declared_it():
    b = [ban("counting backwards", "context_declared", "exercise")]
    during, _ = apply_conditional_bans(APPROVED, b, {"declared_context": ["exercise"]})
    otherwise, _ = apply_conditional_bans(APPROVED, b, {"declared_context": []})
    assert "counting backwards" not in during
    assert "counting backwards" in otherwise


def test_a_ban_can_depend_on_another_intervention_having_failed():
    b = [ban("sister voice", "after_failed", "grounding 5-4-3-2-1")]
    after, _ = apply_conditional_bans(
        APPROVED, b, {"already_tried": ["grounding 5-4-3-2-1"]})
    before, _ = apply_conditional_bans(APPROVED, b, {"already_tried": []})
    assert "sister voice" not in after
    assert "sister voice" in before


def test_an_unevaluable_condition_never_removes_an_approved_option():
    b = [ban("counting backwards", "phase_of_the_moon", "full")]
    allowed, blocked = apply_conditional_bans(APPROVED, b, {})
    assert allowed == APPROVED
    assert blocked == []


def test_an_unknown_condition_type_does_not_hold():
    assert condition_holds({"condition_type": "not_a_real_condition"}, {}) is False


def test_a_ban_with_no_action_is_ignored():
    allowed, blocked = apply_conditional_bans(APPROVED, [ban("", "always")], {})
    assert allowed == APPROVED
    assert blocked == []


def test_matching_is_insensitive_to_case_and_padding():
    b = [ban("  COUNTING BACKWARDS ", "always")]
    allowed, _ = apply_conditional_bans(APPROVED, b, {})
    assert "counting backwards" not in allowed


def test_the_blocked_list_explains_which_ban_fired():
    b = [ban("counting backwards", "risk_at_least", "high", reason="worsens at peak")]
    _, blocked = apply_conditional_bans(APPROVED, b, {"risk_level": "high"})
    assert blocked[0]["reason"] == "worsens at peak"


def test_bans_can_remove_every_option_leaving_the_engine_to_escalate():
    b = [ban(a, "always") for a in APPROVED]
    allowed, blocked = apply_conditional_bans(APPROVED, b, {})
    assert allowed == []
    assert len(blocked) == len(APPROVED)


# --------------------------------------------------------------------------
# Safety filter
# --------------------------------------------------------------------------

@pytest.mark.parametrize("claim", [
    "You are safe now.",
    "There is no danger here.",
    "Nothing bad is going to happen to you.",
])
def test_claims_the_system_cannot_verify_are_refused(claim):
    safe, problems = make_safe(claim)
    assert problems, f"unverifiable claim passed the filter: {claim}"
    assert safe == SAFE_FALLBACK_MESSAGE


def test_ordinary_supportive_wording_passes_unchanged():
    text = "I'm right here with you. Let's try grounding 5-4-3-2-1."
    safe, problems = make_safe(text)
    assert problems == []
    assert safe == text


def test_the_filter_fails_closed_on_empty_input():
    safe, _ = make_safe("")
    assert safe


def test_the_fallback_message_promises_nothing_it_cannot_keep():
    lowered = SAFE_FALLBACK_MESSAGE.lower()
    assert "you are safe" not in lowered
    assert "no danger" not in lowered


# --------------------------------------------------------------------------
# Intervention choice
# --------------------------------------------------------------------------

def test_the_bandit_chooses_only_from_the_candidates_it_is_given():
    for _ in range(25):
        assert choose_action(APPROVED, []) in APPROVED


def test_a_single_candidate_is_returned_directly():
    assert choose_action(["sister voice"], []) == "sister voice"


def test_the_bandit_favours_what_has_helped_this_patient():
    history = [{"action": "sister voice", "reward": 1} for _ in range(40)]
    history += [{"action": "counting backwards", "reward": 0} for _ in range(40)]
    picks = [choose_action(["sister voice", "counting backwards"], history)
             for _ in range(60)]
    assert picks.count("sister voice") > picks.count("counting backwards")


def test_history_for_other_interventions_does_not_break_the_choice():
    history = [{"action": "something not offered", "reward": 1}]
    assert choose_action(APPROVED, history) in APPROVED
