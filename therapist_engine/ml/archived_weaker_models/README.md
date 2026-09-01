# Archived — not deleted, not wired into anything

Moved here 2026-08-30 to keep `ml/` organized. Nothing in the app (live API,
demo screens, or otherwise) loads or references these — confirmed by
repo-wide grep before moving. Kept intact for the record, not because
they're needed to run anything.

## `detector_embeddings/` (MiniLM sentence embeddings + LogisticRegression)
- Real accuracy: 73.2% (see `therapist_engine/ml/detector_metrics.json`)
- Why it's here: never loaded by `api/main.py` at all. Its 73.2% only ever
  appeared as a static comparison number on the `DetectorsDemo` mobile
  screen, never a real prediction.
- To bring it back: write a small loader (same pattern as
  `src/engines/text_distress_detector.py`) that embeds text with
  `sentence-transformers` first, then calls this classifier on the
  resulting vector. Make sure `sentence-transformers` is installed.

## `detector_tfidf/` (TF-IDF + LogisticRegression)
- Real accuracy: 67.8% — the weakest of the 3 trained approaches.
- Why it's here: 2026-08-30, this used to be the ONLY detector actually
  wired into the live `/api/detect` endpoint (the weakest one, running live,
  while the "selected" DistilBERT model sat unused — a real inconsistency).
  Fixed by wiring DistilBERT into `/api/detect` instead
  (`src/engines/text_distress_detector.py`) and archiving this one.
- To bring it back: point a loader at
  `archived_weaker_models/detector_tfidf/model.joblib` and call
  `.predict([text])[0]` — it's a plain sklearn Pipeline, no extra
  dependencies beyond scikit-learn/joblib (already required either way).
