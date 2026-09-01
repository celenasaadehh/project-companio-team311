# =============================================================================
# ai_reasoner.py  -  THE "UNSEEN SITUATION" REASONER
# =============================================================================
# THE STORY (read this first):
#   There are TWO kinds of moment:
#     1. SEEN   - the therapist already wrote a rule for it. Handled by
#                 decision_engine.py (exact, approved, no AI needed).
#     2. UNSEEN - nobody planned for this exact moment. THAT is what THIS file
#                 is for. Here the AI is allowed to REASON and CHOOSE a response.
#
#   But "choose" has a careful boundary for a medical app:
#     - It may pick WHICH of the patient's OWN approved actions fits best,
#       using a REAL trained model (ml/recommender_model.joblib - see
#       intervention_recommender.py), not a fixed keyword rule.
#     - It may write the surrounding WORDS in a natural way (the sentence
#       wrapped around the chosen action).
#     - It may NEVER invent a new action, diagnose, promise safety, mention
#       medication, or suggest anything on the patient's FORBIDDEN list.
#   In one line: it can invent the words, never the medicine.
#
#   Whatever it returns is STILL checked by safety.py before anyone hears it, and
#   if it cannot help safely it returns "nothing" so the caller uses a safe fallback.
# =============================================================================

from typing import Optional

# Borrow two Phase-1 forms (re-explained so you don't need to open them):
#   PatientProfile = the clinical record. Holds the patient codename, their
#     approved_interventions (allowed actions), forbidden_interventions (banned),
#     and communication_preferences (how they like to be spoken to). No real name.
from src.models.patient import PatientProfile
#   RiskState = the current risk record (the thing the bridge produced). Holds
#     risk_score (0..1) and risk_level (a word: baseline/elevated/high/critical).
from src.models.risk_state import RiskState
# The real trained model + the small keyword tagger that connects its output
# to whatever free-text actions a specific therapist actually approved.
from src.engines.intervention_recommender import recommend_stage, categorize_intervention
# The bandit: when several approved actions tie for the predicted stage,
# this picks among them using this patient's own real outcome history
# instead of always taking the first one in the list.
from src.engines.intervention_bandit import choose_action
# The distress GATE: the recommender was trained only on examples where
# someone needed support (see companio_stage_examples.json), so it has
# never seen a "the person is actually fine" example and will confidently
# guess a stage regardless. BERT's training data (Dreaddit) does include
# genuinely calm posts, so it can answer the question the recommender can't:
# does this text actually sound distressed at all?
from src.engines.text_distress_detector import predict_distress


# =============================================================================
# THE MAIN ENTRY POINT (called only for UNSEEN moments)
# =============================================================================
# IN PLAIN ENGLISH:
#   GOES IN : profile           = the PatientProfile (approved + forbidden lists)
#             risk_state        = the current RiskState (how elevated the body is)
#             observed_triggers = what the camera/mic saw, e.g. ["a stranger shouting"]
#             transcript        = what the patient actually SAID, if anything (from
#                                 Amazon Transcribe). This is the real input the
#                                 trained model reasons over - without it, the
#                                 model only has the trigger name to go on.
#             knowledge_snippets= approved VA facts handed in (from RAG, later). A
#                                 list of short text pieces. Empty for now.
#   COMES OUT: a "proposal" dictionary (a labelled bag) describing what to say/do,
#              OR None (Python for "nothing") if it cannot help safely.
# =============================================================================
def reason_for_unseen_moment(
    profile: PatientProfile,
    risk_state: RiskState,
    observed_triggers: list[str],
    transcript: str = "",
    knowledge_snippets: Optional[list[str]] = None,
    intervention_history: Optional[list[dict]] = None,
) -> Optional[dict]:

    context = {
        "risk_level": risk_state.risk_level.value,
        "observed": observed_triggers,
        "transcript": transcript,
        "approved_interventions": profile.approved_interventions,
        "forbidden_interventions": profile.forbidden_interventions,
        "communication_preferences": profile.communication_preferences,
        "knowledge": knowledge_snippets or [],   # "or []" = use empty list if None
        # This patient's past {"action", "reward"} pairs, e.g.
        # [{"action": "5-4-3-2-1 grounding", "reward": 1}, ...] - reward 1
        # means their risk score went down afterward. Empty = no data yet,
        # which is a perfectly normal starting state, not an error.
        "intervention_history": intervention_history or [],
    }

    draft = _draft_response(context)

    if draft is None:
        return None

    # GUARDRAIL #1: never suggest an action that is on the patient's FORBIDDEN list.
    suggested_action = draft.get("suggested_action")
    if suggested_action and suggested_action in profile.forbidden_interventions:
        return None   # refuse and let the safe fallback take over

    # Hand back the proposal. The MESSAGE will still be scanned by safety.py before
    # it is ever spoken (that is GUARDRAIL #2, done by the caller).
    return {
        "message": draft["message"],
        "suggested_action": suggested_action,
        "used_knowledge_ids": draft.get("used_knowledge_ids", []),
        # Confidence is deliberately MODERATE - this is the AI reasoning, which must
        # never outrank a real therapist rule (those get confidence 1.0).
        "confidence": draft.get("confidence", 0.5),
        "rationale": draft.get("rationale", "reasoned for an unseen situation"),
    }


# =============================================================================
# THE "THINKING" PART  ->  your trained recommender does the real choosing
# =============================================================================
# GOES IN : context (built above).  COMES OUT: a draft proposal, or None if
# there is nothing safe to offer (e.g. the patient has no approved actions
# at all - that's the ONLY reason to abstain now; having at least one
# approved action always beats staying silent).
# =============================================================================
def _draft_response(context: dict) -> Optional[dict]:
    observed = context["observed"]
    moment = ", ".join(observed) if observed else "this moment"
    approved = context["approved_interventions"]
    transcript = context["transcript"].strip()
    risk_level = (context["risk_level"] or "baseline").lower()

    # Nothing to safely offer at all -> abstain, let the caller fall back.
    if not approved:
        return None

    # DISTRESS GATE: only consult this when the ONLY signal we have is free
    # text (no visual/physiological trigger already flagged something - a
    # real observed trigger or elevated risk score should never be
    # overridden just because the patient's words happened to sound calm).
    # CONTRACT: `observed` contains CONFIRMED triggers, not raw perception
    # labels. The mobile client only populates observed_triggers when a
    # detection actually matched this patient's own trigger list above a
    # confidence threshold (see triggers.js: known_trigger), so a street full
    # of ordinary objects arrives here as an EMPTY list, not as "road, tree,
    # car". Anything in this list is therefore real corroborating evidence and
    # must not be overridden just because the patient's words sounded calm.
    # Callers adding raw labels here would break that contract.
    has_other_signal = bool(observed) or risk_level not in ("baseline", "unknown", "")
    if transcript and not has_other_signal:
        distress_label = predict_distress(transcript)
        if distress_label == "not_stress":
            return {
                "message": "Glad to hear that. I'm here whenever you need me.",
                "suggested_action": None,
                "used_knowledge_ids": [],
                "confidence": 0.6,
                "rationale": "distress gate (DistilBERT): text did not sound distressed, no intervention offered",
            }
        if distress_label is None:
            # FAIL CLOSED. predict_distress returns None when the model could
            # not be loaded (torch/transformers missing, artifact absent) --
            # its own docstring requires the caller to handle this explicitly.
            #
            # Falling through here was fail-OPEN: with the gate silently
            # skipped, free text was passed straight to the recommender, which
            # is designed to pick an action rather than abstain. The result was
            # that a calm patient saying "I had a really great day" received a
            # grounding exercise -- and only on deployments where the model was
            # missing, so it would never reproduce on a dev machine that has it.
            #
            # Text is the ONLY signal at this point (has_other_signal is False),
            # so with the gate unavailable there is no evidence of distress.
            # Offer presence, prescribe nothing.
            return {
                "message": "I'm here with you. Tell me more about what's going on.",
                "suggested_action": None,
                "used_knowledge_ids": [],
                "confidence": 0.3,
                "rationale": ("distress gate unavailable (model could not be loaded): "
                              "failing closed, no intervention offered from text alone"),
            }

    # Build the text the trained model actually reasons over: prefer the
    # patient's own words (transcript) when we have them, since that's what
    # the model was trained on (ESConv "seeker" text); fall back to a plain
    # description of what was observed so there's always SOMETHING to read.
    description_parts = []
    if context["transcript"].strip():
        description_parts.append(context["transcript"].strip())
    if observed:
        description_parts.append(f"Noticed: {', '.join(observed)}.")
    description_parts.append(f"Physiological risk level: {context['risk_level']}.")
    description = " ".join(description_parts)

    # INSUFFICIENT EVIDENCE -> ABSTAIN.
    #
    # Rekognition almost always returns something, so a camera scan of an
    # ordinary street produced labels, and labels were treated as a reason to
    # consult the recommender -- which is built to pick an action rather than
    # abstain. The result was that a tree, a road or a parked car could lead to
    # an unprompted grounding exercise for a patient who was completely calm.
    #
    # An intervention needs an actual reason: either the patient said something,
    # or a trigger THEY are sensitised to was seen, or their physiology is
    # genuinely raised. None of those -> offer presence, prescribe nothing.
    if not transcript and not observed and risk_level in ("baseline", "unknown", ""):
        return {
            "message": "I'm here if you need me.",
            "suggested_action": None,
            "used_knowledge_ids": [],
            "confidence": 0.2,
            "rationale": ("insufficient evidence: nothing the patient said, no known "
                          "trigger observed, and physiology at baseline -- abstained"),
        }

    stage = recommend_stage(description)  # "EXPLORE" | "COMFORT" | "ACT" | None

    # Tag each of THIS patient's approved actions with a best-guess stage,
    # then prefer whichever ones match what the model predicted.
    categorized = {action: categorize_intervention(action) for action in approved}
    candidates = [a for a in approved if categorized[a] == stage] if stage else []
    matched_category = bool(candidates)

    if not candidates:
        # No approved action matches the predicted stage. Falling straight back
        # to the ENTIRE approved list treated "the model had no idea" exactly
        # like "the model chose this", so a confident-looking suggestion could
        # come out of a prediction that never happened.
        #
        # When the recommender reached no stage at all AND physiology is not
        # raised, there is nothing to base a choice on -- abstain instead of
        # picking arbitrarily. With raised physiology we still offer support,
        # because something IS happening, but the lowered confidence below
        # records that the category was not matched.
        if stage is None and risk_level in ("baseline", "unknown", ""):
            return {
                "message": "I'm here with you. Tell me what would help right now.",
                "suggested_action": None,
                "used_knowledge_ids": [],
                "confidence": 0.25,
                "rationale": ("recommender reached no stage and physiology is at "
                              "baseline -- abstained rather than choosing arbitrarily"),
            }
        candidates = approved

    # Among whichever candidates we ended up with, let the bandit pick using
    # this patient's real history instead of always taking candidates[0].
    suggested_action = choose_action(candidates, context["intervention_history"])
    used_bandit = len(candidates) > 1

    # COMFORT and ACT deliver the intervention directly ("let's ..."), never as
    # a question: mid-episode, an open question hands a dysregulated person a
    # decision to make, which is itself a load. EXPLORE is the one stage where
    # asking is the intervention -- it fires at low acuity to gather context.
    templates = {
        "EXPLORE": f"{moment} sounds like a lot right now. Can you tell me a little more about what's happening? If it helps, we could also try {suggested_action}.",
        "COMFORT": f"{moment} sounds like a lot right now. I'm right here with you. Let's {suggested_action}.",
        "ACT": f"{moment} sounds like a lot right now. Let's {suggested_action}, right now. I'm with you.",
    }
    message = templates.get(
        stage,
        f"{moment} sounds like a lot right now. I'm right here with you. Let's {suggested_action}.",
    )

    return {
        "message": message,
        "suggested_action": suggested_action,
        "used_knowledge_ids": [],
        # Higher confidence when the model's predicted stage actually matched
        # one of this patient's approved actions; lower when we fell back to
        # "just offer whatever's approved" because nothing matched.
        "confidence": 0.6 if matched_category else 0.45,
        "rationale": (
            f"unseen situation: recommender predicted {stage or 'no confident'} stage "
            f"-> offered '{suggested_action}'"
            + (" (bandit-selected among tied candidates)" if used_bandit else "")
        ),
    }
