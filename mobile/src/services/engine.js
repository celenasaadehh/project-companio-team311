// AWS API client: auth headers, retries, and every backend call.
import { AWS_API_BASE_URL as CFG_AWS_URL, THERAPIST_ENGINE_URL } from "../config";
import { getValidAccessToken, refreshSession } from "./auth";
import { withEpisode } from "./episode";

export const API_BASE_URL = THERAPIST_ENGINE_URL;

export const AWS_API_BASE_URL = CFG_AWS_URL;

export async function apiCall(path, body, timeoutMs = 4000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Therapist API HTTP ${res.status}: ${text}`
      );
    }

    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Reads retry like writes do: a timed-out GET must become a retry, never an
// empty screen. Only transport failures retry; a real HTTP answer (401
// handled below, 404, 403) is a verdict, not a glitch.
export async function awsApiCall(
  path,
  body = null,
  method = null,
  timeoutMs = 6000,
  _retried = false
) {
  const requestMethod = method || (body !== null ? "POST" : "GET");
  const attempts = requestMethod === "GET"
    ? [timeoutMs, Math.max(timeoutMs, 9000), 14000]
    : [timeoutMs];
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      return await awsApiCallOnce(path, body, requestMethod, attempts[i], _retried);
    } catch (e) {
      lastErr = e;
      if (e?.status) throw e;
      if (i < attempts.length - 1) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

async function awsApiCallOnce(
  path,
  body,
  requestMethod,
  timeoutMs,
  _retried
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const token = await getValidAccessToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const options = { method: requestMethod, headers, signal: controller.signal };
    if (body !== null) options.body = JSON.stringify(body);

    const res = await fetch(`${AWS_API_BASE_URL}${path}`, options);
    const text = await res.text();

    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }

    if (res.status === 401 && !_retried) {
      const ok = await refreshSession();
      if (ok) {
        clearTimeout(t);
        return awsApiCallOnce(path, body, requestMethod, timeoutMs, true);
      }
    }

    if (!res.ok) {
      const err = new Error(`AWS API HTTP ${res.status}: ${data?.error || data?.raw || text}`);
      err.status = res.status;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function getMe() {
  return await awsApiCall("/me", null, "GET");
}

export async function getMyPatients() {
  return await awsApiCall("/my-patients", null, "GET");
}

// Both steps of the camera pipeline are idempotent, so they retry like the
// clinical writes do: a single 6-second timeout was killing whole scans with
// "Scan couldn't complete: Aborted" -- and a scan that dies here saves
// nothing for the therapist.
export async function requestMediaUploadUrl(patientId, contentType) {
  return await saveWithRetry("/media-upload-url", { patient_id: patientId, content_type: contentType });
}

export async function recognizeImage(s3Key, patientId) {
  return await saveWithRetry("/recognize", { s3_key: s3Key, patient_id: patientId });
}

export async function startTranscription(s3Key, patientId, languageCode = "en-US") {
  return await awsApiCall("/transcription", { s3_key: s3Key, patient_id: patientId, language_code: languageCode }, "POST");
}

export async function getTranscription(jobName) {
  return await awsApiCall(`/transcription/${encodeURIComponent(jobName)}`, null, "GET");
}

export async function respondServer(context) {
  return await awsApiCall("/respond", context, "POST");
}

export async function deleteMedia(s3Key, patientId) {
  return await awsApiCall("/media", { s3_key: s3Key, patient_id: patientId }, "DELETE");
}

export async function getMediaViewUrl(s3Key, patientId) {
  return await awsApiCall("/media-url", { s3_key: s3Key, patient_id: patientId }, "POST");
}

export async function saveClinicalProfile(profile) {
  if (!profile?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await awsApiCall(
    "/clinical-profile",
    profile,
    "POST"
  );
}

// Resolve a login username to its existing patient_id, so Add Patient can
// connect an existing account instead of cloning a blank duplicate beside it.
export async function findPatientByUsername(username) {
  if (!username) throw new Error("username is required");
  return await awsApiCall(
    `/identity-by-username/${encodeURIComponent(String(username).trim())}`,
    null,
    "GET"
  );
}

export async function getClinicalProfile(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  const res = await awsApiCall(
    `/clinical-profile/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
  // The API wraps the record as {item: {...}}. Callers need the profile
  // itself -- without this, every screen that reloads the plan reads the
  // wrapper, finds no fields, and shows an empty plan the engine can see.
  return res?.item || res;
}

export async function updateClinicalProfile(
  patientId,
  updates
) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/clinical-profile/${encodeURIComponent(patientId)}`,
    updates,
    "PUT"
  );
}

export async function saveTherapistRule(rule) {
  if (!rule?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await awsApiCall(
    "/therapist-rule",
    rule,
    "POST"
  );
}

export async function getTherapistRules(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/therapist-rules/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export async function updateTherapistRule(
  ruleId,
  updates
) {
  if (!ruleId) {
    throw new Error("ruleId is required");
  }

  return await awsApiCall(
    `/therapist-rule/${encodeURIComponent(ruleId)}`,
    updates,
    "PUT"
  );
}

export async function deleteTherapistRule(ruleId) {
  if (!ruleId) {
    throw new Error("ruleId is required");
  }

  return await awsApiCall(
    `/therapist-rule/${encodeURIComponent(ruleId)}`,
    null,
    "DELETE"
  );
}

// Clinical writes must land: a dropped trigger event or episode record
// leaves the therapist an empty chart for an episode that happened.
// Transient failures (timeout, dropped connection, 5xx) retry with growing
// patience; real rejections (4xx) surface immediately -- retrying a
// permission error only repeats it.
async function saveWithRetry(path, body) {
  const timeouts = [6000, 10000, 16000];
  const delays = [1000, 3000];
  let lastErr = null;
  for (let i = 0; i < timeouts.length; i++) {
    try {
      return await awsApiCall(path, body, "POST", timeouts[i]);
    } catch (e) {
      lastErr = e;
      if (/AWS API HTTP 4\d\d/.test(String(e?.message || e))) throw e;
      if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw lastErr;
}

export async function saveDecision(decision) {
  decision = withEpisode(decision);

  if (!decision?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await saveWithRetry("/decision", decision);
}

export async function getDecisions(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/decisions/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export async function saveSession(session) {
  session = withEpisode(session);

  if (!session?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await saveWithRetry("/session", session);
}

export async function getSessions(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/sessions/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export async function saveNote(note) {
  if (!note?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await saveWithRetry("/note", note);
}

export async function getNotes(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/notes/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export async function updateNote(
  noteId,
  updates
) {
  if (!noteId) {
    throw new Error("noteId is required");
  }

  return await awsApiCall(
    `/note/${encodeURIComponent(noteId)}`,
    updates,
    "PUT"
  );
}

export async function deleteNote(noteId) {
  if (!noteId) {
    throw new Error("noteId is required");
  }

  return await awsApiCall(
    `/note/${encodeURIComponent(noteId)}`,
    null,
    "DELETE"
  );
}

export async function updateAssignment(assignmentId, updates) {
  if (!assignmentId) throw new Error("assignmentId is required");
  return await awsApiCall(`/assignment/${encodeURIComponent(assignmentId)}`, updates, "PUT");
}

export async function saveAssignment(assignment) {
  if (!assignment?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await awsApiCall(
    "/assignment",
    assignment,
    "POST"
  );
}

export async function getAssignments(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/assignments/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export async function saveIdentity(identity) {
  if (!identity?.patient_id) {
    throw new Error("patient_id is required");
  }

  return await awsApiCall(
    "/identity",
    identity,
    "POST"
  );
}

export async function getIdentity(patientId) {
  if (!patientId) {
    throw new Error("patientId is required");
  }

  return await awsApiCall(
    `/identity/${encodeURIComponent(patientId)}`,
    null,
    "GET"
  );
}

export const RISK_THRESHOLDS = {
  detection: 0.175,
  high: 0.5,
};

export const DETECTION_THRESHOLD = 0.175;

export function supportForScore(score) {
  if (score >= RISK_THRESHOLDS.high) {
    return "high";
  }

  if (score >= RISK_THRESHOLDS.detection) {
    return "elevated";
  }

  return "low";
}

export const RISK_METRICS = {
  accuracy: 0.909,
  balanced_accuracy: 0.921,
  precision: 0.846,
  recall: 0.959,
  f1: 0.889,
  roc_auc: 0.987,
};

export const ACTION_FOR_LEVEL = {
  low: "no_grounding_prompt",
  elevated: "offer_grounding",
  high: "prominent_grounding_offer",
};

export const SUPPORT_TO_RISKLEVEL = {
  low: "baseline",
  elevated: "elevated",
  high: "high",
};

export const RISK_RANK = {
  baseline: 0,
  elevated: 1,
  high: 2,
  critical: 3,
};

export const SENSOR_STREAMS = [
  "heart_rate",
  "eda",
  "temperature",
  "acc_magnitude_mean",
  "acc_magnitude_std",
  "ibi_mean_seconds",
];

export const FEATURE_NAMES = [
  "heart_rate_mean",
  "heart_rate_std",
  "heart_rate_range",

  "eda_mean",
  "eda_std",
  "eda_range",
  "eda_slope_per_s",

  "temp_mean_c",
  "temp_std_c",
  "temp_slope_c_per_s",

  "acc_magnitude_mean",
  "acc_magnitude_window_std",
  "acc_magnitude_variability_mean",

  "ibi_mean_seconds",
  "sdnn_ms",
  "rmssd_ms",
];

export const RISK_SCENARIOS = {
  baseline: {
    label: "Baseline",
    score: 0.08,
    pattern: "baseline-like",
    hr: 66,
    eda: 1.9,
    temp: 33.2,
    movement: "Low",
  },

  elevated: {
    label: "Elevated",
    score: 0.34,
    pattern: "stress-like",
    hr: 84,
    eda: 3.4,
    temp: 33.7,
    movement: "Moderate",
  },

  high: {
    label: "High",
    score: 0.86,
    pattern: "stress-like",
    hr: 98,
    eda: 4.8,
    temp: 34.0,
    movement: "Elevated",
  },
};

export const DEMO_SCENARIOS = {
  baseline: {
    label: "Baseline",
    riskLevel: "baseline",
    score: 0.32,
    triggers: [],
    mode: "ai",
  },

  elevatedUnseen: {
    label: "Elevated · unseen",
    riskLevel: "elevated",
    score: 0.58,
    triggers: ["argument nearby"],
    mode: "ai",
  },

  highSeen: {
    label: "High · crowd · therapist rule",
    riskLevel: "high",
    score: 0.78,
    triggers: ["crowd"],
    mode: "ai",
  },

  unsafeAi: {
    label: "Unsafe AI · safety fallback",
    riskLevel: "elevated",
    score: 0.58,
    triggers: ["unsafe-demo"],
    mode: "ai",
    forceUnsafe: true,
  },

  rulesOnly: {
    label: "Rules only · unseen",
    riskLevel: "elevated",
    score: 0.58,
    triggers: ["argument nearby"],
    mode: "rules_only",
  },
};

export const SAFE_FALLBACK_MESSAGE =
  "I'm here with you. Let's take this one breath at a time.";

const BLOCK = {
  "false safety guarantee": [
    "you are completely safe",
    "you are safe",
    "nothing can hurt you",
    "there is no threat",
    "totally safe",
  ],

  "diagnosis language": [
    "panic attack",
    "ptsd",
    "flashback",
    "you are having",
  ],

  "medication advice": [
    "medication",
    "take your meds",
    "dosage",
    "mg",
    "pill",
  ],
};

export function makeSafe(text) {
  const low = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [reason, phrases] of Object.entries(BLOCK)) {
    if (
      phrases.some((phrase) =>
        low.includes(phrase)
      )
    ) {
      return {
        safe: SAFE_FALLBACK_MESSAGE,
        blocked: true,
        reason,
      };
    }
  }

  return {
    safe: text,
    blocked: false,
    reason: null,
  };
}

export function riskAtLeast(current, minimum) {
  return (
    (RISK_RANK[current] ?? 0) >=
    (RISK_RANK[minimum] ?? 0)
  );
}

export function processMoment({
  patient: p,
  riskLevel,
  observedTriggers = [],
  mode = "ai",
}) {
  const patientId = p?.id;

  const rules = (p?.rules || []).filter(
    (r) => r.active
  );

  const matches = rules.filter((r) => {
    const riskOk = riskAtLeast(
      riskLevel,
      (r.minRisk || "baseline").toLowerCase()
    );

    const observed = observedTriggers.map((x) =>
      String(x)
        .trim()
        .toLowerCase()
    );

    const trigOk =
      !r.triggers ||
      r.triggers.length === 0 ||
      r.triggers.some((t) =>
        observed.includes(
          String(t)
            .trim()
            .toLowerCase()
        )
      );

    return riskOk && trigOk;
  });

  if (matches.length) {
    const best = [...matches].sort(
      (a, b) =>
        b.priority - a.priority ||
        String(a.ruleId).localeCompare(
          String(b.ruleId)
        )
    )[0];

    const approved =
      p?.treatmentPlan?.approvedInterventions || [];

    const forbidden =
      p?.treatmentPlan?.forbiddenInterventions || [];

    if (
      forbidden.includes(best.approvedAction)
    ) {
      return safeFallback(
        patientId,
        riskLevel,
        `rule ${best.ruleId} action forbidden`
      );
    }

    if (
      approved.length &&
      !approved.includes(best.approvedAction)
    ) {
      return safeFallback(
        patientId,
        riskLevel,
        `rule ${best.ruleId} action not approved`
      );
    }

    return {
      decision_source: "therapist_rule",

      rule_id: best.ruleId,

      action: best.approvedAction,

      confidence: 1.0,

      reason_code:
        `matched ${best.ruleId}`,

      message:
        `Your therapist prepared this for a moment like now: ${best.approvedAction}.`,

      safety: "passed",

      risk_level: riskLevel,

      observed: observedTriggers,
    };
  }

  if (mode === "rules_only") {
    return safeFallback(
      patientId,
      riskLevel,
      "no matching rule (rules only)"
    );
  }

  const approved =
    p?.treatmentPlan?.approvedInterventions || [];

  const chosen =
    approved.find((a) =>
      /calm|breath/i.test(a)
    ) ||
    approved[0];

  if (!chosen) {
    return safeFallback(
      patientId,
      riskLevel,
      "no approved intervention to offer"
    );
  }

  const moment =
    observedTriggers.length
      ? observedTriggers.join(", ")
      : "this moment";

  const proposal =
    `${moment} sounds like a lot right now. ` +
    `I'm right here with you — let's ${chosen}.`;

  const guard = makeSafe(proposal);

  if (guard.blocked) {
    return {
      ...safeFallback(
        patientId,
        riskLevel,
        `ai message blocked: ${guard.reason}`
      ),

      safety:
        `blocked (${guard.reason})`,
    };
  }

  return {
    decision_source: "ai_reasoning",

    rule_id: null,

    action: chosen,

    confidence: 0.55,

    reason_code:
      "unseen situation: offered grounding within safe limits",

    message: guard.safe,

    safety: "passed",

    risk_level: riskLevel,

    observed: observedTriggers,
  };
}

function safeFallback(
  patientId,
  riskLevel,
  reason
) {
  return {
    decision_source: "safe_fallback",

    rule_id: null,

    action:
      "offer neutral grounding; flag for therapist review",

    confidence: 0.3,

    reason_code: reason,

    message: SAFE_FALLBACK_MESSAGE,

    safety: "passed",

    risk_level: riskLevel,

    observed: [],
  };
}

let _n = 1000;

export function makeDecisionRecord(
  patientId,
  out,
  score
) {
  _n += 1;

  return {
    decision_id:
      `D-${_n.toString(16)}`,

    patient_id:
      patientId,

    timestamp:
      new Date().toLocaleString(),

    decision_source:
      out.decision_source,

    therapist_rule_id:
      out.rule_id,

    risk_score:
      score ?? null,

    selected_action:
      out.action,

    confidence:
      out.confidence,

    reason_code:
      out.reason_code,

    observed_triggers:
      out.observed,

    safety:
      out.safety,
  };
}

export async function processAndSaveMoment({
  patient,
  riskLevel,
  observedTriggers = [],
  mode = "ai",
  score = null,
}) {
  const out = processMoment({
    patient,
    riskLevel,
    observedTriggers,
    mode,
  });

  const patientId =
    patient?.id ||
    patient?.patient_id;

  if (!patientId) {
    throw new Error(
      "Patient must contain id or patient_id"
    );
  }

  const record = makeDecisionRecord(
    patientId,
    out,
    score
  );

  try {
    const saved =
      await saveDecision(record);

    return {
      decision: out,
      record,
      awsSaved: true,
      awsResponse: saved,
    };
  } catch (error) {
    console.warn(
      "Decision worked but AWS save failed:",
      error
    );

    return {
      decision: out,
      record,
      awsSaved: false,
      awsError:
        error?.message ||
        String(error),
    };
  }
}

export async function testAwsConnection() {
  const testPatientId =
    `demo-${Date.now()}`;

  const profile =
    await saveClinicalProfile({
      patient_id: testPatientId,

      condition: "demo",

      baseline_heart_rate: 72,

      known_triggers: [
        "trash bag",
      ],

      preferred_intervention:
        "5-4-3-2-1 grounding",
  });

  const rule =
    await saveTherapistRule({
      patient_id: testPatientId,

      trigger: "trash bag",

      intervention:
        "5-4-3-2-1 grounding",

      instructions:
        "Guide the patient through grounding and slow breathing.",

      priority: 1,
    });

  return {
    success: true,
    patient_id: testPatientId,
    profile,
    rule,
  };
}