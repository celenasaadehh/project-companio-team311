# Unused code

Nothing in this folder is imported by the application. It is kept rather than
deleted because each item documents a real decision, and losing that history
would make the project harder to review.

## proposed_episode_machine/
The original draft of the episode state machine. Superseded by
`src/services/episode_machine.js`, which was promoted from it and is what the
app actually runs. Kept to show the design before it was wired in.

## archived_screens/
- `demo.js` — an early scripted walkthrough. Removed because it displayed
  hardcoded values (fabricated accuracy figures and a fixed patient) that could
  be mistaken for real output.
- `episode.js` — an earlier per-episode screen, replaced by
  `src/screens/episodes.js` and `src/screens/event_detail.js`.

## What is NOT here
The weaker distress-detection models (TF-IDF and sentence embeddings) live in
`therapist_engine/ml/archived_weaker_models/`. They are deliberately retained:
`/api/models` reports all three approaches with their real scores, which is how
the project shows that the fine-tuned DistilBERT was chosen on evidence rather
than assertion.

Note that TF-IDF is still used at runtime in `therapist_engine/api/main.py` for
knowledge-base retrieval. That is a different component from the archived
detector and must not be removed.
