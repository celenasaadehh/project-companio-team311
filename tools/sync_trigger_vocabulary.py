#!/usr/bin/env python3
"""Regenerate every consumer of the canonical trigger vocabulary.

Run after editing shared/trigger_vocabulary.json:

    python3 tools/sync_trigger_vocabulary.py

Three separate implementations of trigger matching used to be maintained by
hand and had drifted apart in ways that changed clinical behaviour. Adding an
alias in one place and not the others is exactly how that happened, so the
vocabulary now lives in one JSON file and everything else is generated or
reads it directly.

  mobile/src/data/trigger_vocabulary.json  copied from the source
  aws/lambda_function.py                   generated block, rewritten here
  therapist_engine                          reads shared/ directly at import
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "shared" / "trigger_vocabulary.json"
MOBILE_COPY = ROOT / "mobile" / "src" / "data" / "trigger_vocabulary.json"
LAMBDA = ROOT / "aws" / "lambda_function.py"


def build_block(v: dict) -> str:
    out = [
        "# =============================================================================",
        "# TRIGGER VOCABULARY — GENERATED. DO NOT EDIT BY HAND.",
        "#",
        "# Source of truth: shared/trigger_vocabulary.json",
        "# Regenerate with: python3 tools/sync_trigger_vocabulary.py",
        "# =============================================================================",
        f"TRIGGER_VOCABULARY_VERSION = {v['version']}",
        f"WEAK_MATCH_FACTOR = {v['weak_match_factor']!r}",
        f"DEFAULT_TRIGGER_THRESHOLD = {v['default_threshold']!r}",
        f"MIN_LABEL_CONFIDENCE = {v['min_label_confidence']!r}",
        "",
        "# Specific aliases: a match here is real evidence and can stand alone.",
        "TRIGGER_ALIASES = {",
    ]
    for c, d in v["concepts"].items():
        out.append("    %r: {%s}," % (c, ", ".join(repr(a) for a in d["specific"])))
    out += ["}", "",
            "# Weak aliases: everyday words that cannot fire a trigger on their own.",
            "WEAK_TRIGGER_ALIASES = {"]
    for c, d in v["concepts"].items():
        if d.get("weak"):
            out.append("    %r: {%s}," % (c, ", ".join(repr(a) for a in d["weak"])))
    out += ["}", "",
            "# Never evidence of anything; discarded before matching.",
            "GENERIC_LABELS = {%s}" % ", ".join(repr(g) for g in v["generic"])]
    return "\n".join(out) + "\n"


def main() -> None:
    vocab = json.loads(SRC.read_text())

    MOBILE_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC, MOBILE_COPY)
    print(f"  copied  -> {MOBILE_COPY.relative_to(ROOT)}")

    src = LAMBDA.read_text()
    m = re.search(r"# =+\n# TRIGGER VOCABULARY.*?\nGENERIC_LABELS = \{[^}]*\}\n"
                  r"|TRIGGER_ALIASES = \{.*?\n\}\n", src, re.S)
    if not m:
        raise SystemExit("could not find the vocabulary block in lambda_function.py")
    LAMBDA.write_text(src[:m.start()] + build_block(vocab) + src[m.end():])
    print(f"  wrote   -> {LAMBDA.relative_to(ROOT)}")

    print(f"\nvocabulary v{vocab['version']}: "
          f"{len(vocab['concepts'])} concepts, {len(vocab['generic'])} generic labels")
    print("NOTE: lambda_function.py must be redeployed for this to take effect.")


if __name__ == "__main__":
    main()
