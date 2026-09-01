// Clinical summary for the therapist.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Disclaimer, StatTile, ProgressBar, DecisionSourceBadge } from "../components/ui";
import { AreaChart } from "../components/charts";
import { getSessions, getDecisions, getMediaViewUrl } from "../services/engine";
import { useApp } from "../state/AppContext";

const stamp = (r) => r?.created_at || r?.timestamp || r?.updated_at;

function TriggerThumb({ s3Key, patientId, label, when }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getMediaViewUrl(s3Key, patientId)
      .then((r) => { if (!cancelled) setUrl(r?.url || null); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [s3Key, patientId]);

  return (
    <View style={{ width: "48%", marginBottom: spacing.md }}>
      <View style={{ height: 110, borderRadius: radius.md, overflow: "hidden", backgroundColor: C.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
        {url ? (
          <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : failed ? (
          <Ionicons name="image-outline" size={26} color={C.textMuted} />
        ) : (
          <ActivityIndicator color={C.primary} />
        )}
      </View>
      <Text style={[type.title, { fontSize: 13.5, marginTop: 6 }]} numberOfLines={1}>{label || "Captured"}</Text>
      {when ? <Text style={type.meta}>{new Date(when).toLocaleString()}</Text> : null}
    </View>
  );
}

export function ClinicalOverview({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;

  const [sessions, setSessions] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, d] = await Promise.all([
      getSessions(patientId).catch(() => null),
      getDecisions(patientId).catch(() => null),
    ]);
    setSessions(s?.sessions || []);
    setDecisions(d?.decisions || []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const snaps = (sessions || [])
    .filter((r) => r.type === "daily_snapshot")
    .sort((a, b) => new Date(stamp(a)) - new Date(stamp(b)));

  const hrSeries = snaps.filter((r) => r.resting_hr != null || r.hr != null).map((r) => Number(r.resting_hr ?? r.hr));
  const sleepSeries = snaps.filter((r) => r.sleep_hours_last_night != null).map((r) => Number(r.sleep_hours_last_night));

  const images = (sessions || [])
    .filter((r) => r.image_s3_key || r.s3_key)
    .sort((a, b) => new Date(stamp(b)) - new Date(stamp(a)));

  const medLogs = (sessions || []).filter((r) => r.type === "medication_log");
  const taken = medLogs.filter((m) => m.taken).length;
  const adherence = medLogs.length ? Math.round((taken / medLogs.length) * 100) : null;

  const alerts = (sessions || []).filter((r) => r.type === "emergency_alert" || r.type === "call_request");
  const voice = (sessions || []).filter((r) => r.type === "voice_transcription");

  const graded = (decisions || [])
    .filter((d) => d.selected_action && d.risk_score != null && d.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const tally = {};
  for (let i = 0; i < graded.length - 1; i++) {
    const cur = graded[i], next = graded[i + 1];
    const key = cur.selected_action;
    tally[key] = tally[key] || { action: key, tried: 0, helped: 0 };
    tally[key].tried += 1;
    if (Number(next.risk_score) <= Number(cur.risk_score)) tally[key].helped += 1;
  }
  const effectiveness = Object.values(tally)
    .map((t) => ({ ...t, rate: t.tried ? t.helped / t.tried : 0 }))
    .sort((a, b) => b.rate - a.rate || b.tried - a.tried);

  const sourceCounts = (decisions || []).reduce((acc, d) => {
    const k = d.decision_source || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <Screen>
      <AppHeader eyebrow="CLINICAL OVERVIEW" title={p?.name || patientId}
        subtitle="Physiology, triggers, and what has actually helped this patient."
        onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 24 }} /> : null}

      {!loading ? (
        <>
          <SectionTitle>At a glance</SectionTitle>
          <View style={{ flexDirection: "row", gap: spacing.md, marginBottom: spacing.md }}>
            <StatTile label="TRIGGERS" icon="alert-circle" tint={C.warning} value={images.length} unit="captured" />
            <StatTile label="CHECK-INS" icon="mic" tint={C.primary} value={voice.length} unit="voice" />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <StatTile label="ALERTS" icon="warning" tint={C.danger} value={alerts.length} unit="raised" />
            <StatTile label="ADHERENCE" icon="medkit" tint={C.success} value={adherence == null ? "—" : `${adherence}%`} unit={medLogs.length ? `${taken}/${medLogs.length}` : "no logs"} />
          </View>

          <SectionTitle sub={snaps.length ? `${snaps.length} recorded reading(s).` : undefined}>Physiology over time</SectionTitle>
          {hrSeries.length > 1 ? (
            <Card><AreaChart label="Resting heart rate" unit="bpm" data={hrSeries} color={C.danger}
              avg={Math.round(hrSeries.reduce((a, b) => a + b, 0) / hrSeries.length)} /></Card>
          ) : null}
          {sleepSeries.length > 1 ? (
            <Card><AreaChart label="Sleep" unit="hrs" data={sleepSeries} color={C.lavender}
              avg={(sleepSeries.reduce((a, b) => a + b, 0) / sleepSeries.length).toFixed(1)} /></Card>
          ) : null}
          {hrSeries.length <= 1 && sleepSeries.length <= 1 ? (
            <Card><EmptyState icon="pulse" title="Not enough readings yet"
              sub="Charts appear once this patient's watch has recorded more than one snapshot." /></Card>
          ) : null}

          <SectionTitle sub={images.length ? "Captured by the patient's camera at the moment it happened." : undefined}>
            What triggered them
          </SectionTitle>
          {images.length === 0 ? (
            <Card><EmptyState icon="camera" title="No trigger images"
              sub="Photos captured during a trigger will appear here for review." /></Card>
          ) : (
            <Card>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
                {images.slice(0, 8).map((im, i) => (
                  <TriggerThumb key={im.session_id || i}
                    s3Key={im.image_s3_key || im.s3_key}
                    patientId={patientId}
                    label={im.normalized_visual_trigger || (im.visual_labels || []).map((l) => l.name || l)[0]}
                    when={stamp(im)} />
                ))}
              </View>
            </Card>
          )}

          <SectionTitle sub={effectiveness.length
            ? "Graded on whether this patient's risk fell afterwards — the same signal the engine learns from."
            : undefined}>
            What has helped
          </SectionTitle>
          {effectiveness.length === 0 ? (
            <Card><EmptyState icon="stats-chart" title="Not enough history"
              sub="Effectiveness needs at least two recorded decisions to compare against each other." /></Card>
          ) : (
            <Card>
              {effectiveness.map((e) => (
                <View key={e.action} style={{ paddingVertical: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={[type.title, { flex: 1, fontSize: 14.5 }]} numberOfLines={1}>{e.action}</Text>
                    <Text style={[type.meta, { letterSpacing: 0 }]}>{e.helped}/{e.tried} helped</Text>
                    <View style={{ width: 8 }} />
                    <Pill text={`${Math.round(e.rate * 100)}%`}
                      fg={e.rate >= 0.6 ? C.success : e.rate >= 0.3 ? C.warning : C.danger}
                      bg={e.rate >= 0.6 ? C.successSoft : e.rate >= 0.3 ? C.warningSoft : C.dangerSoft} />
                  </View>
                  <ProgressBar value={e.rate * 100} color={e.rate >= 0.6 ? C.success : e.rate >= 0.3 ? C.warning : C.danger} />
                </View>
              ))}
              <Text style={[type.meta, { marginTop: 10, letterSpacing: 0 }]}>
                Advisory only. The engine weighs this history, but your rules always outrank it.
              </Text>
            </Card>
          )}

          <SectionTitle sub="Whether your rules or the model produced each response.">Decision sources</SectionTitle>
          {Object.keys(sourceCounts).length === 0 ? (
            <Card><EmptyState icon="flash" title="No decisions recorded yet" /></Card>
          ) : (
            <Card>
              {Object.entries(sourceCounts).map(([src, n]) => (
                <View key={src} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}>
                  <DecisionSourceBadge source={src} />
                  <View style={{ flex: 1 }} />
                  <Text style={[type.title, { fontSize: 15 }]}>{n}</Text>
                </View>
              ))}
            </Card>
          )}

          <SectionTitle>Go deeper</SectionTitle>
          <Card onPress={() => navigation.navigate("PatientDay", { patientId })}>
            <Row icon="today" iconFg={C.primary} iconBg={C.primarySoft} title="Day-by-day summary"
              subtitle="Everything recorded for a single day"
              right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
          </Card>
          <Card onPress={() => navigation.navigate("DecisionInspector", { patientId })}>
            <Row icon="flash" iconFg={C.lavender} iconBg={C.lavenderSoft} title="Full decision trace"
              subtitle="Step-by-step reasoning for every decision"
              right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
          </Card>
        </>
      ) : null}

      <Disclaimer />
    </Screen>
  );
}
