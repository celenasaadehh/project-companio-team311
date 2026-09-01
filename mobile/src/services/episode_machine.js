// Episode state machine: decides when each engine is consulted.
import { startEpisode, closeEpisode as closeSharedEpisode } from "./episode";

export const EpisodeState = {
  OFF: "OFF",
  BASELINE: "BASELINE",
  WATCHING: "WATCHING",
  CHECK_IN: "CHECK_IN",
  CONTEXT_CAPTURE: "CONTEXT_CAPTURE",
  SUPPORT: "SUPPORT",
  ESCALATION: "ESCALATION",
  RECOVERY: "RECOVERY",
};

export const TIMING = {
  watchingMs: 15 * 1000,
  checkInMs: 10 * 1000,
  supportMs: 150 * 1000,
  recoveryMs: 120 * 1000,
  maxInterventions: 3,
};

const ELEVATED = new Set(["elevated", "high"]);

export function newEpisode(patientId) {
  return {
    episode_id: startEpisode(patientId, "state_machine").episode_id,
    patient_id: patientId,
    state: EpisodeState.BASELINE,
    since: Date.now(),
    started: null,
    timeline: [],
    riskTrail: [],
    context: {},
    patientResponse: null,
    interventions: [],
    captureRequested: false,
    reason: null,
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

  if (patientResponse) {
    ep.patientResponse = patientResponse;
    log(ep, { patient_response: patientResponse });

    if (patientResponse === "need_support") {
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
      if (!elevated) {
        transition(ep, EpisodeState.BASELINE, "settled without intervention");
        break;
      }
      if (heldFor(ep) > TIMING.watchingMs) {
        // "Explained" means the patient DECLARED a cause (exercise, coffee,
        // poor sleep) -- their input stands down the escalation. The score
        // damping flag is not a declaration: it is active near-constantly by
        // design, and treating it as an explanation silenced check-ins for
        // every genuinely rising patient below "high".
        const explained = Object.keys(ep.context).length > 0;
        if (explained && level !== "high") break;
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
      if (!elevated) {
        transition(ep, EpisodeState.BASELINE, "settled while awaiting answer");
        break;
      }
      if (heldFor(ep) > TIMING.checkInMs) {
        // Sustained elevation with no declared cause and an ignored check-in
        // is reason enough to look. Requiring "high" here meant the camera
        // practically never engaged: the damped score rarely crosses it.
        if (permissions.autoCapture && !ep.captureRequested
            && ELEVATED.has(level) && Object.keys(ep.context).length === 0) {
          ep.captureRequested = true;
          transition(ep, EpisodeState.CONTEXT_CAPTURE, "no answer, risk sustained, no declared cause");
          actions.push({ type: "CAPTURE_CONTEXT", single: true });
        } else {
          transition(ep, EpisodeState.SUPPORT, "no answer, risk sustained");
          actions.push({ type: "OPEN_SUPPORT", source: "automatic_detection" });
        }
      }
      break;

    case EpisodeState.CONTEXT_CAPTURE:
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

export function endEpisode(ep, outcome = null) {
  const summary = summarize(ep);
  const resolved = outcome
    || (ep.state === EpisodeState.RECOVERY ? "recovered"
        : ep.state === EpisodeState.ESCALATION ? "escalated"
        : "closed");
  closeSharedEpisode(resolved);
  return { ...summary, outcome: resolved };
}
