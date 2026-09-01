from src.engines.intervention_bandit import choose_action, compute_reward
from src.engines.orchestrator import process_moment
from src.models.patient import PatientProfile
from src.models.risk_state import RiskState
from src.models.enums import RiskLevel, DecisionSource


def test_compute_reward_direction():
    # Risk change is only usable when it is close enough in time to actually be
    # attributable to the intervention.
    assert compute_reward(0.8, 0.3, minutes_between=10) == 1   # real improvement
    assert compute_reward(0.3, 0.8, minutes_between=10) == 0   # got worse


def test_compute_reward_unchanged_risk_is_not_success():
    # Previously "risk stayed the same" scored as SUCCESS, so an intervention
    # that changed nothing earned the same credit as one that worked, and the
    # bandit could not learn to prefer the effective one. No change inside the
    # noise band is genuinely uninformative -- skip it rather than reward it.
    assert compute_reward(0.3, 0.3, minutes_between=10) is None
    assert compute_reward(0.30, 0.32, minutes_between=10) is None  # within noise


def test_compute_reward_ignores_readings_too_far_apart():
    # A reading hours later reflects lunch, a commute and a meeting -- not the
    # grounding exercise offered that morning.
    assert compute_reward(0.8, 0.3, minutes_between=300) is None
    # Unknown elapsed time must not be assumed prompt.
    assert compute_reward(0.8, 0.3) is None


def test_compute_reward_prefers_the_patients_own_answer():
    # "Did that help?" is deliberate, direct, and outranks any inference we
    # make from sensor data -- including a contradictory risk trend.
    assert compute_reward(0.3, 0.9, patient_reported_helped=True) == 1
    assert compute_reward(0.9, 0.1, patient_reported_helped=False) == 0
    # ...and works with no physiological data at all.
    assert compute_reward(None, None, patient_reported_helped=True) == 1


def test_compute_reward_ignores_other_episodes():
    assert compute_reward(0.8, 0.3, minutes_between=10, same_episode=False) is None


def test_compute_reward_unknown_when_no_followup():
    assert compute_reward(0.5, None, minutes_between=10) is None
    assert compute_reward(None, 0.5, minutes_between=10) is None


def test_single_candidate_is_returned_without_randomness():
    assert choose_action(["only option"], []) == "only option"


def test_cold_start_returns_a_valid_candidate():
    candidates = ["5-4-3-2-1 grounding", "box breathing", "call a friend"]
    for _ in range(20):
        assert choose_action(candidates, []) in candidates


def test_bandit_learns_to_favor_the_historically_successful_action():
    candidates = ["5-4-3-2-1 grounding", "box breathing", "call a friend"]
    history = (
        [{"action": "5-4-3-2-1 grounding", "reward": 1}] * 20
        + [{"action": "box breathing", "reward": 0}] * 20
        + [{"action": "call a friend", "reward": 0}] * 20
    )
    picks = [choose_action(candidates, history) for _ in range(300)]
    # With this much evidence the bandit should overwhelmingly prefer the
    # proven action, while still leaving room for occasional exploration.
    assert picks.count("5-4-3-2-1 grounding") > 270


def test_bandit_ignores_history_for_actions_not_in_current_candidates():
    # History for an action that isn't even offered right now must not crash
    # or influence the outcome.
    candidates = ["box breathing"]
    history = [{"action": "some other action", "reward": 1}] * 10
    assert choose_action(candidates, history) == "box breathing"


def _profile():
    return PatientProfile(patient_id="P-001", approved_interventions=["5-4-3-2-1 grounding exercise"])


def _risk(level, score):
    return RiskState(patient_id="P-001", risk_score=score, risk_level=level, confidence=0.8)


def test_distress_gate_skips_intervention_for_calm_text_with_no_other_signal():
    out = process_moment(
        "P-001", _profile(), [], _risk(RiskLevel.BASELINE, 0.1), [],
        mode="ai", transcript="I had a really great day, feeling relaxed",
    )
    assert out["decision"].decision_source == DecisionSource.AI_REASONING
    assert "distress gate" in out["decision"].reason_code
    assert out["decision"].selected_action == "offer verbal support"


def test_distress_gate_never_overrides_a_real_observed_trigger():
    # Calm-sounding words must not suppress a response to a REAL trigger the
    # camera/mic actually detected - the gate only applies when text is the
    # ONLY signal available.
    out = process_moment(
        "P-001", _profile(), [], _risk(RiskLevel.BASELINE, 0.1), ["trash bag"],
        mode="ai", transcript="I had a really great day, feeling relaxed",
    )
    assert out["decision"].selected_action == "5-4-3-2-1 grounding exercise"


def test_distress_gate_never_overrides_elevated_physiological_risk():
    out = process_moment(
        "P-001", _profile(), [], _risk(RiskLevel.ELEVATED, 0.6), [],
        mode="ai", transcript="I had a really great day, feeling relaxed",
    )
    assert out["decision"].selected_action == "5-4-3-2-1 grounding exercise"
