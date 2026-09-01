// Episode timeline, assembled from stored records.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState,
         Disclaimer, DecisionSourceBadge } from "../components/ui";
import { getSessions, getDecisions } from "../services/engine";
import { useApp } from "../state/AppContext";

const time = (iso) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};
const day = (iso) => {
  try { return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
  catch { return ""; }
};

function assembleEpisodes(sessions, decisions) {
  const byId = new Map();

  const bucket = (id, startedAt) => {
    if (!byId.has(id)) {
      byId.set(id, { episode_id: id, started_at: startedAt || null,
                     rows: [], decisions: [], summary: null });
    }
    return byId.get(id);
  };

  for (const s of sessions || []) {
    const id = s.episode_id || `legacy:${s.session_id || s.created_at}`;
    const ep = bucket(id, s.episode_started_at || s.created_at);
    if (s.type === "episode") ep.summary = s;
    else ep.rows.push(s);
    if (!ep.started_at || (s.created_at && s.created_at < ep.started_at)) {
      ep.started_at = s.episode_started_at || s.created_at;
    }
  }

  for (const d of decisions || []) {
    const id = d.episode_id || `legacy:${d.decision_id}`;
    bucket(id, d.episode_started_at || d.timestamp).decisions.push(d);
  }

  return [...byId.values()]
    .map((ep) => ({
      ...ep,
      rows: ep.rows.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
      decisions: ep.decisions.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0)),
    }))
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
}

function storyOf(ep) {
  const out = [];

  if (ep.summary?.opened_by || ep.rows[0]) {
    const opened = ep.summary?.episode_opened_by || ep.rows[0]?.episode_opened_by;
    if (opened) {
      out.push({
        icon: opened === "physiological_rise" ? "pulse"
          : opened === "camera_scan" ? "camera"
          : opened === "voice_checkin" ? "mic" : "play",
        text: opened === "physiological_rise" ? "Physiological signals rose above baseline"
          : opened === "camera_scan" ? "Surroundings checked"
          : opened === "voice_checkin" ? "Patient started a voice check-in"
          : `Episode opened (${opened})`,
      });
    }
  }

  if (ep.summary?.risk_peak != null) {
    out.push({ icon: "trending-up", text: `Peak physiological risk ${Number(ep.summary.risk_peak).toFixed(2)}` });
  }
  if (ep.summary?.confounders?.length) {
    out.push({ icon: "information-circle",
               text: `Possible everyday explanation noted: ${ep.summary.confounders.join(", ")}` });
  }

  for (const r of ep.rows) {
    if (r.type === "trigger_event") {
      const trig = r.normalized_visual_trigger || r.trigger;
      const isKnown = r.known_trigger === true;
      out.push({
        icon: "camera", at: r.created_at,
        text: isKnown ? `Known trigger identified: ${r.matched_trigger || trig}`
          : trig ? `Context observed: ${trig} (no recorded trigger matched)`
          : "Surroundings checked, nothing matched",
        meta: [r.camera_source || r.source, r.trigger_match_score != null
          ? `match ${Number(r.trigger_match_score).toFixed(2)}` : null].filter(Boolean).join(" · "),
        image: r.image_s3_key || r.s3_key || null,
        retained: r.image_retained,
      });
    } else if (r.type === "voice_transcription") {
      if (r.patient_said) out.push({ icon: "chatbubble", at: r.created_at, text: `Patient said: "${r.patient_said}"` });
      if (r.companio_said) out.push({ icon: "volume-high", at: r.created_at, text: `Companio said: "${r.companio_said}"` });
    } else if (r.type === "call_request" || r.type === "emergency_alert") {
      out.push({ icon: r.type === "emergency_alert" ? "alert-circle" : "call",
                 at: r.created_at, urgent: true,
                 text: r.type === "emergency_alert" ? "Patient marked this an emergency" : "Patient requested contact" });
    } else if (r.type === "acknowledgement") {
      out.push({ icon: "checkmark-circle", at: r.created_at,
                 text: `${r.acknowledged_by || "Therapist"} acknowledged the request` });
    }
  }

  for (const d of ep.decisions) {
    out.push({
      icon: "flash", at: d.timestamp,
      text: d.selected_action ? `Companio offered: ${d.selected_action}` : "Companio offered support",
      source: d.decision_source, rule: d.therapist_rule_id,
      spoken: d.message || d.spoken_message,
      provenance: [d.risk_source, d.risk_model, d.risk_score != null ? `risk ${Number(d.risk_score).toFixed(2)}` : null]
        .filter(Boolean).join(" · "),
      helped: typeof d.patient_reported_helped === "boolean" ? d.patient_reported_helped : null,
    });
  }

  if (ep.summary?.outcome || ep.summary?.final_state) {
    const o = ep.summary.outcome || ep.summary.final_state;
    out.push({
      icon: o === "recovered" ? "checkmark-done" : o === "escalated" ? "arrow-up-circle" : "stop-circle",
      text: o === "recovered" ? "Patient reported feeling better — episode closed"
        : o === "escalated" ? "Escalated to a person"
        : o === "did_not_help" ? "Patient said it did not help"
        : `Episode ended (${o})`,
    });
  }
  // One globally time-ordered stream: grouped pushes preserved insertion
  // order, which could interleave camera/voice/decision rows out of sequence.
  out.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
  return out;
}

export function EpisodeTimeline({ route, navigation }) {
  const { patient, currentPatientId } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const p = patient ? patient(patientId) : null;

  const [episodes, setEpisodes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([
        getSessions(patientId).catch(() => null),
        getDecisions(patientId).catch(() => null),
      ]);
      setEpisodes(assembleEpisodes(s?.sessions || [], d?.decisions || []));
    } catch {
      setEpisodes([]);
    } finally { setLoading(false); setRefreshing(false); }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />}>
      <AppHeader eyebrow="CLINICAL RECORD" title="Episodes"
        subtitle={p?.name ? `${p.name} · each incident assembled from its own records` : "Each incident, assembled from its own records"}
        onBack={() => navigation.goBack()} />

      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} /> : null}

      {!loading && (!episodes || episodes.length === 0) ? (
        <Card>
          <EmptyState icon="pulse" title="No episodes recorded yet"
            sub="When Companio detects distress, checks the surroundings, or the patient starts a voice check-in, the whole incident appears here as one entry." />
        </Card>
      ) : null}

      {(episodes || []).map((ep) => {
        const story = storyOf(ep);
        if (!story.length) return null;
        const urgent = story.some((x) => x.urgent);
        return (
          <View key={ep.episode_id}>
            <SectionTitle sub={ep.summary?.duration_seconds
              ? `${day(ep.started_at)} · lasted ${Math.max(1, Math.round(ep.summary.duration_seconds / 60))} min`
              : day(ep.started_at)}>
              {time(ep.started_at)}
            </SectionTitle>
            <Card accent={urgent ? C.danger : C.primary}
              onPress={() => navigation.navigate("EventDetail", { patientId, episodeId: ep.episode_id })}>
              {story.map((line, i) => (
                <View key={i} style={{ flexDirection: "row", paddingVertical: 7 }}>
                  <View style={{ width: 26, alignItems: "center", paddingTop: 2 }}>
                    <Ionicons name={line.icon} size={16}
                      color={line.urgent ? C.danger : C.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.sub, { color: C.textPrimary }]}>
                      {line.at ? `${time(line.at)} — ` : ""}{line.text}
                    </Text>
                    {line.meta ? <Text style={[type.meta, { marginTop: 2 }]}>{line.meta}</Text> : null}
                    {line.provenance ? <Text style={[type.meta, { marginTop: 2 }]}>{line.provenance}</Text> : null}
                    {line.spoken ? (
                      <Text style={[type.meta, { marginTop: 2, fontStyle: "italic" }]}>
                        {`spoken: "${line.spoken}"`}
                      </Text>
                    ) : null}
                    {line.source ? (
                      <View style={{ marginTop: 5, flexDirection: "row", alignItems: "center" }}>
                        <DecisionSourceBadge source={line.source} />
                        {line.rule ? <Text style={[type.meta, { marginLeft: 8 }]}>{line.rule}</Text> : null}
                      </View>
                    ) : null}
                    {line.helped !== null && line.helped !== undefined ? (
                      <Text style={[type.meta, { marginTop: 3 }]}>
                        {line.helped ? "Patient said this helped" : "Patient said this did not help"}
                      </Text>
                    ) : null}
                    {line.image && line.retained === false ? (
                      <Text style={[type.meta, { marginTop: 2 }]}>
                        Image not retained — the patient has image saving turned off.
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {ep.episode_id.startsWith("legacy:") ? (
                <Text style={[type.meta, { marginTop: 8 }]}>
                  Recorded before episodes were grouped, so this may be part of a larger incident.
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
