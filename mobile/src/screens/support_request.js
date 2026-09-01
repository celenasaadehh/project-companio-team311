// Ask for support, by text or urgently.
import React, { useState } from "react";
import { View, Text, TextInput, ActivityIndicator } from "react-native";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Chip, Btn, Disclaimer, DecisionSourceBadge, EngineTrace } from "../components/ui";
import { FollowUpCheck } from "../components/followup";
import { decideMoment } from "../services/decide";
import { SAFE_FALLBACK_MESSAGE } from "../services/engine";
import { useApp } from "../state/AppContext";

const SEVERITY = [
  { label: "A little", riskLevel: "elevated" },
  { label: "A lot", riskLevel: "high" },
  { label: "It's a crisis", riskLevel: "critical" },
];

export function RequestSupport({ navigation }) {
  const { currentPatientId, askFollowupQuestions, vitals } = useApp();
  const [severity, setSeverity] = useState(SEVERITY[0]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState("form");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function submit() {
    setPhase("loading");
    setError(null);
    try {
      const out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: severity.riskLevel,
        risk_score: null,
        transcript: text.trim(),
        observed_triggers: [],
        sleep_hours_last_night: vitals?.sleepHoursLastNight ?? null,
        poor_sleep: !!vitals?.poorSleep,
      });
      setResult(out);
      setPhase("result");
    } catch (e) {
      setError(e?.message || String(e));
      setPhase("form");
    }
  }

  if (phase === "result" && result) {
    return (
      <Screen>
        <AppHeader title="Companio is here" onBack={() => navigation.goBack()} />
        <Card accent={C.primary}>
          <Text style={[type.body, { fontSize: 16 }]}>
            {result.spoken_message || result.message || SAFE_FALLBACK_MESSAGE}
          </Text>
          <View style={{ marginTop: 10 }}>{result.decision_source ? <DecisionSourceBadge source={result.decision_source} /> : null}</View>
        </Card>
        <EngineTrace trace={result.trace} source={result.decision_source} />
        <FollowUpCheck patientId={currentPatientId} baseContext={{ patient_id: currentPatientId, risk_level: severity.riskLevel, transcript: text.trim() }} autoAsk={askFollowupQuestions}
          previousAction={result?.selected_action || result?.action || null}
          previousMessage={result?.spoken_message || result?.message || null} />
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title="Ask for support" subtitle="You don't need a device connected — reach out any time." onBack={() => navigation.goBack()} />
      <SectionTitle>How much are you struggling right now?</SectionTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {SEVERITY.map((s) => <Chip key={s.label} label={s.label} active={severity.label === s.label} onPress={() => setSeverity(s)} />)}
      </View>
      <SectionTitle>What's going on? (optional)</SectionTitle>
      <Card>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Tell Companio what's happening, if you can…"
          placeholderTextColor={C.textMuted}
          multiline
          style={{ minHeight: 90, textAlignVertical: "top", fontSize: 15, color: C.textPrimary }}
        />
      </Card>
      {phase === "loading" ? <ActivityIndicator color={C.primary} style={{ marginTop: 14 }} /> : <Btn label="Get support now" icon="heart" onPress={submit} />}
      {error ? <Text style={[type.meta, { color: C.danger, marginTop: 8, textAlign: "center" }]}>{error}</Text> : null}
      <Text style={[type.meta, { marginTop: 12, textAlign: "center" }]}>
        If you're in immediate danger, call 911 or the 988 Suicide & Crisis Lifeline.
      </Text>
      <Disclaimer />
    </Screen>
  );
}
