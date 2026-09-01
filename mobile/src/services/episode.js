// The shared episode id stamped on every stored record.
import * as SecureStore from "expo-secure-store";

const KEY = "companio.episode.current";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let current = null;
let restored = false;

function makeId() {
  return `EP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function restoreEpisode() {
  if (restored) return current;
  restored = true;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const ep = JSON.parse(raw);
      if (ep && Date.now() - (ep.last_activity_at || 0) < IDLE_TIMEOUT_MS) current = ep;
      else current = null;
    }
  } catch {
    current = null;
  }
  return current;
}

async function persist() {
  try {
    if (current) await SecureStore.setItemAsync(KEY, JSON.stringify(current));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
  }
}

export function startEpisode(patientId, reason, context = {}) {
  const now = Date.now();
  if (current && current.patient_id === patientId
      && now - current.last_activity_at < IDLE_TIMEOUT_MS) {
    current.last_activity_at = now;
    persist();
    return current;
  }
  current = {
    episode_id: makeId(),
    patient_id: patientId,
    started_at: new Date(now).toISOString(),
    opened_by: reason || "unknown",
    opening_context: {
      risk_level: context.risk_level ?? null,
      risk_score: context.risk_score ?? null,
      hr: context.hr ?? null,
      hrv: context.hrv ?? null,
      hr_freshness: context.hrFreshness ?? null,
      confounds: context.confounds ?? null,
    },
    last_activity_at: now,
    closed_at: null,
    outcome: null,
  };
  persist();
  return current;
}

export function getEpisode() {
  if (current && Date.now() - current.last_activity_at >= IDLE_TIMEOUT_MS) {
    current = null;
    persist();
  }
  return current;
}

export function getEpisodeId() {
  return getEpisode()?.episode_id || null;
}

export function touchEpisode() {
  const ep = getEpisode();
  if (ep) { ep.last_activity_at = Date.now(); persist(); }
  return ep;
}

export function closeEpisode(outcome = "recovered") {
  const ep = getEpisode();
  if (!ep) return null;
  ep.closed_at = new Date().toISOString();
  ep.outcome = outcome;
  const closed = { ...ep };
  current = null;
  persist();
  return closed;
}

export function withEpisode(payload = {}) {
  const ep = getEpisode();
  if (!ep) return payload;
  ep.last_activity_at = Date.now();
  persist();
  return {
    ...payload,
    episode_id: ep.episode_id,
    episode_started_at: ep.started_at,
    episode_opened_by: ep.opened_by,
  };
}

export function recordOfferedAction(action) {
  const ep = getEpisode();
  if (!ep || !action) return;
  ep.offered_actions = ep.offered_actions || [];
  if (!ep.offered_actions.includes(action)) ep.offered_actions.push(action);
  ep.last_activity_at = Date.now();
  persist();
}

export function offeredActions() {
  return getEpisode()?.offered_actions || [];
}

// Bridge between "did that help?" answers (which arrive via notification
// actions or follow-up cards) and the episode state machine (which polls).
// One-shot: consumed by the next machine step, so a single answer cannot
// drive two transitions.
let pendingOutcome = null;
export function recordInterventionOutcome(helped) {
  pendingOutcome = helped === true ? true : helped === false ? false : null;
}
export function consumeInterventionOutcome() {
  const v = pendingOutcome;
  pendingOutcome = null;
  return v;
}

// Same one-shot pattern for patient responses arriving from notification
// actions ("I need help", "I'm okay") outside the Monitor's render tree.
let pendingResponse = null;
export function recordPatientResponse(response) {
  pendingResponse = response || null;
}
export function consumePatientResponse() {
  const v = pendingResponse;
  pendingResponse = null;
  return v;
}
