"""Privacy-minded audio context contract for the glasses prototype."""
from __future__ import annotations

import os

WAKE_WORD = "hey tatainaamazonchat"
VALID_NOISE_LEVELS = {"low", "elevated", "high", "unknown"}


def heard_wake_word(demo_transcript: str | None = None) -> bool:
    return bool(demo_transcript) and WAKE_WORD in demo_transcript.lower()


def analyze_audio(audio_uri: str | None = None, demo_transcript: str | None = None, demo_noise: str = "low") -> dict:
    use_aws = os.getenv("USE_AWS", "false").lower() == "true"
    noise = demo_noise.lower().strip() if demo_noise else "unknown"
    if noise not in VALID_NOISE_LEVELS:
        noise = "unknown"

    if use_aws and audio_uri is not None:
        # AWS Transcribe wiring belongs in the external-integration phase.
        # Fail closed locally instead of pretending a transcript exists.
        return {"transcript": "", "is_speaking": False, "noise_level": noise, "confidence": 0.0, "source": "aws_unconfigured"}

    transcript = (demo_transcript or "").strip()
    return {
        "transcript": transcript,
        "is_speaking": bool(transcript),
        "noise_level": noise,
        "confidence": 1.0 if transcript or noise != "unknown" else 0.0,
        "source": "demo",
    }
