# =============================================================================
# text_distress_detector.py  -  loads the REAL, fine-tuned DistilBERT model
# and runs it. This is the one actually wired into the live /api/detect
# endpoint - the best of the three trained approaches (78.5% accuracy),
# not a placeholder and not the weaker TF-IDF stand-in it used to load.
# =============================================================================
# THE STORY:
#   ml/detector_bert/train.py fine-tuned a real DistilBERT transformer on
#   Dreaddit's PTSD + anxiety posts and saved the trained weights to
#   ml/detector_bert/bert_model/. THIS file loads those saved weights (lazily,
#   on first use - it's a ~260MB model, no need to block server startup) and
#   turns one sentence into "stress" or "not_stress".
#
#   Same fail-closed pattern as intervention_recommender.py: if the model
#   can't load for any reason, this returns None instead of crashing, and
#   the caller (api/main.py) turns that into a clear 503, never a fake answer.
# =============================================================================
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ml/ lives two folders up from src/engines/ (therapist_engine/ml/...).
_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "ml" / "detector_bert" / "bert_model"
_ID2LABEL = {0: "not_stress", 1: "stress"}

_tokenizer = None
_model = None
_load_attempted = False


def _load():
    global _tokenizer, _model, _load_attempted
    if _load_attempted:
        return _tokenizer, _model
    _load_attempted = True
    try:
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        _tokenizer = AutoTokenizer.from_pretrained(str(_MODEL_DIR))
        _model = AutoModelForSequenceClassification.from_pretrained(str(_MODEL_DIR))
        _model.eval()
    except Exception as e:
        logger.warning("DistilBERT distress detector unavailable (%s); /api/detect will 503.", e)
        _tokenizer, _model = None, None
    return _tokenizer, _model


def predict_distress(text: str) -> Optional[str]:
    """
    GOES IN : text = a sentence to check.
    COMES OUT: "stress" | "not_stress", or None if the model isn't available
               or the text is empty - the caller must handle None explicitly.
    """
    tokenizer, model = _load()
    if tokenizer is None or model is None or not text or not text.strip():
        return None
    import torch  # imported lazily so importing this module stays cheap
    with torch.no_grad():
        inputs = tokenizer(text, truncation=True, padding=True, max_length=256, return_tensors="pt")
        logits = model(**inputs).logits
        pred_id = int(logits.argmax(dim=-1).item())
    return _ID2LABEL.get(pred_id)
