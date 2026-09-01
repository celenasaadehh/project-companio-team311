// =============================================================================
// episode.js — the Companio episode state machine.
//
// Everything the app does during a difficult moment is decided here, in ONE
// place, rather than being scattered across the monitor, camera and voice
// screens each with their own ad-hoc rules. Screens render state; they no
// longer decide it.
//
// THE CORE PRINCIPLE
// A raised heart rate is not an episode. It is a question. The machine's job
// is to answer that question as cheaply and as privately as possible --
// preferring a harmless explanation, then asking the patient, and only
// escalating sensing or intervention when the evidence keeps getting
// stronger. Anything else produces false alarms, and an alarm the patient
// learns to ignore is worse than no alarm at all.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//  - It never records audio or video continuously. Physiological monitoring is
//    continuous; contextual capture is event-driven, single-shot, and only
//    with the patient's standing permission.
//  - It never treats silence as danger on its own. A phone in a pocket is the
//    most likely explanation for no answer. Silence only matters when the
//    signal ALSO keeps getting worse.
//  - It never closes an episode the moment numbers dip. It observes recovery.
// =============================================================================

export const EpisodeState = {
  OFF: "OFF",                         // patient paused monitoring
  BASELINE: "BASELINE",               // nothing unusual
  WATCHING: "WATCHING",               // something changed; looking for a benign reason
  CHECK_IN: "CHECK_IN",               // change persists; asked the patient
  CONTEXT_CAPTURE: "CONTEXT_CAPTURE", // no answer + still rising; look around (if permitted)
  SUPPORT: "SUPPORT",                 // likely distress; intervening
  ESCALATION: "ESCALATION",           // support isn't working; reach a human
  RECOVERY: "RECOVERY",               // settling; verify before closing
};

// How long each stage waits before it is allowed to progress. Deliberately
// generous: the cost of asking too early is that the patient stops trusting
// the app, which is far more expensive than a slightly slower response.
export const TIMING = {
  watchingMs: 90 * 1000,    // sustained change before we interrupt at all
  checkInMs: 90 * 1000,     // wait for an answer before considering more sensing
  supportMs: 150 * 1000,    // let an intervention actually work before judging it
  recoveryMs: 120 * 1000,   // observe before declaring the episode over
  maxInterventions: 3,      // then stop cycling and offer a person instead
};

// Risk levels that count as "something is happening".
const ELEVATED = new Set(["elevated", "high"]);

/** A fresh, closed episode. */
export function newEpisode(patientId) {
  return {
    episode_id: `E-${Date.now().toString(36)}`,
    patient_id: patientId,
    state: EpisodeState.BASELINE,
    since: Date.now(),          // when the current state was entered
    started: null,              // when the episode itself began
    timeline: [],               // every transition, for the therapist
    riskTrail: [],              // risk score over the episode
    context: {},                // confounders: caffeine / exercise / poor sleep
    patientResponse: null,      // what they said, if anything
    interventions: [],          // what has been tried
    captureRequested: false,    // one image at most, never a stream
    reason: null,               // why we are in this state
  };
}

function log(ep, entry) {
  ep.timeline.push({ at: new Date().toISOString(), ...entry });
  return ep;
}

function transition(ep, next, reason) {
  if (ep.state === next) return ep;
  log(ep, { from: ep.state, to: next, reason });
  ep.state = next;
  ep.since = Date.now();
  ep.reason = reason;
  if (next !== EpisodeState.BASELINE && !ep.started) ep.started = Date.now();
  return ep;
}

const heldFor = (ep) => Date.now() - ep.since;

/**
 * Advance the machine one tick.
 *
 * input:
 *   risk            {level, score, confounded, confoundReasons}  from health.js
 *   patientResponse "okay" | "need_support" | "exercise" | "caffeine" |
 *                   "poor_sleep" | "dismiss" | null
 *   permissions     { autoCapture, therapistAlerts, caregiverEscalation }
 *   interventionHelped  true | "a_little" | false | null
 *
 * Returns { episode, actions } — actions are what the UI/notifier should DO.
 * The machine never performs side effects itself, which keeps it testable and
 * keeps every decision auditable in one place.
 */
export function step(ep, input = {}) {
  const {
    risk = null,
    patientResponse = null,
    permissions = {},
    interventionHelped = null,
    monitoringPaused = false,
  } = input;

  const actions = [];
  const level = risk?.level || "unknown";
  const elevated = ELEVATED.has(level);

  if (risk?.score != null) {
    ep.riskTrail.push({ at: Date.now(), score: risk.score, level });
    if (ep.riskTrail.length > 200) ep.riskTrail.shift();
  }

  // The patient's own words always outrank the sensors, in both directions.
  if (patientResponse) {
    ep.patientResponse = patientResponse;
    log(ep, { patient_response: patientResponse });

    if (patientResponse === "need_support") {
      // Never make someone asking for help wait on a risk score.
      transition(ep, EpisodeState.SUPPORT, "patient asked for support");
      actions.push({ type: "OPEN_SUPPORT", source: "patient_request" });
      return { episode: ep, actions };
    }
    if (["exercise", "caffeine", "poor_sleep"].includes(patientResponse)) {
      ep.context[patientResponse] = Date.now();
      transition(ep, EpisodeState.WATCHING, `explained by ${patientResponse}`);
      return { episode: ep, actions };
    }
    if (patientResponse === "okay" || patientResponse === "dismiss") {
      transition(ep, EpisodeState.WATCHING, "patient said they're okay");
      return { episode: ep, actions };
    }
  }

  if (monitoringPaused) {
    transition(ep, EpisodeState.OFF, "monitoring paused by patient");
    return { episode: ep, actions };
  }
  if (ep.state === EpisodeState.OFF) {
    transition(ep, EpisodeState.BASELINE, "monitoring resumed");
    return { episode: ep, actions };
  }

  switch (ep.state) {
    case EpisodeState.BASELINE:
      if (elevated) transition(ep, EpisodeState.WATCHING, `risk ${level}`);
      break;

    case EpisodeState.WATCHING:
      // Settled on its own: the overwhelmingly common case. Close quietly and
      // never mention it -- most physiological blips mean nothing.
      if (!elevated) {
        transition(ep, EpisodeState.BASELINE, "settled without intervention");
        break;
      }
      // A known confounder doesn't disable detection, it just raises the bar.
      if (heldFor(ep) > TIMING.watchingMs) {
        const explained = risk?.confounded || Object.keys(ep.context).length > 0;
        if (explained && level !== "high") break; // keep watching, don't interrupt
        transition(ep, EpisodeState.CHECK_IN, "change persisted");
        actions.push({
          type: "CHECK_IN",
          title: "Are you okay?",
          body: "Your signals changed. Tap to tell me how you're doing.",
          options: ["I'm okay", "I need support", "Exercise", "Caffeine", "Poor sleep"],
        });
      }
      break;

    case EpisodeState.CHECK_IN:
      // No answer + settling = nothing happened. Close it.
      if (!elevated) {
        transition(ep, EpisodeState.BASELINE, "settled while awaiting answer");
        break;
      }
      if (heldFor(ep) > TIMING.checkInMs) {
        // Only NOW does silence start to matter -- and only because the signal
        // is still bad, not because they didn't reply.
        if (permissions.autoCapture && !ep.captureRequested && level === "high") {
          ep.captureRequested = true;
          transition(ep, EpisodeState.CONTEXT_CAPTURE, "no answer, risk still high");
          actions.push({ type: "CAPTURE_CONTEXT", single: true });
        } else {
          transition(ep, EpisodeState.SUPPORT, "no answer, risk sustained");
          actions.push({ type: "OPEN_SUPPORT", source: "automatic_detection" });
        }
      }
      break;

    case EpisodeState.CONTEXT_CAPTURE:
      // Capture is one frame, then straight to support either way.
      transition(ep, EpisodeState.SUPPORT, "context captured");
      actions.push({ type: "OPEN_SUPPORT", source: "automatic_detection" });
      break;

    case EpisodeState.SUPPORT:
      if (interventionHelped === true) {
        transition(ep, EpisodeState.RECOVERY, "intervention helped");
        break;
      }
      if (interventionHelped === false) {
        if (ep.interventions.length >= TIMING.maxInterventions) {
          // Stop cycling. Repeating strategies that aren't working is its own
          // harm -- offer a person instead.
          transition(ep, EpisodeState.ESCALATION, "interventions exhausted");
          actions.push({ type: "OFFER_ESCALATION", therapist: !!permissions.therapistAlerts,
            caregiver: !!permissions.caregiverEscalation });
        } else {
          actions.push({ type: "TRY_ANOTHER_INTERVENTION", exclude: ep.interventions.slice() });
        }
        break;
      }
      if (!elevated && heldFor(ep) > TIMING.supportMs) {
        transition(ep, EpisodeState.RECOVERY, "signals settling");
      }
      break;

    case EpisodeState.ESCALATION:
      if (!elevated) transition(ep, EpisodeState.RECOVERY, "settling after escalation");
      break;

    case EpisodeState.RECOVERY:
      if (elevated) {
        transition(ep, EpisodeState.SUPPORT, "risk rose again during recovery");
        break;
      }
      if (heldFor(ep) > TIMING.recoveryMs) {
        actions.push({ type: "CONFIRM_RECOVERY", body: "Feeling more settled?" });
        transition(ep, EpisodeState.BASELINE, "episode closed");
        actions.push({ type: "CLOSE_EPISODE", episode: summarize(ep) });
      }
      break;

    default:
      break;
  }

  return { episode: ep, actions };
}

/** A therapist-readable summary — the record, not the raw sensor stream. */
export function summarize(ep) {
  const scores = ep.riskTrail.map((r) => r.score).filter((n) => n != null);
  return {
    episode_id: ep.episode_id,
    patient_id: ep.patient_id,
    type: "episode",
    started_at: ep.started ? new Date(ep.started).toISOString() : null,
    ended_at: new Date().toISOString(),
    duration_seconds: ep.started ? Math.round((Date.now() - ep.started) / 1000) : 0,
    risk_peak: scores.length ? Math.max(...scores) : null,
    risk_trail: scores.slice(-40),
    confounders: Object.keys(ep.context),
    patient_response: ep.patientResponse,
    interventions: ep.interventions,
    context_captured: ep.captureRequested,
    final_state: ep.state,
    timeline: ep.timeline,
  };
}
