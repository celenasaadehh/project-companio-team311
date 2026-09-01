// One episode explained: physiology, context, voice, decision, outcome.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState,
         Disclaimer, DecisionSourceBadge, Btn } from "../components/ui";
import { TriggerImage, TriggerAudio } from "./workspace";
import { getSessions, getDecisions } from "../services/engine";
import { useApp } from "../state/AppContext";

const fmt = (iso) => {
  try { return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

function Field({ label, value, unit, missing = "Not recorded" }) {
  const has = value !== null && value !== undefined && value !== "";
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between",
                   paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={type.sub}>{label}</Text>
      <Text style={{ fontWeight: has ? "700" : "400",
                     color: has ? C.textPrimary : C.textMuted, fontSize: 14 }}>
        {has ? `${value}${unit ? ` ${unit}` : ""}` : missing}
      </Text>
    </View>
  );
}

export function EventDetail({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const episodeId = route?.params?.episodeId || null;
  const sessionId = route?.params?.sessionId || null;
  const p = patient ? patient(patientId) : null;

  const [rows, setRows] = useState(null);
  const [decisions, setDecisions] = useState(null);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      getSessions(patientId).catch(() => null),
      getDecisions(patientId).catch(() => null),
    ]);
    const all = s?.sessions || [];
    const mine = episodeId
      ? all.filter((x) => x.episode_id === episodeId)
      : all.filter((x) => x.session_id === sessionId);
    setRows(mine);
    setDecisions((d?.decisions || []).filter((x) =>
      episodeId ? x.episode_id === episodeId : true));
  }, [patientId, episodeId, sessionId]);

  useEffect(() => { load(); }, [load]);

  if (rows === null) {
    return (
      <Screen>
        <AppHeader title="Event" onBack={() => navigation.goBack()} />
        <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
      </Screen>
    );
  }

  const snapshot = rows.find((r) => r.type === "daily_snapshot")
    || rows.find((r) => r.hr != null) || null;
  const trigger = rows.find((r) => r.type === "trigger_event") || null;
  const voice = rows.find((r) => r.type === "voice_transcription") || null;
  const summary = rows.find((r) => r.type === "episode") || null;
  // Every decision of the episode, oldest first: if the first offer did not
  // help and a second was tried, the therapist must see the sequence.
  const episodeDecisions = (decisions || [])
    .slice()
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const decision = episodeDecisions[0] || null;
  const startedAt = summary?.episode_started_at || trigger?.created_at
    || voice?.created_at || rows[0]?.created_at;

  // Explicit boolean written at capture time. A candidate label alone is NOT
  // a known trigger -- a truck the therapist never logged must read as unseen.
  const seen = trigger?.known_trigger === true;

  return (
    <Screen>
      <AppHeader eyebrow="EVENT" title={seen ? (trigger.matched_trigger || trigger.normalized_visual_trigger) : "Support episode"}
        subtitle={`${p?.name ? `${p.name} · ` : ""}${fmt(startedAt)}`}
        onBack={() => navigation.goBack()} />

      <View style={{ flexDirection: "row", marginBottom: spacing.sm }}>
        <Pill text={seen ? "KNOWN TRIGGER" : "UNSEEN CONTEXT"}
          fg={seen ? C.warning : C.lavender}
          bg={seen ? C.warningSoft : C.lavenderSoft} />
      </View>

      <SectionTitle>Physiological context</SectionTitle>
      <Card>
        <Field label="Risk level" value={decision?.risk_level || summary?.risk_level} />
        <Field label="Risk score"
          value={decision?.risk_score != null ? Number(decision.risk_score).toFixed(2) : null} />
        <Field label="Heart rate" value={snapshot?.hr} unit="bpm" />
        <Field label="Resting heart rate" value={snapshot?.resting_hr} unit="bpm" />
        <Field label="HRV" value={snapshot?.hrv} unit="ms" />
        <Field label="Sleep last night" value={snapshot?.sleep_hours_last_night} unit="hrs" />
        <Field label="Scored by"
          value={snapshot?.risk_source === "trained_model"
            ? `Trained model${snapshot?.risk_model ? ` (${snapshot.risk_model})` : ""}`
            : snapshot?.risk_source === "heuristic" ? "Heart-rate comparison (fallback)"
            : null} />
        <Field label="Sample age"
          value={snapshot?.hr_age_minutes != null ? `${snapshot.hr_age_minutes} min old` : null} />
        <Field label="Confounders"
          value={(summary?.confounders || []).length ? summary.confounders.join(", ") : null}
          missing="None detected" />
      </Card>

      <SectionTitle>Environmental context</SectionTitle>
      {trigger ? (
        <Card>
          <Field label="Recognised" value={trigger.normalized_visual_trigger} missing="Nothing matched" />
          <Field label="Match confidence"
            value={trigger.trigger_match_score != null ? Number(trigger.trigger_match_score).toFixed(2) : null} />
          <Field label="Camera" value={trigger.camera_source || trigger.source} />
          {trigger.visual_labels?.length ? (
            <View style={{ marginTop: 10 }}>
              <Text style={type.meta}>DETECTED</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
                {trigger.visual_labels.slice(0, 10).map((l, i) => (
                  <Pill key={i} text={typeof l === "string" ? l : (l.name || l.Name || "")}
                    fg={C.textSecondary} bg={C.surfaceStrong} />
                ))}
              </View>
            </View>
          ) : null}
          {trigger.image_s3_key || trigger.s3_key ? (
            <TriggerImage s3Key={trigger.image_s3_key || trigger.s3_key} patientId={patientId} />
          ) : trigger.image_retained === false ? (
            <Text style={[type.meta, { marginTop: 10 }]}>
              Image not kept — this patient has image saving turned off. What was recognised is recorded above.
            </Text>
          ) : null}
        </Card>
      ) : (
        <Card><Row icon="camera-outline" iconFg={C.textMuted} iconBg={C.surfaceStrong}
          title="No image captured" subtitle="The camera did not run during this episode." /></Card>
      )}

      <SectionTitle>Voice interaction</SectionTitle>
      {voice ? (
        <Card>
          {voice.patient_said || voice.transcript ? (
            <>
              <Text style={type.meta}>PATIENT SAID</Text>
              <Text style={[type.body, { marginTop: 4, fontSize: 15.5 }]}>
                {`"${voice.patient_said || voice.transcript}"`}
              </Text>
            </>
          ) : null}
          {voice.companio_said ? (
            <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={type.meta}>COMPANIO SAID</Text>
              <Text style={[type.body, { marginTop: 4, fontSize: 15.5 }]}>{`"${voice.companio_said}"`}</Text>
            </View>
          ) : null}
          {voice.audio_s3_key ? (
            <TriggerAudio s3Key={voice.audio_s3_key} patientId={patientId} />
          ) : voice.audio_retained === false ? (
            <Text style={[type.meta, { marginTop: 10 }]}>
              Audio not kept — the patient has audio saving turned off. The transcript above is the record.
            </Text>
          ) : null}
        </Card>
      ) : (
        <Card><Row icon="mic-off" iconFg={C.textMuted} iconBg={C.surfaceStrong}
          title="The patient did not speak" subtitle="No voice interaction in this episode." /></Card>
      )}

      <SectionTitle sub={episodeDecisions.length > 1
        ? `${episodeDecisions.length} attempts in this episode, in order.` : undefined}>
        How Companio decided
      </SectionTitle>
      {episodeDecisions.length > 1 ? episodeDecisions.map((d, di) => (
        <Card key={d.decision_id || di} accent={C.primary}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
            <Text style={[type.meta, { marginRight: 8 }]}>{`ATTEMPT ${di + 1}`}</Text>
            <DecisionSourceBadge source={d.decision_source} />
          </View>
          <Field label="Offered" value={d.selected_action} />
          <Field label="Helped" value={d.patient_reported_helped === true ? "Yes"
            : d.patient_reported_helped === false ? "No" : null} missing="No answer recorded" />
        </Card>
      )) : null}
      {decision ? (
        <Card accent={C.primary}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
            <DecisionSourceBadge source={decision.decision_source} />
            {decision.therapist_rule_id ? (
              <Text style={[type.meta, { marginLeft: 8 }]}>{decision.therapist_rule_id}</Text>
            ) : null}
          </View>
          <Field label="Selected" value={decision.selected_action} />
          <Field label="Confidence"
            value={decision.confidence != null ? Number(decision.confidence).toFixed(2) : null} />
          <Field label="Escalation required" value={decision.escalation_required ? "Yes" : "No"} />
          {decision.reason_code ? (
            <View style={{ marginTop: 10 }}>
              <Text style={type.meta}>WHY</Text>
              <Text style={[type.sub, { marginTop: 4 }]}>{decision.reason_code}</Text>
            </View>
          ) : null}
          {decision.message ? (
            <View style={{ marginTop: 10 }}>
              <Text style={type.meta}>SPOKEN TO THE PATIENT</Text>
              <Text style={[type.sub, { marginTop: 4, fontStyle: "italic" }]}>{`"${decision.message}"`}</Text>
            </View>
          ) : null}
          {decision.used_baseline_actions ? (
            <Text style={[type.meta, { marginTop: 10, color: C.warning }]}>
              Generic support was used — this patient had no approved interventions at the time.
            </Text>
          ) : null}
        </Card>
      ) : (
        <Card><Row icon="flash-off" iconFg={C.textMuted} iconBg={C.surfaceStrong}
          title="No decision recorded" subtitle="Nothing was offered during this episode." /></Card>
      )}

      <SectionTitle>Outcome</SectionTitle>
      <Card accent={
        decision?.patient_reported_helped === true ? C.success
          : decision?.patient_reported_helped === false ? C.warning : undefined}>
        <Row
          icon={decision?.patient_reported_helped === true ? "checkmark-circle"
            : decision?.patient_reported_helped === false ? "close-circle" : "help-circle"}
          iconFg={decision?.patient_reported_helped === true ? C.success
            : decision?.patient_reported_helped === false ? C.warning : C.textMuted}
          iconBg={decision?.patient_reported_helped === true ? C.successSoft
            : decision?.patient_reported_helped === false ? C.warningSoft : C.surfaceStrong}
          title={decision?.patient_reported_helped === true ? "The patient said it helped"
            : decision?.patient_reported_helped === false ? "The patient said it did not help"
            : "The patient did not answer"}
          subtitle={summary?.outcome ? `Episode closed: ${summary.outcome}` : "Episode not formally closed"} />
        {summary?.duration_seconds ? (
          <Field label="Duration" value={Math.max(1, Math.round(summary.duration_seconds / 60))} unit="min" />
        ) : null}
        {summary?.risk_peak != null ? (
          <Field label="Peak risk" value={Number(summary.risk_peak).toFixed(2)} />
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", marginTop: spacing.md }}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Btn label="Add note" icon="create"
            onPress={() => navigation.navigate("Workspace", { patientId, screen: "WsNotes" })} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="Edit care plan" icon="clipboard" variant="outline"
            onPress={() => navigation.navigate("TreatmentPlan", { patientId })} />
        </View>
      </View>

      <Disclaimer />
    </Screen>
  );
}
