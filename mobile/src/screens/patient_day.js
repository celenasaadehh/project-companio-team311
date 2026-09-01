// One day for one patient, for the therapist.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, RefreshControl, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Disclaimer, StatTile, DecisionSourceBadge, Btn } from "../components/ui";
import { AreaChart, DayChart } from "../components/charts";
import { getSessions, getDecisions } from "../services/engine";
import { acknowledgeRequest } from "../services/alerts";
import { useApp } from "../state/AppContext";

const DAY_MS = 86400000;

function sameDay(iso, dayStart) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= dayStart && t < dayStart + DAY_MS;
}

export function PatientDay({ route, navigation }) {
  const { patient, currentPatientId, authUser } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;

  const [dayOffset, setDayOffset] = useState(0);
  const [acked, setAcked] = useState({});
  const [sessions, setSessions] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, d] = await Promise.all([
        getSessions(patientId).catch(() => null),
        getDecisions(patientId).catch(() => null),
      ]);
      setSessions(s?.sessions || []);
      setDecisions(d?.decisions || []);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime() - dayOffset * DAY_MS;
  const dayLabel = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Yesterday" : new Date(dayStart).toLocaleDateString();

  const stamp = (r) => r.created_at || r.timestamp || r.updated_at;
  const todaySessions = (sessions || []).filter((r) => sameDay(stamp(r), dayStart));
  const todayDecisions = (decisions || []).filter((r) => sameDay(stamp(r), dayStart));

  const snapshots = todaySessions.filter((r) => r.type === "daily_snapshot");
  const snap = snapshots[snapshots.length - 1] || null;
  const medLogs = todaySessions.filter((r) => r.type === "medication_log");
  const alerts = todaySessions.filter((r) => r.type === "emergency_alert" || r.type === "call_request");
  const triggerSessions = todaySessions.filter((r) => r.normalized_visual_trigger || r.visual_labels?.length);
  const voice = todaySessions.filter((r) => r.type === "voice_transcription" && r.transcript);

  const hrSeries = todaySessions
    .filter((r) => r.type === "daily_snapshot" && r.hr != null)
    .sort((a, b) => new Date(stamp(a)) - new Date(stamp(b)))
    .map((r) => Number(r.hr));

  const takenMeds = medLogs.filter((m) => m.taken);
  const missedMeds = medLogs.filter((m) => !m.taken);

  return (
    <Screen>
      <AppHeader
        eyebrow="DAILY SUMMARY"
        title={p?.name || patientId}
        subtitle={`${dayLabel} · everything recorded for this patient`}
        onBack={() => navigation.goBack()}
      />

      <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
        {[0, 1, 2].map((o) => (
          <Text key={o} onPress={() => setDayOffset(o)}
            style={{ color: dayOffset === o ? C.primary : C.textMuted, fontWeight: "600", fontSize: 13, paddingVertical: 4, paddingRight: 14 }}>
            {o === 0 ? "Today" : o === 1 ? "Yesterday" : "2 days ago"}
          </Text>
        ))}
      </View>

      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={[type.meta, { color: C.danger, textAlign: "center" }]}>Couldn't load records: {error}</Text> : null}

      {!loading && !error ? (
        <>
          <SectionTitle sub={snap ? `From the patient's watch via Apple Health.` : undefined}>Physiology</SectionTitle>
          {snap ? (
            <>
              <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
                <StatTile label="RESTING HR" icon="heart" tint={C.danger} value={snap.resting_hr ?? snap.hr ?? "—"} unit="bpm" />
                <StatTile label="HRV" icon="pulse" tint={C.primary} value={snap.hrv ?? "—"} unit="ms" />
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
                <StatTile label="SLEEP" icon="moon" tint={C.lavender} value={snap.sleep_hours_last_night ?? "—"} unit="hrs" />
                <StatTile label="STEPS" icon="footsteps" tint={C.teal} value={snap.steps ?? "—"} unit="today" />
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
                <StatTile label="ACTIVE" icon="flame" tint={C.warning} value={snap.active_energy ?? "—"} unit="kcal" />
                <StatTile label="CAFFEINE" icon="cafe" tint={C.warning} value={snap.caffeine_mg ?? "—"} unit="mg" />
              </View>
              <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
                <StatTile label="RESP RATE" icon="pulse" tint={C.teal} value={snap.respiratory_rate ?? "—"} unit="br/min" />
                <StatTile label="OXYGEN" icon="water" tint={C.accentBlue} value={snap.oxygen_saturation ?? "—"} unit="%" />
              </View>

              {(snap.hourly_steps || []).length ? (
                <Card>
                  <Text style={[type.meta, { marginBottom: 10 }]}>MOVEMENT ACROSS THE DAY</Text>
                  <DayChart data={snap.hourly_steps} color={C.primary} />
                </Card>
              ) : null}

              {snap.hr_age_minutes != null ? (
                <Text style={[type.meta, { marginTop: 4 }]}>
                  {`Heart rate recorded ${snap.hr_age_minutes} min before this snapshot`}
                  {snap.hrv_age_minutes != null ? ` · HRV ${snap.hrv_age_minutes} min` : ""}
                  {snap.hr_freshness ? ` · ${snap.hr_freshness}` : ""}
                </Text>
              ) : null}

              {hrSeries.length > 1 ? (
                <Card><AreaChart label="Heart rate across the day" unit="bpm" data={hrSeries} color={C.danger}
                  avg={Math.round(hrSeries.reduce((a, b) => a + b, 0) / hrSeries.length)} /></Card>
              ) : null}

              {(snap.caffeine_mg || snap.recent_workout_minutes_ago != null || snap.poor_sleep) ? (
                <Card accent={C.warning}>
                  <Text style={type.meta}>CONTEXT THAT AFFECTS THESE NUMBERS</Text>
                  {snap.poor_sleep ? <Text style={[type.body, { marginTop: 6 }]}>• Slept {snap.sleep_hours_last_night}h — below their usual.</Text> : null}
                  {snap.caffeine_mg ? <Text style={[type.body, { marginTop: 6 }]}>• {snap.caffeine_mg}mg caffeine logged today.</Text> : null}
                  {snap.recent_workout_minutes_ago != null ? <Text style={[type.body, { marginTop: 6 }]}>• Workout ended {snap.recent_workout_minutes_ago} minutes before the reading.</Text> : null}
                </Card>
              ) : null}
            </>
          ) : (
            <Card><EmptyState icon="watch" title="No physiological data" sub="Nothing was recorded for this day — the patient's watch may not have been connected." /></Card>
          )}

          <SectionTitle sub={medLogs.length ? `${takenMeds.length} taken · ${missedMeds.length} marked not taken` : undefined}>Medication</SectionTitle>
          {medLogs.length === 0 ? (
            <Card><EmptyState icon="medkit" title="No medication activity" sub="Nothing was marked taken or missed on this day." /></Card>
          ) : (
            <Card>
              {medLogs.map((m, i) => (
                <Row key={m.session_id || i}
                  icon={m.taken ? "checkmark-circle" : "close-circle"}
                  iconFg={m.taken ? C.success : C.warning}
                  iconBg={m.taken ? C.successSoft : C.warningSoft}
                  title={m.medication || "Medication"}
                  subtitle={[m.dose, new Date(stamp(m)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}
                  right={<Pill text={m.taken ? "Taken" : "Not taken"} fg={m.taken ? C.success : C.warning} bg={m.taken ? C.successSoft : C.warningSoft} />} />
              ))}
            </Card>
          )}

          <SectionTitle>What triggered them</SectionTitle>
          {triggerSessions.length === 0 ? (
            <Card><EmptyState icon="alert-circle" title="No triggers detected" sub="The camera didn't match anything on their trigger list this day." /></Card>
          ) : (
            triggerSessions.map((t, i) => (
              <Card key={t.session_id || i} accent={C.warning}>
                <Row icon="eye" iconFg={C.warning} iconBg={C.warningSoft}
                  title={t.normalized_visual_trigger || (t.visual_labels || []).map((l) => l.name || l).slice(0, 3).join(", ")}
                  subtitle={new Date(stamp(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                {t.message ? <Text style={[type.body, { marginTop: 8 }]}>Companio said: “{t.message}”</Text> : null}
                {t.decision_source ? <View style={{ marginTop: 8 }}><DecisionSourceBadge source={t.decision_source} /></View> : null}
              </Card>
            ))
          )}

          {voice.length ? (
            <>
              <SectionTitle>In their own words</SectionTitle>
              {voice.map((v, i) => (
                <Card key={v.session_id || i}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={type.meta}>{new Date(stamp(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                    {v.turn ? <><View style={{ width: 8 }} /><Pill text={`Turn ${v.turn}`} fg={C.textMuted} bg={C.surfaceStrong} /></> : null}
                  </View>

                  <Text style={[type.meta, { marginTop: 10, color: C.textSecondary }]}>PATIENT SAID</Text>
                  <Text style={[type.body, { marginTop: 3, fontStyle: "italic" }]}>“{v.patient_said || v.transcript}”</Text>

                  {(v.companio_said || v.message) ? (
                    <>
                      <Text style={[type.meta, { marginTop: 12, color: C.primary }]}>COMPANIO REPLIED</Text>
                      <Text style={[type.body, { marginTop: 3 }]}>{v.companio_said || v.message}</Text>
                      {v.decision_source ? <View style={{ marginTop: 8 }}><DecisionSourceBadge source={v.decision_source} /></View> : null}
                    </>
                  ) : null}
                </Card>
              ))}
            </>
          ) : null}

          {alerts.length ? (
            <>
              <SectionTitle>Requests & alerts</SectionTitle>
              {alerts.map((a, i) => {
                const ackedHere = acked[a.session_id];
                const already = a.ack_state === "acknowledged" || ackedHere;
                return (
                  <Card key={a.session_id || i} accent={a.type === "emergency_alert" ? C.danger : C.accentBlue}>
                    <Row icon={a.type === "emergency_alert" ? "alert-circle" : "call"}
                      iconFg={a.type === "emergency_alert" ? C.danger : C.accentBlue}
                      iconBg={a.type === "emergency_alert" ? C.dangerSoft : C.accentBlueSoft}
                      title={a.type === "emergency_alert" ? "Marked as an emergency" : "Requested a call"}
                      subtitle={new Date(stamp(a)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                    {already ? (
                      <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
                        title="You let them know you've seen this"
                        subtitle={a.acknowledged_by ? `Acknowledged by ${a.acknowledged_by}` : "The patient can see this."} />
                    ) : (
                      <Btn label="Let them know I've seen this" icon="checkmark-circle"
                        onPress={async () => {
                          try {
                            await acknowledgeRequest(patientId, a.session_id, authUser?.name || authUser?.username);
                            setAcked((m) => ({ ...m, [a.session_id]: true }));
                          } catch (e) {
                            Alert.alert("Could not acknowledge",
                              `${String(e?.message || e)}\n\nThe patient has NOT been told yet.`);
                          }
                        }} />
                    )}
                  </Card>
                );
              })}
            </>
          ) : null}

          <SectionTitle sub={todayDecisions.length ? undefined : "Nothing was decided on this day."}>What Companio decided</SectionTitle>
          {todayDecisions.length === 0 ? (
            <Card><EmptyState icon="flash" title="No decisions recorded" /></Card>
          ) : (
            todayDecisions.slice(0, 8).map((d, i) => (
              <Card key={d.decision_id || i}>
                <Row icon="flash" iconFg={C.lavender} iconBg={C.lavenderSoft}
                  title={d.selected_action || "Support offered"}
                  subtitle={d.timestamp ? new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                  right={<DecisionSourceBadge source={d.decision_source} />} />
                {d.message ? <Text style={[type.sub, { marginTop: 8 }]}>“{d.message}”</Text> : null}
                {d.reason_code ? <Text style={[type.meta, { marginTop: 6 }]}>{d.reason_code}</Text> : null}
              </Card>
            ))
          )}
        </>
      ) : null}

      <Disclaimer />
    </Screen>
  );
}
