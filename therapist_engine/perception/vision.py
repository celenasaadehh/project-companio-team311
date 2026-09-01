"""Privacy-preserving context extraction for the glasses camera.

The product contract is intentionally small: the camera may describe scene context,
but it must not infer a psychiatric state or identify people. Low-confidence results
become ``unknown`` rather than a definite trigger.
"""
from __future__ import annotations

import os
from typing import Any

MIN_CONTEXT_CONFIDENCE = 0.70
SUPPORTED_CONTEXTS = {"crowd", "roadside_object", "fireworks", "loud_vehicle", "calm", "unknown"}


def _context(name: str, confidence: float, raw_labels: list[str] | None = None) -> dict[str, Any]:
    confidence = max(0.0, min(1.0, float(confidence)))
    normalized = name if name in SUPPORTED_CONTEXTS else "unknown"
    if confidence < MIN_CONTEXT_CONFIDENCE:
        normalized = "unknown"
    return {
        "context": normalized,
        "confidence": round(confidence, 3),
        "raw_labels": raw_labels or [],
        "is_definite_trigger": normalized not in {"unknown", "calm"},
        "retention": "raw frame not retained by this module",
    }


def analyze_image(image_bytes: bytes | None = None, demo_scene: str | None = None) -> dict[str, Any]:
    """Return one structured scene-context event; never face identity/emotion."""
    use_aws = os.getenv("USE_AWS", "false").lower() == "true"

    if use_aws and image_bytes is not None:
        import boto3
        client = boto3.client("rekognition", region_name=os.getenv("AWS_REGION", "us-east-1"))
        resp = client.detect_labels(Image={"Bytes": image_bytes}, MaxLabels=15, MinConfidence=50)
        labels = [(str(x["Name"]).lower(), float(x["Confidence"]) / 100.0) for x in resp.get("Labels", [])]
        names = [x[0] for x in labels]
        best = max([x[1] for x in labels], default=0.0)

        # Map real Rekognition labels -> our trigger vocabulary. We ADD the matched
        # trigger keyword to raw_labels so the API's TRIGGER_LIBRARY lookup fires.
        def has(*words):
            return any(any(w in n for w in words) for n in names)

        if has("crowd", "people", "audience", "parade"):
            return _context("crowd", best, names + ["crowd"])
        if has("firework", "explosion", "fire", "flame", "smoke"):
            return _context("fireworks", best, names + ["fireworks"])
        if has("truck", "bus", "vehicle", "traffic", "motorcycle"):
            return _context("loud_vehicle", best, names + ["truck"])
        if has("trash", "garbage", "bag", "litter", "plastic bag", "debris", "waste"):
            return _context("roadside_object", best, names + ["trash bag"])
        # Nothing matched a known trigger — real "all calm" from Rekognition.
        return _context("calm" if names else "unknown", best, names)

    demo = {
        "crowd": ("crowd", 0.94, ["crowd", "people", "street"]),
        "trash bag": ("roadside_object", 0.82, ["trash bag", "bag", "road"]),
        "fireworks": ("fireworks", 0.95, ["fireworks", "sky"]),
        "loud vehicle": ("loud_vehicle", 0.84, ["truck", "vehicle", "road"]),
        "calm": ("calm", 0.92, ["room", "furniture", "indoors"]),
        "uncertain": ("crowd", 0.42, ["people?"]),
    }
    return _context(*demo.get((demo_scene or "uncertain").lower(), ("unknown", 0.35, [])))
