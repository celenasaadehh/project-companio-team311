// "Did that help?" — the outcome that trains personalisation.
import React, { useState } from "react";
import { View, Text, Linking } from "react-native";
import { colors as C, spacing, type } from "../theme/theme";
import { Card, Btn, Chip, DecisionSourceBadge } from "./ui";
import { decideMoment } from "../services/decide";
import { requestCall, raiseEmergencyAlert } from "../services/alerts";
import { saveDecision } from "../services/engine";
import { closeEpisode } from "../services/episode";
import { trySync } from "../services/errors";

const SYMPTOM_OPTIONS = ["Racing heart", "Trouble breathing", "Feeling unsafe", "Just overwhelmed", "Something else"];

export function FollowUpCheck({ patientId, baseContext, autoAsk = false, previousAction = null, previousMessage = null, caregiver = null }) {
  const [phase, setPhase] = useState(autoAsk ? "clarifying" : "ask");
  const [refined, setRefined] = useState(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);

  async function recordOutcome(helped) {
    if (!previousAction || !patientId) return;
    closeEpisode(helped ? "recovered" : "did_not_help");
    await trySync("intervention_outcome", saveDecision({
      patient_id: patientId,
      decision_id: baseContext?.decision_id || undefined,
      selected_action: previousAction,
      patient_reported_helped: helped,
      outcome_recorded_at: new Date().toISOString(),
      decision_timestamp: baseContext?.decision_timestamp || null,
      risk_score: baseContext?.risk_score ?? null,
    }), { detail: previousAction });
  }

  async function retryWithSymptom(symptom) {
    setBusy(true);
    try {
      const out = await decideMoment({
        ...baseContext,
        patient_id: patientId,
        transcript: symptom
          ? `${baseContext.transcript || ""} I'm noticing: ${symptom}.`.trim()
          : `${baseContext.transcript || ""} That did not help.`.trim(),
        risk_level: symptom === "Feeling unsafe" ? "high" : (baseContext.risk_level || "elevated"),
        // Belt and braces: the episode already tracks what has been offered,
        // but naming the failed action here means the exclusion holds even if
        // the episode has expired between attempts.
        exclude_actions: [
          ...(baseContext.exclude_actions || []),
          ...(previousAction ? [previousAction] : []),
        ],
      });

      setAttempts((n) => n + 1);
      const nextAction = out?.selected_action || out?.action || null;
      const sameAsFailed =
        (nextAction && previousAction && nextAction === previousAction) ||
        (out?.spoken_message && previousMessage && out.spoken_message === previousMessage);

      if (sameAsFailed || symptom === "Feeling unsafe") {
        setRefined(out);
        setPhase("escalate");
      } else {
        setRefined(out);
        setPhase("retried");
      }
    } catch {
      setPhase("escalate");
    } finally {
      setBusy(false);
    }
  }

  async function escalate(kind) {
    setBusy(true);
    try {
      if (kind === "call_request") await requestCall(patientId);
      else await raiseEmergencyAlert(patientId);
      setPhase("sent");
    } catch {
      setPhase("sent");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "ask") {
    return (
      <Card accent={C.primary}>
        <Text style={type.title}>Did that help?</Text>
        <View style={{ flexDirection: "row", marginTop: 10 }}>
          <View style={{ flex: 1, marginRight: 6 }}><Btn label="Yes" icon="checkmark" onPress={() => { recordOutcome(true); setPhase("done"); }} /></View>
          <View style={{ flex: 1 }}><Btn label="Not really" variant="outline" onPress={() => { recordOutcome(false); setPhase("clarifying"); }} /></View>
        </View>
      </Card>
    );
  }

  if (phase === "clarifying") {
    return (
      <Card accent={C.warning}>
        <Text style={type.title}>What are you noticing right now?</Text>
        <Text style={[type.sub, { marginTop: 4 }]}>This helps Companio try something better suited to the moment.{autoAsk ? " (You turned this on in your profile.)" : ""}</Text>
        <View style={{ marginTop: 12 }}>
          <Btn label={busy ? "Finding something else…" : "Just try something else"} icon="refresh"
            disabled={busy} onPress={() => !busy && retryWithSymptom(null)} />
        </View>
        <Text style={[type.meta, { marginTop: 12 }]}>
          Or tell Companio what you're noticing, so it can pick something better suited:
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
          {SYMPTOM_OPTIONS.map((s) => <Chip key={s} label={s} onPress={() => !busy && retryWithSymptom(s)} />)}
        </View>
        {busy ? <Text style={[type.meta, { marginTop: 8 }]}>One moment…</Text> : null}
      </Card>
    );
  }

  if (phase === "retried" && refined) {
    return (
      <Card accent={C.success}>
        <Text style={type.title}>Let's try this instead</Text>
        <Text style={[type.body, { marginTop: 8 }]}>{refined.spoken_message}</Text>
        <View style={{ marginTop: 8 }}>{refined.decision_source ? <DecisionSourceBadge source={refined.decision_source} /> : null}</View>
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <View style={{ flex: 1, marginRight: 6 }}><Btn label="Better" icon="checkmark" onPress={() => { recordOutcome(true); setPhase("done"); }} /></View>
          <View style={{ flex: 1 }}><Btn label="Still not okay" color={C.danger} variant="outline" onPress={() => { recordOutcome(false); setPhase("escalate"); }} /></View>
        </View>
      </Card>
    );
  }

  if (phase === "escalate") {
    return (
      <Card accent={C.danger}>
        <Text style={type.title}>Let's get you more support</Text>
        <Text style={[type.body, { marginTop: 8 }]}>
          {caregiver?.phone
            ? `You can keep trying something here, reach ${caregiver.name || "your emergency contact"}, or contact your therapist.`
            : "You can keep trying something here, or reach out for real support."}
        </Text>

        <View style={{ marginTop: spacing.md }}>
          <Btn label="Try something else" icon="refresh" color={C.teal} variant="outline"
            onPress={() => setPhase("clarifying")} disabled={busy} />

          {caregiver?.phone ? (
            <Btn label={`Call ${caregiver.name || "my emergency contact"}`} icon="people" color={C.teal}
              onPress={() => Linking.openURL(`tel:${String(caregiver.phone).replace(/[^+\d]/g, "")}`)} />
          ) : null}

          <Btn label="Request a call from my therapist" icon="call" color={C.danger} variant="outline"
            onPress={() => escalate("call_request")} disabled={busy} />
          <Btn label="Alert my therapist now" icon="alert-circle" color={C.danger}
            onPress={() => escalate("emergency_alert")} disabled={busy} />
        </View>

        <View style={{ marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: C.border }}>
          <Btn label="Call 988 Suicide & Crisis Lifeline" icon="medkit" color={C.danger}
            onPress={() => Linking.openURL("tel:988")} />
          <Text style={[type.meta, { marginTop: 8, textAlign: "center" }]}>
            Companio isn't monitored 24/7. In immediate danger, call 911.
          </Text>
        </View>
      </Card>
    );
  }

  if (phase === "sent") {
    return (
      <Card accent={C.success}>
        <Text style={type.title}>Sent to your therapist</Text>
        <Text style={[type.sub, { marginTop: 6 }]}>They'll see this the next time they check in. If you're in immediate danger, call 911 or the 988 Suicide & Crisis Lifeline now.</Text>
      </Card>
    );
  }

  return null;
}
