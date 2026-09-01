# =============================================================================
# train_recommender.py  -  YOUR OWN ML MODEL (Engine 2's recommender)
# =============================================================================
# THE STORY (read this first):
#   This trains YOUR own machine-learning model - the "unforeseen" engine.
#   When no therapist rule matches a moment, this model reads what the person
#   expressed and RECOMMENDS what KIND of support fits, as one of 3 stages:
#
#       EXPLORE  = ask gently / understand ("tell me what's happening")
#       COMFORT  = reassure / validate     ("that sounds really hard, I'm here")
#       ACT      = offer a concrete step   ("would it help to try breathing?")
#
#   TRAINING DATA (changed 2026-08-30 - READ THIS):
#   This used to train on ESConv (a real public counseling-conversation
#   dataset). We verified ESConv's own license directly from its source and
#   it says, verbatim: "Data and codes are for academic research use only."
#   That is a real legal blocker for a commercial App Store product, so this
#   script now trains on ml/data/companio_stage_examples.json instead - a
#   small, original set written specifically for PTSD-trigger situations
#   (not ESConv's general topics like breakups/school stress), owned
#   outright, with zero licensing risk. It is SMALLER than ESConv (~75
#   examples vs ~15,000), so expect a noisier accuracy number - that's the
#   honest tradeoff for data you can actually ship. See MODEL_CARD.md for
#   the full licensing writeup. The old ESConv path is kept below, clearly
#   marked, for reference only - it must never be the one that gets shipped.
#
#   IMPORTANT - this model only RECOMMENDS a stage. It never makes the final
#   decision: the therapist's rules win, and safety.py checks every word. So a
#   modest model is SAFE, not dangerous. This is honestly a "proof of concept",
#   like your friend's WESAD model - not clinically validated. The
#   companio_stage_examples.json data has NOT been reviewed by a licensed
#   clinician yet either - a real therapist should review/refine it before
#   this model is trusted for real users.
#
# HOW TO RUN IT (from the therapist_engine folder):
#   python3 ml/train_recommender.py
# =============================================================================

import json
from pathlib import Path

# joblib saves/loads a trained model to a file (same tool your friend used).
import joblib

# sklearn = the machine-learning toolbox. We use:
from sklearn.feature_extraction.text import TfidfVectorizer   # turn text -> numbers
from sklearn.linear_model import LogisticRegression           # the classifier
from sklearn.pipeline import Pipeline                          # chain the two steps
from sklearn.model_selection import train_test_split          # split train vs test
from sklearn.metrics import classification_report, f1_score, accuracy_score, confusion_matrix


# --- Where the data is, and where we will SAVE the trained model --------------
HERE = Path(__file__).parent                 # the "ml" folder this file lives in
DATA_FILE = HERE / "data" / "companio_stage_examples.json"   # first-party, ships in the app
ESCONV_DATA_FILE_REFERENCE_ONLY = HERE / "data" / "ESConv.json"  # academic-only - never train the shipped model on this
MODEL_FILE = HERE / "recommender_model.joblib"
METRICS_FILE = HERE / "recommender_metrics.json"


# --- Map the 8 ESConv strategies down to our 3 stages ------------------------
# Kept only so build_examples_esconv_REFERENCE_ONLY() below still runs for
# comparison/research - NOT used by the training path that ships.
STAGE = {
    "Question": "EXPLORE",
    "Restatement or Paraphrasing": "EXPLORE",
    "Reflection of feelings": "EXPLORE",
    "Self-disclosure": "COMFORT",
    "Affirmation and Reassurance": "COMFORT",
    "Providing Suggestions": "ACT",
    "Information": "ACT",
}


def build_examples():
    """
    THE TRAINING DATA THAT SHIPS. Reads ml/data/companio_stage_examples.json -
    a small, original, first-party set of (text, stage) pairs written for
    PTSD-trigger situations specifically, with zero licensing risk (see the
    module docstring above for why this replaced ESConv).
    """
    payload = json.load(open(DATA_FILE, encoding="utf-8"))
    texts = [ex["text"] for ex in payload["examples"]]
    labels = [ex["stage"] for ex in payload["examples"]]
    return texts, labels


def build_examples_esconv_REFERENCE_ONLY():
    """
    NOT used to train the shipped model - ESConv is "academic research use
    only" per its own README, a real licensing conflict with a commercial
    product. Kept only so you can still run a side-by-side comparison
    locally if useful; never call this from main().

    Each example is (text, stage):
      text  = the SINGLE most recent thing the help-seeker said (falling back
              to their initial situation description if nobody has spoken yet)
      stage = EXPLORE / COMFORT / ACT (the support the supporter then gave)

    (This function used to ACCUMULATE every seeker turn into one ever-growing
    block of text, which trained the model on long multi-sentence histories
    that didn't match the single-utterance inputs the app actually sends -
    fixed here too, in case this is ever run for comparison.)
    """
    data = json.load(open(ESCONV_DATA_FILE_REFERENCE_ONLY))
    texts, labels = [], []
    for conv in data:
        last_seeker_turn = conv.get("situation", "")
        for turn in conv["dialog"]:
            speaker = turn.get("speaker")
            if speaker == "seeker":
                content = (turn.get("content") or "").strip()
                if content:
                    last_seeker_turn = content
            elif speaker == "supporter":
                stage = STAGE.get(turn.get("annotation", {}).get("strategy"))
                if stage:  # skip "Others"
                    texts.append(last_seeker_turn)
                    labels.append(stage)
    return texts, labels


def main():
    if not DATA_FILE.exists():
        raise FileNotFoundError(f"Could not find {DATA_FILE}")

    # 1) Build the labelled examples from the real dataset.
    texts, labels = build_examples()
    print("Training examples:", len(texts))

    # 2) Split into a TRAIN set (to learn from) and a TEST set (to grade fairly).
    #    "stratify=labels" keeps the 3 stages balanced across both sets.
    X_train, X_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.2, random_state=42, stratify=labels
    )

    # 3) Build the model as a 2-step Pipeline:
    #      step 1: TfidfVectorizer turns each text into a row of numbers, where
    #              important words get bigger numbers (TF-IDF = a classic way to
    #              turn text into features).
    #      step 2: LogisticRegression is the classifier that learns to map those
    #              numbers to EXPLORE / COMFORT / ACT.
    #    "class_weight='balanced'" makes it treat the 3 stages fairly.
    model = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=20000)),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
    ])

    # 4) TRAIN it (.fit = learn the pattern from the training examples).
    model.fit(X_train, y_train)

    # 5) GRADE it on the unseen test set (the scores you learned earlier).
    predictions = model.predict(X_test)
    acc = accuracy_score(y_test, predictions)
    macro_f1 = f1_score(y_test, predictions, average="macro")
    print(f"\nAccuracy: {acc:.3f}   (random guessing among 3 classes = 0.333)")
    print(f"Macro F1: {macro_f1:.3f}")
    print("\nPer-stage report:")
    print(classification_report(y_test, predictions))

    # 6) SAVE the trained model so the engine can load it later (no re-training).
    joblib.dump(model, MODEL_FILE)
    print("Saved model to:", MODEL_FILE)

    # 6b) SAVE the real metrics too, so this file is always the source of
    # truth (no more hand-copied numbers drifting out of date elsewhere).
    labels_sorted = sorted(set(y_test))
    report = classification_report(y_test, predictions, output_dict=True)
    metrics = {
        "dataset": "companio_stage_examples.json (first-party, not ESConv)",
        "task": "3-class support-stage recommendation (single most-recent utterance)",
        "split": "80/20 stratified random_state=42",
        "test_examples": len(y_test),
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "classes": {
            label: {
                "precision": round(report[label]["precision"], 2),
                "recall": round(report[label]["recall"], 2),
                "f1": round(report[label]["f1-score"], 2),
                "support": int(report[label]["support"]),
            }
            for label in labels_sorted
        },
        "confusion_matrix_labels": labels_sorted,
        "confusion_matrix": confusion_matrix(y_test, predictions, labels=labels_sorted).tolist(),
        "status": "proof-of-concept advisory only; therapist rules + safety decide",
    }
    with open(METRICS_FILE, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print("Saved metrics to:", METRICS_FILE)

    # 7) A couple of quick example predictions, so you can SEE it work.
    print("\nExample recommendations:")
    for sample in [
        "I don't even know where to start, everything feels like too much.",
        "I just feel so alone and scared right now.",
        "I keep panicking whenever I'm in a crowd, what can I do?",
    ]:
        print(f"  '{sample[:45]}...' -> {model.predict([sample])[0]}")

    # An honest reminder about what this model is (and is not).
    print(
        "\nNOTE: proof-of-concept trained on ml/data/companio_stage_examples.json "
        "(a small, original, first-party set - NOT ESConv, which is academic-"
        "research-only). It only RECOMMENDS a support stage; therapist rules + "
        "safety.py still decide. Not clinically validated, and the accuracy "
        "above is measured on only ~15 held-out examples - treat it as noisy, "
        "not a real-world guarantee."
    )


if __name__ == "__main__":
    main()
