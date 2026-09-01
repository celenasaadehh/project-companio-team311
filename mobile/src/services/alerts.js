// Patient-initiated contact: call requests, emergency alerts, acknowledgements.
import { saveSession, getAssignments } from "./engine";
import { notifyNow, sendPushViaServer } from "./notify";

export async function requestCall(patientId, note = "") {
  const r = await saveSession({
    patient_id: patientId,
    type: "call_request",
    message: note || "Patient requested a call.",
    ack_state: "sent",
  });

  const res = await sendPushViaServer(patientId, "therapist",
    "Patient requested contact",
    "Open Companio to review and respond.",
    { type: "call_request", patient_id: patientId, session_id: r?.item?.session_id });
  const delivered = !!res.ok;

  notifyNow(
    delivered ? "Request delivered" : "Request saved",
    delivered
      ? "Your therapist has been notified. I'll tell you when they've seen it."
      : "Your therapist will see this next time they open Companio.",
  );
  return { ...r, delivered };
}

export async function acknowledgeRequest(patientId, sessionId, therapistName) {
  return saveSession({
    patient_id: patientId,
    session_id: sessionId,
    type: "acknowledgement",
    ack_state: "acknowledged",
    acknowledged_by: therapistName || "your therapist",
    acknowledged_at: new Date().toISOString(),
    message: `${therapistName || "Your therapist"} has seen your request.`,
  });
  // Tell the patient's device immediately, not on their next refresh.
  sendPushViaServer(patientId, "patient",
    "Your therapist has seen your request",
    `${therapistName || "Your therapist"} acknowledged it and will follow up.`,
    { type: "acknowledgement" }).catch(() => {});
}


export async function raiseEmergencyAlert(patientId, note = "", therapistPushToken = null) {
  const r = await saveSession({
    patient_id: patientId,
    type: "emergency_alert",
    message: note || "Patient marked this as an emergency.",
  });
  const res = await sendPushViaServer(patientId, "therapist",
    "Companio: urgent patient alert",
    "A patient marked a moment as an emergency. Open Companio to review.",
    { type: "emergency_alert", patient_id: patientId });
  const delivered = !!res.ok;

  notifyNow(
    delivered ? "Your therapist has been alerted" : "Alert saved for your therapist",
    delivered
      ? "They've been notified. If you're in immediate danger, call 911 or 988 now."
      : "They'll see it when they next open Companio. If you're in immediate danger, call 911 or 988 now.",
  );
  return { ...r, delivered };
}

export async function requestAppointment(patientId, note = "") {
  const r = await saveSession({
    patient_id: patientId,
    type: "appointment_request",
    message: note || "Patient requested an appointment.",
    ack_state: "sent",
  });
  const res = await sendPushViaServer(patientId, "therapist",
    "Appointment request",
    "A patient asked to schedule a session.",
    { type: "appointment_request", patient_id: patientId, session_id: r?.item?.session_id });
  const delivered = !!res.ok;
  return { ...r, delivered };
}

export async function saveDailySnapshot(patientId, vitals) {
  if (!patientId || !vitals) return null;
  return saveSession({
    patient_id: patientId,
    type: "daily_snapshot",
    logged_for_date: new Date().toDateString(),
    hr: vitals.hr ?? null,
    hrv: vitals.hrv ?? null,
    resting_hr: vitals.resting ?? null,
    steps: vitals.steps ?? null,
    sleep_hours_last_night: vitals.sleepHoursLastNight ?? null,
    poor_sleep: !!vitals.poorSleep,
    caffeine_mg: vitals.caffeineMgToday ?? null,
    recent_workout_minutes_ago: vitals.recentWorkout?.minutesAgo ?? null,

    hourly_steps: vitals.hourlySteps || null,
    active_energy: vitals.activeEnergy ?? null,
    walking_hr: vitals.walkingHr ?? null,
    respiratory_rate: vitals.respiratoryRate ?? null,
    oxygen_saturation: vitals.oxygen ?? null,

    hr_age_minutes: vitals.hrAgeMinutes ?? null,
    hrv_age_minutes: vitals.hrvAgeMinutes ?? null,
    hr_freshness: vitals.hrFreshness ?? null,
    hrv_freshness: vitals.hrvFreshness ?? null,

    recorded_at: new Date().toISOString(),
    source: vitals.source || "unknown",
    message: "Daily physiological snapshot.",
  });
}
