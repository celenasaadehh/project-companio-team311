"""Canonical trigger vocabulary, loaded from shared/trigger_vocabulary.json.

Trigger matching was implemented three times independently -- here, in the
mobile client, and in the Lambda -- and the copies had drifted. The Lambda
mapped "person" onto the "crowd" trigger while the mobile client discarded
"person" as a generic label, so the same photograph matched a trigger on one
path and not the other, and which engine happened to answer decided whether a
patient was told they had seen their trigger.

This module reads the one shared file so the engine cannot drift again.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

_PATH = Path(__file__).resolve().parents[3] / "shared" / "trigger_vocabulary.json"

_VOCAB: Optional[dict] = None


def vocabulary() -> dict:
    """The shared vocabulary. Falls back to an empty set of concepts if the
    file is missing, which degrades matching to exact string comparison rather
    than crashing a decision that is happening during a patient episode."""
    global _VOCAB
    if _VOCAB is None:
        try:
            _VOCAB = json.loads(_PATH.read_text())
        except Exception:
            _VOCAB = {"concepts": {}, "generic": [], "weak_match_factor": 0.35,
                      "default_threshold": 0.5, "version": 0}
    return _VOCAB


def _alias_map() -> dict[str, tuple[str, bool]]:
    """alias -> (canonical concept, is_weak)."""
    out: dict[str, tuple[str, bool]] = {}
    v = vocabulary()
    for concept, spec in v.get("concepts", {}).items():
        out[concept.lower()] = (concept, False)
        for a in spec.get("specific", []):
            out[a.lower()] = (concept, False)
    for concept, spec in v.get("concepts", {}).items():
        for a in spec.get("weak", []):
            # A specific alias always wins if a word appears in both lists.
            out.setdefault(a.lower(), (concept, True))
    return out


def canonical(label: str) -> Optional[str]:
    """Map one perception label to its canonical concept.

    Returns None for generic labels (a person, a face, "outdoors") -- these are
    never evidence of a trigger and must not reach matching.
    """
    s = (label or "").strip().lower()
    if not s:
        return None
    if s in {g.lower() for g in vocabulary().get("generic", [])}:
        return None
    hit = _alias_map().get(s)
    return hit[0] if hit else s


def is_weak(label: str) -> bool:
    """True when the label reaches its concept only through an everyday word
    ("bag" -> trash bag). Such a match must never fire a trigger alone."""
    hit = _alias_map().get((label or "").strip().lower())
    return bool(hit and hit[1])


def normalize_all(labels) -> set[str]:
    """Canonical concepts for a list of labels, generic ones dropped."""
    out = set()
    for l in labels or []:
        c = canonical(l)
        if c:
            out.add(c)
    return out
