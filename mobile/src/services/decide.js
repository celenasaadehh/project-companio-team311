// Builds the moment's context and asks the decision engine what to do.
import { apiCall, respondServer, saveDecision, getDecisions, getClinicalProfile, getTherapistRules, SAFE_FALLBACK_MESSAGE } from "./engine";
import { offeredActions, recordOfferedAction } from "./episode";

const MAX_ATTRIBUTION_MINUTES = 45;
const RISK_NOISE_BAND = 0.05;

async function buildInterventionHistory(patientId) {
  try {
    const r = await getDecisions(patientId);
    const decisions = (r?.decisions || [])
      .filter((d) => d.selected_action && d.timestamp)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const history = [];
    for (let i = 0; i < decisions.length; i++) {
      const current = decisions[i];

      if (typeof current.patient_reported_helped === "boolean") {
        history.push({ action: current.selected_action, reward: current.patient_reported_helped ? 1 : 0 });
        continue;
      }

      const next = decisions[i + 1];
      if (!next || current.risk_score == null || next.risk_score == null) continue;

      const minutesBetween = (new Date(next.timestamp) - new Date(current.timestamp)) / 60000;
      if (!(minutesBetween >= 0) || minutesBetween > MAX_ATTRIBUTION_MINUTES) continue;

      const delta = next.risk_score - current.risk_score;
      if (delta <= -RISK_NOISE_BAND) history.push({ action: current.selected_action, reward: 1 });
      else if (delta >= RISK_NOISE_BAND) history.push({ action: current.selected_action, reward: 0 });
    }
    return history;
  } catch {
    return [];
  }
}

function withSleepNote(transcript, sleepHoursLastNight, poorSleep) {
  if (!poorSleep || sleepHoursLastNight == null) return transcript || "";
  const note = `(Only slept about ${sleepHoursLastNight} hours last night.)`;
  return transcript ? `${transcript} ${note}` : note;
}

export async function decideMoment(context) {
  const patientId = context.patient_id;
  if (!patientId) throw new Error("patient_id is required");

  const interventionHistory = await buildInterventionHistory(patientId);

  let profile = context.profile;
  if (!profile) {
    try {
      const cp = await getClinicalProfile(patientId);
      const item = cp?.item || cp;
      if (item && !item.error) {
        profile = {
          known_triggers: item.known_triggers || [],
          approved_interventions: item.approved_interventions || (item.preferred_intervention ? [item.preferred_intervention] : []),
          forbidden_interventions: item.forbidden_interventions || [],
          communication_preferences: [
            ...(item.communication_preferences || []),
            ...(item.ptsd_subtype ? [`Trauma presentation: ${item.ptsd_subtype}.`] : []),
            ...(item.clinical_guidance ? [String(item.clinical_guidance)] : []),
          ],
          physiological_baseline: item.physiological_baseline || {},
          // Situational bans: an intervention the therapist allows normally but
          // not in specific circumstances. Resolved by the engine against this
          // moment, so a technique is only withheld when its condition holds.
          conditional_forbidden: item.conditional_forbidden || [],
        };
      }
    } catch {
    }
  }
  let rules = [];
  try {
    const rr = await getTherapistRules(patientId);
    rules = (rr?.rules || rr?.items || [])
      .filter((r) => r && r.active !== false && r.approved_action)
      .map((r) => ({
        rule_id: r.rule_id,
        patient_id: patientId,
        min_risk_level: r.min_risk_level ? canonicalRiskLevel(r.min_risk_level) : null,
        trigger_conditions: r.trigger_conditions || [],
        approved_action: r.approved_action,
        forbidden_actions: r.forbidden_actions || [],
        priority: Number(r.priority) || 0,
        active: r.active !== false,
        version: Number(r.version) || 1,
      }));
  } catch {
  }

  const RISK_LEVELS = ["baseline", "elevated", "high", "critical"];
  function canonicalRiskLevel(v) {
    const s = String(v || "").toLowerCase().trim();
    if (RISK_LEVELS.includes(s)) return s;
    if (s === "low" || s === "none" || s === "normal" || s === "calm" || s === "unknown" || s === "") return "baseline";
    if (s === "moderate" || s === "medium" || s === "raised") return "elevated";
    if (s === "severe" || s === "emergency" || s === "urgent") return "critical";
    console.warn(`[decide] unrecognised risk_level "${v}" -> baseline`);
    return "baseline";
  }

  const BASELINE_SAFE_ACTIONS = [
    "orient to the present moment",
    "name what is actually here right now",
    "slow exhale, longer out than in",
    "offer to contact the therapist",
  ];

  let usedBaselineActions = false;
  if (!profile) {
    profile = {
      known_triggers: [],
      approved_interventions: [...BASELINE_SAFE_ACTIONS],
      forbidden_interventions: [],
      communication_preferences: [],
      physiological_baseline: {},
    };
    usedBaselineActions = true;
  } else if (!(profile.approved_interventions || []).length) {
    profile = {
      ...profile,
      approved_interventions: BASELINE_SAFE_ACTIONS.filter(
        (a) => !(profile.forbidden_interventions || []).includes(a)
      ),
    };
    usedBaselineActions = true;
  }

  const transcriptWithSleep = withSleepNote(context.transcript, context.sleep_hours_last_night, context.poor_sleep);

  // Everything already tried: what the caller passed, plus anything offered
  // earlier in THIS episode. Built once, so the AWS fallback path below sees
  // the same exclusion list as the local engine and cannot re-offer a failed
  // intervention.
  const excluded = Array.from(new Set([
    ...(context.exclude_actions || []),
    ...offeredActions(),
  ]));

  try {
    const local = await apiCall(
      "/api/decide",
      {
        patient_id: patientId,
        risk_level: canonicalRiskLevel(context.risk_level),
        risk_score: context.risk_score ?? 0,
        observed_triggers: context.observed_triggers || (context.normalized_visual_trigger ? [context.normalized_visual_trigger] : []),
        transcript: transcriptWithSleep,
        intervention_history: interventionHistory,
        mode: "ai",
        profile: profile || undefined,
        exclude_actions: excluded,
        rules,
        // What the patient said they were doing, so a ban like "not during
        // exercise" can be evaluated.
        declared_context: context.declared_context || [],
      },
      4000
    );

    const decision = {
      ...local.decision,
      patient_id: patientId,
      message: local.spoken_message,
      used_baseline_actions: usedBaselineActions,
      visual_labels: context.visual_labels || null,
      normalized_visual_trigger: context.normalized_visual_trigger || null,
      transcript: context.transcript || null,
      sleep_hours_last_night: context.sleep_hours_last_night ?? null,
      poor_sleep: !!context.poor_sleep,
    };

    if (decision.selected_action) recordOfferedAction(decision.selected_action);

    try {
      await saveDecision(decision);
    } catch (saveErr) {
      console.warn("Decision made by the local therapist_engine but AWS save failed:", saveErr);
    }

    return { ...decision, engine_source: "local_therapist_engine", spoken_message: local.spoken_message, trace: local.trace || null };
  } catch (localErr) {
    const remote = await respondServer({ ...context, exclude_actions: excluded });
    const text = remote.spoken_message || remote.message || remote.decision?.message || SAFE_FALLBACK_MESSAGE;
    const remoteAction = remote.decision?.selected_action || remote.selected_action || null;

    // Record it here too, or the episode has no memory of anything offered on
    // this path and the next call repeats it.
    if (remoteAction) recordOfferedAction(remoteAction);

    return {
      ...remote.decision,
      selected_action: remoteAction,
      decision_source: remote.decision_source || remote.decision?.decision_source || "safe_fallback",
      engine_source: "aws_fallback",
      message: text,
      spoken_message: text,
    };
  }
}
