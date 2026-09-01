# =============================================================================
# intervention_bandit.py  -  THE "MDP" LAYER: learns which approved action
# actually works best for THIS patient, from real outcomes over time.
# =============================================================================
# THE STORY (read this first):
#   ai_reasoner.py can end up with SEVERAL approved actions that all match the
#   recommender's predicted stage (e.g. the patient approved both "5-4-3-2-1
#   grounding" AND "box breathing" for COMFORT). Until now it just picked the
#   first one in the list, every time, forever. That's arbitrary, not smart.
#
#   THIS file replaces that arbitrary pick with a real, self-training
#   technique: a multi-armed bandit (the simplest kind of Markov Decision
#   Process - one state, several actions, an unknown reward for each). It
#   tracks, per patient, how often each action was followed by the patient's
#   risk score actually going down - and increasingly favors whichever
#   action has actually worked for THAT PERSON, while still trying the
#   others occasionally in case the pattern changes.
#
#   WHY a bandit and not a bigger "real" MDP: a full MDP needs a history of
#   multi-step sessions to learn state transitions from - this product has
#   no real usage data yet (it hasn't shipped). A bandit needs NO pre-existing
#   dataset at all; it starts learning from the very first real decision and
#   gets smarter with every one after that. That's the honest, buildable
#   version of "MDP" for a brand-new product - not a fake shortcut.
#
#   Thompson Sampling (the specific bandit algorithm used here) works like
#   this: for each action, keep a Beta distribution of "how often does this
#   work" (starts at Beta(1,1) = "no idea, 50/50" for every action - a fair,
#   unbiased starting point). Each time we need a decision, draw ONE random
#   sample from each action's current belief, and pick whichever action drew
#   the highest sample. Actions that have worked well develop a Beta
#   distribution concentrated near 1 (so they usually draw high samples and
#   get picked); actions that haven't worked (or haven't been tried yet)
#   still occasionally get sampled highly by chance, so the bandit keeps
#   exploring instead of permanently locking onto an early lucky guess.
# =============================================================================
from __future__ import annotations

import random
from typing import Optional


# How long after an intervention a risk reading can still plausibly be about
# that intervention. Beyond this the two are unrelated events and pairing them
# teaches the bandit false cause-and-effect.
MAX_ATTRIBUTION_MINUTES = 45

# Risk scores are noisy. A change smaller than this is not evidence either way.
RISK_NOISE_BAND = 0.05


def compute_reward(
    decision_risk_score: Optional[float],
    followup_risk_score: Optional[float],
    *,
    patient_reported_helped: Optional[bool] = None,
    minutes_between: Optional[float] = None,
    same_episode: Optional[bool] = None,
) -> Optional[int]:
    """
    GOES IN : decision_risk_score     = risk AT the moment an action was offered.
              followup_risk_score     = risk at a later reading.
              patient_reported_helped = the patient's own answer to "Did that
                                        help?" (True/False), when we have it.
              minutes_between         = minutes between the two readings.
              same_episode            = whether both belong to the same support
                                        episode, when the caller knows.
    COMES OUT: 1 = this action helped, 0 = it did not, None = we cannot tell
               and the caller must SKIP this pair rather than guess.

    WHY THIS CHANGED
    ----------------
    The previous version graded an intervention purely by whatever the NEXT
    recorded risk score happened to be -- explicitly "could be minutes or hours
    later". Three separate problems, all of which corrupt what the bandit
    learns:

      1. No time limit. A grounding exercise at 09:00 was being graded by a
         reading at 14:00, after lunch, a commute and a meeting. That is not
         cause and effect; it is coincidence being recorded as evidence.

      2. "Risk stayed the same" counted as SUCCESS (`<=`). An intervention that
         changed nothing scored identically to one that helped, so useless
         actions accumulated the same credit as effective ones and the bandit
         had no way to prefer the effective one.

      3. The patient's own "Did that help?" answer -- direct, deliberate, and
         the single most reliable signal available -- was collected by the app
         and then never used for learning at all.

    Now: the patient's own answer wins when we have it. Otherwise risk change is
    used only when it is close enough in time to be attributable, and only when
    the change is larger than measurement noise. Anything else returns None,
    because no data is better than data pointing the wrong way.
    """
    # 1. The patient's own judgement outranks any inference from sensors.
    #    They know whether it helped; we are only ever estimating.
    if patient_reported_helped is not None:
        return 1 if patient_reported_helped else 0

    # 2. Fall back to physiological change, under strict conditions.
    if decision_risk_score is None or followup_risk_score is None:
        return None

    # A reading from a different episode says nothing about this intervention.
    if same_episode is False:
        return None

    # Too far apart to attribute. Unknown time is treated as unattributable:
    # silently assuming it was prompt is what created the problem above.
    if minutes_between is None or minutes_between > MAX_ATTRIBUTION_MINUTES:
        return None

    delta = followup_risk_score - decision_risk_score
    if delta <= -RISK_NOISE_BAND:
        return 1          # a real, measurable improvement
    if delta >= RISK_NOISE_BAND:
        return 0          # got meaningfully worse
    return None           # inside the noise band -> genuinely uninformative


def choose_action(candidates: list[str], history: list[dict]) -> str:
    """
    GOES IN : candidates = the approved actions tied for this moment (all
                            matched the recommender's predicted stage).
              history    = this patient's past {"action": str, "reward": 0|1}
                            pairs (see compute_reward above). Empty list is
                            fine - that's simply "no data yet", not an error.
    COMES OUT: one action from `candidates` - the bandit's pick for right now.

    With an empty candidates list this would be undefined, so the caller
    (ai_reasoner.py) must never call this with fewer than 1 candidate.
    With exactly 1 candidate, there's nothing to choose between - handled
    below without needing any randomness.
    """
    if len(candidates) == 1:
        return candidates[0]

    # Tally real successes/failures per candidate action from history.
    tally = {a: {"success": 0, "failure": 0} for a in candidates}
    for h in history:
        action, reward = h.get("action"), h.get("reward")
        if action in tally and reward in (0, 1):
            key = "success" if reward == 1 else "failure"
            tally[action][key] += 1

    # Thompson Sampling: draw one random sample from each action's current
    # Beta belief, pick the highest draw. Beta(1,1) (no data) is a flat,
    # unbiased 0..1 distribution - every untried action gets a fair chance.
    best_action, best_sample = candidates[0], -1.0
    for action in candidates:
        alpha = tally[action]["success"] + 1
        beta = tally[action]["failure"] + 1
        sample = random.betavariate(alpha, beta)
        if sample > best_sample:
            best_sample, best_action = sample, action
    return best_action
