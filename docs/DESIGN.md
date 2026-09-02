# Companio — design notes

The long-form version of what the README summarises.

## The problem

PTSD episodes happen between appointments. Someone may see a therapist for
one hour a week and face triggers in any of the other 167.

Two gaps make that worse. The clinician never sees what happened: the next
session relies on the patient's recollection of an event they were, by
definition, in no state to remember accurately. And generic self-help can
cause harm: prolonged breathwork can trigger panic, body scans can deepen
dissociation. An app that suggests interventions without knowing the
individual can worsen the episode it is trying to help.

## Features in full

**For the patient**

- Live physiological monitoring from an Apple Watch through HealthKit: heart
  rate, HRV, sleep, steps, scored against the patient's own calibrated calm
  baseline, refreshed every 5 seconds while the app is open.
- Voice check-ins: speak or type "I'm anxious" and the decision engine
  answers with an intervention the therapist approved, spoken aloud.
  "Hey Companio" starts listening on the support tab; a Siri shortcut
  ("Hey Siri, Companio") opens the app already listening from anywhere,
  including the lock screen.
- Interventions that actually deliver: a recorded voice message plays, a
  video link opens (announced first, never yanked), guided grounding is
  spoken step by step, a call sheet dials a chosen contact. One tap answers
  "did that help?", and the answer trains the personalisation model.
- Trigger-aware camera: when physiology rises and a check-in goes
  unanswered, the camera activates itself (announced by a notification that
  also offers talking instead), samples the surroundings every ~6 seconds,
  and checks each frame against the therapist's trigger list with
  Rekognition.
- Declared context: the patient can say "I'm exercising" or "just had
  coffee" and the escalation stands down. Their own explanation outranks
  the sensors.

**For the therapist**

- A live caseload dashboard that pages only when a patient's risk actually
  rose, with the peak score, the time, and what was offered.
- A complete clinical record per patient, loaded from AWS: episodes
  assembled into single incidents, every decision with the layer that made
  it, risk history as a scored timeline, transcripts of both sides of every
  exchange, camera captures with the image, the recognised labels and the
  heart rate against baseline.
- Unseen-trigger review: when the body reacts to something not on the
  trigger list, the capture is kept and flagged "not a registered trigger,
  review whether this belongs on the list" so the care plan grows from
  evidence.
- Full authorship of the care plan: approved and forbidden interventions,
  known triggers, safety rules with exact wording, attached resources
  (recordings, links, phone numbers, step lists), medications, and
  conditional bans ("not during exercise").

## How an episode unfolds

1. Risk rises above the patient's baseline and holds for **15 seconds**.
   Readings older than 3 minutes never escalate anything.
2. A check-in notification asks **"Are you okay?"** with one-tap answers.
   Answering "I'm okay" or declaring a cause (exercise, caffeine, poor
   sleep) stands the episode down.
3. **No answer for 10 seconds** with no declared cause: the app announces
   "Activating the camera", opens the camera screen itself, and starts
   burst-scanning the surroundings.
4. A frame matching a known trigger, corroborated by the physiology, fires
   the therapist's rule for that trigger, in the therapist's own words. A
   reacting body with no known trigger still gets the full support ladder,
   and the capture is kept for therapist review.
5. Interventions walk the approved list in order, skipping anything already
   tried this episode. Only when every approved option is exhausted does
   Companio escalate: "Let's bring in your therapist."
6. Everything is written to the clinical record with retries until it
   lands: the episode, each decision and its trace, the physiology series
   (a sample every 15 seconds during an episode), captures with images, and
   both sides of every exchange.

## Design commitments

**Identity separation.** Real names and photographs live in
`CompanioIdentity`. Clinical records — profiles, sessions, decisions,
media — live in separate tables that never contain a name, enforced
server-side rather than trusted to the client.

**Nothing fabricated.** Where data is unavailable the interface says so. It
never shows a placeholder number, and never reports a message as delivered
when it was not.

**The safety filter blocks false safety guarantees** — "you are safe",
"there is no danger" — because the app cannot verify them and being wrong
once destroys trust in everything else it says.

**When every approved intervention has been tried and none helped,**
Companio does not invent a new one. It says what we tried isn't working and
offers to reach a person.

## Machine learning: stated limitations

Reported because overstating them would be the more serious error.

- **The 16-feature model cannot run on an Apple Watch.** 72.8% of its
  decision power comes from electrodermal activity and skin temperature,
  which HealthKit does not expose. The 9-feature Watch model exists for
  that reason and scores lower. The app names which engine produced every
  score, and 0.987 is never presented as live Watch performance.
- **Three subjects.** A prototype result, not a population claim.
- **The recommender's 80% is on 15 examples** — too small to support a
  confident accuracy claim. The sample size is reported alongside it.
- **The distress detector is trained on Reddit text,** not clinical speech.
- The comparison models (TF-IDF 0.766, MiniLM 0.831) are kept in
  `therapist_engine/ml/archived_weaker_models/` and reported by
  `/api/models`, so the choice of DistilBERT is evidenced rather than
  asserted.

## Privacy

- Photos, audio and images are stored in a KMS-encrypted bucket and
  reachable only through short-lived presigned URLs. There are no public
  links.
- The patient controls monitoring, camera, microphone, transcript
  retention, audio retention, image retention, therapist alerts and
  caregiver escalation independently. Each switch is read by the code that
  performs the behaviour.
- Turning retention off stops the file being kept on the clinical record
  and shown to the therapist, with one deliberate exception: a capture
  taken during an episode (a corroborated trigger, an unseen-trigger
  moment, or an automatic monitoring capture) is retained as clinical
  evidence the therapist reviews, because a label alone does not let a
  clinician judge whether something belongs on the trigger list. Casual
  scans while the patient is calm are discarded as the switch instructs.
  Deleting a retained object from storage is not yet implemented, and the
  interface does not claim otherwise.
- Monitoring can be paused for a chosen period.

## Known limitations

- **Monitoring is not continuous in the background.** The state machine
  advances while the app is foregrounded. True background monitoring needs
  native HealthKit background delivery.
- **No smart-glasses hardware yet, but the seam for it exists.** Capture
  goes through a provider interface, so camera-equipped smart glasses can
  slot in as an alternate frame source without touching the decision
  pipeline. Candidates: Meta's Ray-Ban glasses through the Wearables
  Device Access Toolkit (in developer preview), or Mentra's
  camera-equipped glasses through MentraOS, whose SDK is open today.
  Frames from glasses enter the same upload, recognition and
  trigger-matching path, with a different provenance. Glasses riding the
  patient's own gaze are the hardware endgame; one phone lens sees one
  direction at a time, and burst sampling sweeps as the patient moves.
- **The wake word works inside the app.** "Hey Companio" listens on the
  support tab; outside the app, the Siri shortcut is the sanctioned path —
  iOS reserves always-on listening for Siri.
- **The inference service must be reachable for the trained models.** When
  it is not, the app falls back to the Lambda decision path, which
  enforces the same care-plan boundaries with the same ordered
  intervention ladder, and the record says which engine answered.
  `deploy/` documents hosting the engine on App Runner.
