// How a decision was reached.
import React, { useState, useEffect } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Disclaimer, DecisionSourceBadge } from "../components/ui";
import { getDecisions } from "../services/engine";
import { useApp } from "../state/AppContext";

function traceFor(d) {
  const steps = [];
  const reason = d.reason_code || "";

  steps.push({
    icon: "shield-checkmark",
    label: "Checked for a matching therapist rule",
    result: d.decision_source === "therapist_rule"
      ? `Matched ${d.therapist_rule_id || "a stored rule"} — used it exactly, no AI involved`
      : "No rule matched this exact situation",
    matched: d.decision_source === "therapist_rule",
  });

  if (d.decision_source !== "therapist_rule") {
    if (reason.includes("distress gate")) {
      steps.push({
        icon: "pulse",
        label: "Checked whether the text actually sounded distressed (DistilBERT)",
        result: "Didn't sound distressed — no intervention forced",
        matched: true,
      });
    } else if (reason.includes("recommender predicted")) {
      const stageMatch = reason.match(/predicted (\w+) stage/);
      steps.push({
        icon: "help-buoy",
        label: "Guessed what kind of support fits (trained recommender)",
        result: stageMatch ? `Predicted: ${stageMatch[1]}` : "Predicted a support stage",
        matched: true,
      });
      if (reason.includes("bandit-selected")) {
        steps.push({
          icon: "trending-up",
          label: "Multiple approved actions tied — bandit picked using this patient's real history",
          result: `Chose "${d.selected_action}"`,
          matched: true,
        });
      }
    } else if (d.decision_source === "safe_fallback") {
      steps.push({
        icon: "leaf",
        label: "Nothing safe to confidently offer",
        result: reason || "Fell back to a safe, neutral response",
        matched: true,
      });
    }
    steps.push({
      icon: "checkmark-done",
      label: "Safety check before speaking",
      result: d.decision_source === "safe_fallback" && reason.toLowerCase().includes("blocked")
        ? "Original message was blocked — replaced with the safe fallback"
        : "Passed — nothing unsafe detected",
      matched: true,
    });
  }

  return steps;
}

function PatientDecisionCard({ d }) {
  const sawSomething = d.visual_labels?.length || d.normalized_visual_trigger;
  const heardSomething = !!d.transcript;
  return (
    <Card accent={C.primary}>
      <Row icon="time" iconFg={C.textSecondary} iconBg="#EEF1F6" title={d.timestamp ? new Date(d.timestamp).toLocaleString() : "Recent moment"}
        right={<DecisionSourceBadge source={d.decision_source} />} />
      <Text style={[type.sub, { marginTop: 10 }]}>
        {sawSomething ? "Companio noticed something in your surroundings and checked in." : heardSomething ? "Companio listened to your check-in and offered a response." : "Companio checked in with you."}
      </Text>
      {d.message ? (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
          <Text style={type.meta}>WHAT COMPANIO SAID</Text>
          <Text style={[type.body, { marginTop: 4, fontStyle: "italic" }]}>"{d.message}"</Text>
        </View>
      ) : null}
      <Text style={[type.meta, { marginTop: 10 }]}>Your therapist can see the full detail behind this.</Text>
    </Card>
  );
}

function TherapistDecisionCard({ d }) {
  const steps = traceFor(d);
  return (
    <Card accent={C.primary}>
      <Row icon="time" iconFg={C.textSecondary} iconBg="#EEF1F6" title={d.timestamp ? new Date(d.timestamp).toLocaleString() : "Recent decision"}
        right={<DecisionSourceBadge source={d.decision_source} />} />

      {(d.visual_labels?.length || d.normalized_visual_trigger) ? (
        <Text style={[type.sub, { marginTop: 10 }]}>Seen: {d.normalized_visual_trigger || (d.visual_labels || []).join(", ")}</Text>
      ) : null}
      {d.transcript ? <Text style={[type.sub, { marginTop: 6 }]}>Heard: "{d.transcript}"</Text> : null}
      {d.risk_level ? <Text style={[type.sub, { marginTop: 6 }]}>Risk level at the time: {d.risk_level}{d.risk_score != null ? ` (${d.risk_score})` : ""}</Text> : null}

      <View style={{ marginTop: 14 }}>
        {steps.map((s, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
            <Ionicons name={s.icon} size={17} color={s.matched ? C.primary : C.textMuted} style={{ marginTop: 2, marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: "650" }]}>{s.label}</Text>
              <Text style={[type.sub, { marginTop: 2 }]}>{s.result}</Text>
            </View>
          </View>
        ))}
      </View>

      {d.message ? (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
          <Text style={type.meta}>WHAT WAS ACTUALLY SAID</Text>
          <Text style={[type.body, { marginTop: 4, fontStyle: "italic" }]}>"{d.message}"</Text>
        </View>
      ) : null}
      {d.poor_sleep ? <Pill text={`Poor sleep noted: ${d.sleep_hours_last_night}h`} fg={C.warning} bg={C.warningSoft} icon="moon" /> : null}
    </Card>
  );
}

export function DecisionInspector({ route, navigation }) {
  const { currentPatientId, role } = useApp();
  const patientId = route?.params?.patientId || currentPatientId;
  const viewerRole = route?.params?.patientId ? "therapist" : role;
  const [decisions, setDecisions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDecisions(patientId)
      .then((r) => { if (!cancelled) setDecisions(r?.decisions || []); })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  const sorted = (decisions || []).slice().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  return (
    <Screen>
      <AppHeader title="How it decided" subtitle="A real, live trace of what actually happened — not a scripted demo." onBack={() => navigation.goBack()} />
      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} /> : null}
      {error ? <Text style={[type.meta, { color: C.danger, marginTop: 10, textAlign: "center" }]}>Couldn't load real decisions right now: {error}</Text> : null}
      {!loading && !error && sorted.length === 0 ? (
        <EmptyState icon="flash" title="No decisions yet" sub="Try the camera, a voice check-in, or ask for support — then come back here to see exactly how Companio decided what to say, step by step." />
      ) : null}
      {sorted.slice(0, 10).map((d, i) =>
        viewerRole === "therapist"
          ? <TherapistDecisionCard key={d.decision_id || i} d={d} />
          : <PatientDecisionCard key={d.decision_id || i} d={d} />
      )}
      <Disclaimer />
    </Screen>
  );
}
