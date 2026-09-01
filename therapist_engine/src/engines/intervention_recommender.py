# =============================================================================
# intervention_recommender.py  -  loads YOUR trained ESConv model and turns
# its prediction into a real choice among a patient's OWN approved actions.
# =============================================================================
# THE STORY (read this first):
#   ai_reasoner.py used to pick an action with a hardcoded keyword search:
#   "does any approved action contain the word 'calm' or 'breath'?" That's
#   not machine learning - it's a fixed rule dressed up as a smart choice.
#
#   THIS file replaces that with your real trained model
#   (ml/recommender_model.joblib, built by ml/train_recommender.py on the
#   public ESConv counseling-conversation dataset). Given what the person
#   said/what was observed, it predicts one of 3 support STAGES:
#       EXPLORE  = ask gently / understand
#       COMFORT  = reassure / validate
#       ACT      = offer a concrete step
#
#   It only recommends a STAGE, never a specific action - because the
#   therapist's approved-interventions list is free text (any words a real
#   clinician typed), not a fixed catalog the model was trained on. So a
#   second, tiny, fully-explainable step (categorize_intervention) tags each
#   of THIS patient's own approved actions with a best-guess stage, and
#   ai_reasoner.py picks among whichever ones match. That keyword tagger is
#   NOT a second ML model - it's just how we connect the model's 3-class
#   output to whatever free text a therapist actually wrote.
#
#   Honesty check, same as everywhere else in this project: proof-of-concept
#   accuracy is 50.5% on this 3-class task (random guessing = 33%) - see
#   ml/recommender_metrics.json. Better than chance, not clinically strong.
#   That's fine, because it only ever narrows down which of the THERAPIST'S
#   OWN pre-approved actions to offer - it can never invent a new one, and
#   safety.py still checks the final wording either way.
# =============================================================================
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ml/ lives two folders up from src/engines/ (therapist_engine/ml/...).
_MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "ml" / "recommender_model.joblib"

_model = None
_load_attempted = False


def _load_model():
    # Load once, lazily, the first time it's actually needed (not at import
    # time - keeps tests and tools that don't need it fast to import).
    global _model, _load_attempted
    if _load_attempted:
        return _model
    _load_attempted = True
    try:
        import joblib
        _model = joblib.load(_MODEL_PATH)
    except Exception as e:
        # Fail closed, same pattern as perception/audio.py: if the model
        # can't load, say so plainly and let the caller fall back safely -
        # never pretend a prediction happened when it didn't.
        logger.warning("Recommender model unavailable (%s); stage prediction disabled.", e)
        _model = None
    return _model


def recommend_stage(text: str) -> Optional[str]:
    """
    GOES IN : text = what the person said / what was observed, as one string.
    COMES OUT: "EXPLORE" | "COMFORT" | "ACT", or None if there's no usable
               text or the model file isn't available.
    The caller MUST have a safe behavior for the None case - this function
    never raises just because the model is missing or the input is empty.
    """
    model = _load_model()
    if model is None or not text or not text.strip():
        return None
    try:
        return str(model.predict([text])[0])
    except Exception as e:
        logger.warning("Recommender prediction failed (%s); falling back.", e)
        return None


# --- keyword -> stage, for tagging a THERAPIST'S OWN free-text action -------
_CATEGORY_KEYWORDS = {
    "COMFORT": ["calm", "breath", "ground", "comfort", "reassur", "soothe", "relax", "presence"],
    "ACT": ["call", "contact", "text", "message", "step", "leave", "walk", "therapist",
            "safety plan", "exercise", "technique", "act now", "do "],
    "EXPLORE": ["talk", "share", "express", "journal", "question", "describe", "discuss",
                "explore", "reflect"],
}


def categorize_intervention(action: str) -> Optional[str]:
    """Best-guess EXPLORE/COMFORT/ACT for one approved-intervention string,
    by simple keyword count. None means "couldn't tell" - that's still a
    perfectly safe, usable action, just not one we can match to a stage."""
    low = (action or "").lower()
    scores = {cat: sum(1 for kw in kws if kw in low) for cat, kws in _CATEGORY_KEYWORDS.items()}
    best_cat = max(scores, key=scores.get)
    return best_cat if scores[best_cat] > 0 else None
