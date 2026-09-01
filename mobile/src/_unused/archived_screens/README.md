# Archived — not deleted, not wired into navigation

## `demo.js` (moved 2026-08-30)
The "Engine demo" screens (`DemoHome`, `RiskEngineDemo`, `TherapistEngineDemo`,
`DecisionDemo`, `DetectorsDemo`, `FullPipeline`, `PrivacyScreen`) walked
through a **scripted, hardcoded scenario** — fake patient data ("Alex
Johnson", "P-001 · crowds · loud bangs"), canned timelines, offline-only
logic. Removed from `RootNavigator.js` and the therapist "More" menu because
it never reflected what the app actually did.

Replaced by two real screens that only ever show genuine data:
- `screens/inspector.js` (`DecisionInspector`) — reads real decisions from
  `CompanioDecisions` via `getDecisions()` and walks through the *actual*
  reasoning trace (rule match, distress gate, recommender stage, bandit pick,
  safety check) for whatever really happened.
- `screens/features_hub.js` (`FeaturesHub`) — a real status dashboard, not a
  demo.

To bring the old demo screens back: re-add the import in `RootNavigator.js`
pointing at `../screens/archived/demo` and re-add the `TS.Screen` entries.
