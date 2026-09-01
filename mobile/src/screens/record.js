// The patient record, grouped by topic.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, RefreshControl, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState,
         Disclaimer, DecisionSourceBadge, Btn } from "../components/ui";
import { TriggerImage, TriggerAudio } from "./workspace";
import { getSessions, getDecisions } from "../services/engine";
import { useApp } from "../state/AppContext";

const when = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch { return ""; }
};

function useRecord(patientId) {
  const [sessions, setSessions] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      getSessions(patientId).catch(() => null),
      getDecisions(patientId).catch(() => null),
    ]);
    setSessions(s?.sessions || []);
    setDecisions(d?.decisions || []);
    setLoading(false);
    setRefreshing(false);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);
  return { sessions, decisions, loading, refreshing, setRefreshing, load };
}

const refresher = (refreshing, setRefreshing, load) => (
  <RefreshControl refreshing={refreshing}
    onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />
);

export function PatientRecord({ route, navigation }) {
  const { patient, currentPatientId, dischargePatient, loadPatientDetail } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  // This hub is reachable without passing through the workspace, so it must
  // hydrate the record itself: the caseload list arrives without the plan.
  useEffect(() => { loadPatientDetail?.(patientId); }, [patientId]);
  const p = patient ? patient(patientId) : null;
  const { sessions, decisions, loading } = useRecord(patientId);
  const [busy, setBusy] = useState(false);

  const n = (fn) => (sessions || []).filter(fn).length;
  const counts = {
    spoken: n((r) => r.type === "voice_transcription"),
    // Must match RecordSeen's list filter exactly: that screen shows every
    // camera event, with or without a retained image, so the card count
    // counts the same -- a count of 0 over a list of 1 reads as a lie.
    seen: n((r) => r.type === "trigger_event"),
    alerts: n((r) => r.type === "emergency_alert" || r.type === "call_request"),
    meds: n((r) => r.type === "medication_log"),
    // Counts what the Risk & signals screen actually lists: monitoring
    // samples plus every decision that carries an engine-computed score.
    days: n((r) => r.type === "daily_snapshot")
      + (decisions || []).filter((d) => d.risk_score != null || d.risk_level).length,
    decisions: (decisions || []).length,
  };

  const go = (screen) => navigation.navigate(screen, { patientId });

  const Topic = ({ icon, tint, title, sub, count, screen }) => (
    <Card onPress={() => go(screen)}>
      <Row icon={icon} iconFg={tint} iconBg={C.surfaceStrong} title={title} subtitle={sub}
        right={
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {count != null ? (
              <Text style={[type.meta, { marginRight: 8 }]}>{count}</Text>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
          </View>
        } />
    </Card>
  );

  return (
    <Screen>
      <AppHeader eyebrow="CLINICAL RECORD" title={p?.name || "Patient record"}
        subtitle="Everything Companio has recorded, grouped by topic."
        onBack={() => navigation.goBack()} />
      {loading ? <ActivityIndicator color={C.primary} style={{ marginBottom: 10 }} /> : null}

      <SectionTitle sub="What happened, as complete incidents.">Episodes</SectionTitle>
      <Topic icon="pulse" tint={C.primary} title="Episode timeline"
        sub="Each incident from first signal to outcome" screen="EpisodeTimeline" />
      <Topic icon="flash" tint={C.warning} title="Decisions"
        sub="Every decision and which layer made it" count={counts.decisions} screen="DecisionInspector" />

      <SectionTitle sub="What the patient's body and senses recorded.">Signals & context</SectionTitle>
      <Topic icon="heart" tint={C.danger} title="Physiological"
        sub="Heart rate, HRV, sleep, movement" count={counts.days} screen="RiskSignals" />
      <Topic icon="mic" tint={C.teal} title="What they said"
        sub="Voice check-ins, transcribed, with Companio's replies" count={counts.spoken} screen="RecordSpoken" />
      <Topic icon="camera" tint={C.lavender} title="What they saw"
        sub="Images that raised their level, with what was recognised" count={counts.seen} screen="RecordSeen" />
      <Topic icon="calendar" tint={C.teal} title="Day by day"
        sub="One day at a time: sleep, movement, caffeine, medication" screen="PatientDay" />

      <SectionTitle sub="What you decided for this patient.">Care plan</SectionTitle>
      <Topic icon="clipboard" tint={C.primary} title="Treatment plan"
        sub="Triggers, approved and forbidden interventions" screen="TreatmentPlan" />
      <Topic icon="shield-checkmark" tint={C.success} title="Safety rules"
        sub="Rules that override the models" screen="SafetyRules" />
      <Topic icon="medkit" tint={C.danger} title="Medications"
        sub="Regimen and what was actually taken" count={counts.meds} screen="Medications" />
      <Topic icon="document-text" tint={C.textSecondary} title="Session logs & notes"
        sub="Your own clinical notes" screen="SessionLogs" />
      <Topic icon="stats-chart" tint={C.lavender} title="Progress over time"
        sub="Trends across weeks" screen="WsProgressPage" />

      <SectionTitle sub="What Companio did, and whether it reached anyone.">Contact & alerts</SectionTitle>
      <Topic icon="notifications" tint={C.warning} title="Notifications sent"
        sub="What was sent, when, and how it resolved" count={counts.alerts} screen="RecordNotifications" />
      <Topic icon="chatbubbles" tint={C.primary} title="Messages"
        sub="Your conversation with this patient" screen="Conversation" />

      <SectionTitle>Administration</SectionTitle>
      <Topic icon="list" tint={C.textSecondary} title="Audit trail"
        sub="Who changed what, and when" screen="Audit" />
      <Topic icon="folder" tint={C.textSecondary} title="Documents"
        sub="Consent forms and uploads" screen="Documents" />

      <Card accent={C.danger}>
        <Row icon="person-remove" iconFg={C.danger} iconBg={C.dangerSoft}
          title="Remove from my caseload"
          subtitle="Discharges this patient. Their clinical record is kept." />
        <Btn label="Remove patient" icon="person-remove" variant="outline" color={C.danger}
          disabled={busy}
          onPress={() => Alert.alert(
            "Remove this patient?",
            `${p?.name || patientId} will be removed from your caseload and you will no longer see their data.\n\nTheir clinical record is NOT deleted — records must be retained, and another clinician can be assigned later.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove", style: "destructive",
                onPress: async () => {
                  setBusy(true);
                  const res = await dischargePatient(patientId);
                  setBusy(false);
                  if (res.ok) navigation.navigate("TherapistTabs", { screen: "Patients" });
                  else Alert.alert("Could not remove", res.error || "Please try again.");
                },
              },
            ],
          )} />
      </Card>

      <Disclaimer />
    </Screen>
  );
}

export function RecordSpoken({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;
  const { sessions, loading, refreshing, setRefreshing, load } = useRecord(patientId);

  const rows = (sessions || [])
    .filter((r) => r.type === "voice_transcription")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return (
    <Screen refreshControl={refresher(refreshing, setRefreshing, load)}>
      <AppHeader eyebrow="CLINICAL RECORD" title="What they said"
        subtitle={p?.name ? `${p.name} · voice check-ins, transcribed` : "Voice check-ins, transcribed"}
        onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={C.primary} /> : null}
      {!loading && rows.length === 0 ? (
        <Card>
          <EmptyState icon="mic" title="No voice check-ins yet"
            sub="When the patient talks to Companio, the transcript and Companio's reply appear here." />
        </Card>
      ) : null}

      {rows.map((r, i) => (
        <View key={r.session_id || i}>
          <SectionTitle>{when(r.created_at)}</SectionTitle>
          <Card>
            {r.patient_said || r.transcript ? (
              <>
                <Text style={type.meta}>PATIENT SAID</Text>
                <Text style={[type.body, { marginTop: 4, fontSize: 15.5 }]}>
                  {`"${r.patient_said || r.transcript}"`}
                </Text>
              </>
            ) : (
              <Text style={type.sub}>No speech was detected in this recording.</Text>
            )}

            {r.companio_said ? (
              <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
                <Text style={type.meta}>COMPANIO REPLIED</Text>
                <Text style={[type.body, { marginTop: 4, fontSize: 15.5 }]}>
                  {`"${r.companio_said}"`}
                </Text>
              </View>
            ) : null}

            {r.decision_source ? (
              <View style={{ marginTop: 10 }}><DecisionSourceBadge source={r.decision_source} /></View>
            ) : null}

            {r.audio_s3_key ? (
              <TriggerAudio s3Key={r.audio_s3_key} patientId={patientId} />
            ) : r.audio_retained === false ? (
              <Text style={[type.meta, { marginTop: 10 }]}>
                Audio not kept — this patient has audio saving turned off. The transcript above is the record.
              </Text>
            ) : null}
          </Card>
        </View>
      ))}
      <Disclaimer />
    </Screen>
  );
}

export function RecordSeen({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;
  const { sessions, loading, refreshing, setRefreshing, load } = useRecord(patientId);

  const rows = (sessions || [])
    .filter((r) => r.type === "trigger_event")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return (
    <Screen refreshControl={refresher(refreshing, setRefreshing, load)}>
      <AppHeader eyebrow="CLINICAL RECORD" title="What they saw"
        subtitle={p?.name ? `${p.name} · what the camera recognised` : "What the camera recognised"}
        onBack={() => navigation.goBack()} />
      <Text style={[type.meta, { marginBottom: 10 }]}>
        While the patient's signals are elevated, the camera samples the
        surroundings automatically about every 6 seconds — each entry below is
        one frame, so an episode reads as a sweep of what was around them.
      </Text>

      {loading ? <ActivityIndicator color={C.primary} /> : null}
      {!loading && rows.length === 0 ? (
        <Card>
          <EmptyState icon="camera" title="Nothing captured yet"
            sub="When the patient's physiological signals rise, Companio captures one frame and checks it against their known triggers. Those appear here." />
        </Card>
      ) : null}

      {rows.map((r, i) => {
        const trig = r.normalized_visual_trigger;
        // "Nothing matched" alone tells the therapist nothing they can act
        // on. Lead with WHAT the camera saw, so an unregistered trigger can
        // be judged and added.
        const seen = (r.visual_labels || [])
          .map((l) => (typeof l === "string" ? l : (l.name || l.Name || "")))
          .filter(Boolean).slice(0, 3).join(", ");
        return (
          <View key={r.session_id || i}>
            <SectionTitle>{when(r.created_at)}</SectionTitle>
            <Card accent={trig ? C.warning : undefined}>
              <Row
                icon={trig ? "alert-circle" : "checkmark-circle"}
                iconFg={trig ? C.warning : C.success}
                iconBg={trig ? C.warningSoft : C.successSoft}
                title={trig ? `Recognised: ${trig}`
                  : seen ? `Saw: ${seen}` : "Nothing matched their triggers"}
                subtitle={r.trigger_match_score != null
                  ? `Match confidence ${Number(r.trigger_match_score).toFixed(2)} · ${r.camera_source || r.source || "phone camera"}`
                  : (r.camera_source || r.source || "phone camera")}
              />

              {r.visual_labels?.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
                  {r.visual_labels.slice(0, 8).map((l, li) => (
                    <Pill key={li} text={typeof l === "string" ? l : (l.name || l.Name || "")}
                      fg={C.textSecondary} bg="#EEF1F6" />
                  ))}
                </View>
              ) : null}

              {r.hr != null || r.risk_score != null ? (
                <Text style={[type.sub, { marginTop: 8 }]}>
                  {[
                    r.hr != null ? `Heart rate ${Math.round(r.hr)} bpm` : null,
                    r.baseline_hr != null ? `baseline ${Math.round(r.baseline_hr)} bpm` : null,
                    r.hr != null && r.baseline_hr != null
                      ? `+${Math.max(0, Math.round(r.hr - r.baseline_hr))} over`
                      : null,
                    r.risk_score != null
                      ? `risk ${Number(r.risk_score).toFixed(2)}${r.risk_level ? ` (${r.risk_level})` : ""}`
                      : null,
                  ].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
              {r.unseen_context ? (
                <Text style={[type.meta, { marginTop: 6, color: C.warning }]}>
                  Not a registered trigger — the body reacted anyway. Review whether this belongs on the trigger list.
                </Text>
              ) : null}
              {r.message ? (
                <Text style={[type.sub, { marginTop: 10 }]}>{`Companio said: "${r.message}"`}</Text>
              ) : null}
              {r.decision_source ? (
                <View style={{ marginTop: 8 }}><DecisionSourceBadge source={r.decision_source} /></View>
              ) : null}

              {r.image_s3_key || r.s3_key ? (
                <TriggerImage s3Key={r.image_s3_key || r.s3_key} patientId={patientId} />
              ) : r.image_retained === false ? (
                <Text style={[type.meta, { marginTop: 10 }]}>
                  Image not kept — this patient has image saving turned off. What was recognised is recorded above.
                </Text>
              ) : null}
            </Card>
          </View>
        );
      })}
      <Disclaimer />
    </Screen>
  );
}

export function RecordNotifications({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;
  const { sessions, decisions, loading, refreshing, setRefreshing, load } = useRecord(patientId);

  const alerts = (sessions || [])
    .filter((r) => ["emergency_alert", "call_request", "appointment_request", "acknowledgement"].includes(r.type))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const autoContacts = (decisions || [])
    .filter((d) => d.escalation_required || d.decision_source)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 20);

  const label = {
    emergency_alert: "Emergency alert",
    call_request: "Contact requested",
    appointment_request: "Appointment requested",
    acknowledgement: "You acknowledged",
  };

  return (
    <Screen refreshControl={refresher(refreshing, setRefreshing, load)}>
      <AppHeader eyebrow="CLINICAL RECORD" title="Notifications & contact"
        subtitle={p?.name ? `${p.name} · what was sent and how it resolved` : "What was sent and how it resolved"}
        onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={C.primary} /> : null}

      <SectionTitle sub="Requests the patient raised, and whether they were acknowledged.">
        From the patient
      </SectionTitle>
      {alerts.length === 0 ? (
        <Card><EmptyState icon="notifications-off" title="Nothing raised yet"
          sub="Call requests, emergency alerts and your acknowledgements appear here." /></Card>
      ) : alerts.map((r, i) => (
        <Card key={r.session_id || i}
          accent={r.type === "emergency_alert" ? C.danger
            : r.type === "acknowledgement" ? C.success : C.accentBlue}>
          <Row
            icon={r.type === "emergency_alert" ? "alert-circle"
              : r.type === "acknowledgement" ? "checkmark-circle" : "call"}
            iconFg={r.type === "emergency_alert" ? C.danger
              : r.type === "acknowledgement" ? C.success : C.accentBlue}
            iconBg={r.type === "emergency_alert" ? C.dangerSoft
              : r.type === "acknowledgement" ? C.successSoft : C.accentBlueSoft}
            title={label[r.type] || r.type}
            subtitle={when(r.created_at)}
            right={r.ack_state === "acknowledged"
              ? <Pill text="Acknowledged" fg={C.success} bg={C.successSoft} />
              : r.type === "acknowledgement" ? null
              : <Pill text="Needs attention" fg={C.danger} bg={C.dangerSoft} />} />
          {r.message ? <Text style={[type.sub, { marginTop: 8 }]}>{r.message}</Text> : null}
          {r.acknowledged_by ? (
            <Text style={[type.meta, { marginTop: 6 }]}>{`Acknowledged by ${r.acknowledged_by}`}</Text>
          ) : null}
        </Card>
      ))}

      <SectionTitle sub="What Companio offered on its own when it detected distress, and which layer decided.">
        How Companio responded
      </SectionTitle>
      {autoContacts.length === 0 ? (
        <Card><EmptyState icon="flash-off" title="No automatic support yet" /></Card>
      ) : autoContacts.map((d, i) => (
        <Card key={d.decision_id || i} accent={d.escalation_required ? C.danger : undefined}>
          <Row icon={d.escalation_required ? "arrow-up-circle" : "flash"}
            iconFg={d.escalation_required ? C.danger : C.warning}
            iconBg={d.escalation_required ? C.dangerSoft : C.warningSoft}
            title={d.selected_action || "Support offered"}
            subtitle={when(d.timestamp)} />
          {d.message ? (
            <Text style={[type.sub, { marginTop: 8, fontStyle: "italic" }]}>{`"${d.message}"`}</Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
            <DecisionSourceBadge source={d.decision_source} />
            {d.therapist_rule_id ? (
              <Text style={[type.meta, { marginLeft: 8 }]}>{d.therapist_rule_id}</Text>
            ) : null}
          </View>
          {typeof d.patient_reported_helped === "boolean" ? (
            <Text style={[type.meta, { marginTop: 6 }]}>
              {d.patient_reported_helped ? "Patient said this helped" : "Patient said this did not help"}
            </Text>
          ) : null}
        </Card>
      ))}

      <Disclaimer />
    </Screen>
  );
}
