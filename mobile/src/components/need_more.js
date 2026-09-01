// "That isn't enough" — one tap, or spoken, without composing a sentence.
import React, { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Card, Row, Btn } from "./ui";
import { decideMoment } from "../services/decide";
import { recordOfferedAction } from "../services/episode";
import { saveDecision } from "../services/engine";
import { reportSyncFailure } from "../services/errors";

// Asking someone mid-episode to type how they feel is asking for the one thing
// they cannot currently do. These are the three things people actually say,
// as buttons, so a worsening moment costs one tap instead of a sentence.
export const RESPONSES = [
  { id: "not_enough", label: "This isn't enough", icon: "remove-circle",
    transcript: "that helped a little but it is not enough" },
  { id: "need_more", label: "I need more help", icon: "hand-left",
    transcript: "I need more help than this" },
  { id: "feel_worse", label: "I don't feel good", icon: "sad",
    transcript: "I do not feel good at all right now" },
];

export function NeedMore({ patientId, riskLevel, riskScore, offeredAction,
                           onNewAction, onEscalate, onSpeak }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function respond(r) {
    if (busy) return;
    setBusy(r.id);
    setError(null);
    try {
      // The thing that just failed is recorded before asking again, so the
      // engine cannot offer it back.
      if (offeredAction) recordOfferedAction(offeredAction);

      const out = await decideMoment({
        patient_id: patientId,
        risk_level: riskLevel || "elevated",
        risk_score: riskScore ?? 0,
        transcript: r.transcript,
        patient_reported_helped: false,
        observed_triggers: [],
      });

      saveDecision({
        patient_id: patientId,
        selected_action: offeredAction || null,
        outcome: "did_not_help",
        patient_reported_helped: false,
        patient_response: r.id,
      }).catch((e) => reportSyncFailure("need_more_outcome", e));

      if (out?.escalation_required) return onEscalate?.(out);
      onNewAction?.(out);
    } catch (e) {
      setError("Companio couldn't reach the engine. Your therapist can still be called from Care.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <Row icon="help-circle" iconFg={C.warning} iconBg={C.warningSoft}
        title="Not working?"
        subtitle="Tell Companio and it will try something else your therapist approved." />

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.sm }}>
        {RESPONSES.map((r) => (
          <TouchableOpacity key={r.id} activeOpacity={0.8} disabled={!!busy}
            onPress={() => respond(r)}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11,
                     paddingHorizontal: 14, borderRadius: radius.pill, marginRight: 7,
                     marginBottom: 7, backgroundColor: C.surfaceStrong,
                     opacity: busy && busy !== r.id ? 0.5 : 1 }}>
            {busy === r.id
              ? <ActivityIndicator size="small" color={C.warning} />
              : <Ionicons name={r.icon} size={15} color={C.warning} />}
            <Text style={{ marginLeft: 7, fontWeight: "700", fontSize: 13.5,
                           color: C.textPrimary }}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flexDirection: "row", marginTop: 4 }}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Btn label="Try something else" icon="shuffle" variant="outline"
            disabled={!!busy}
            onPress={() => respond({ id: "try_another",
              transcript: "please suggest something different" })} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="Say it out loud" icon="mic" variant="outline"
            disabled={!!busy} onPress={onSpeak} />
        </View>
      </View>

      {error ? (
        <Text style={[type.sub, { color: C.danger, marginTop: 8 }]}>{error}</Text>
      ) : null}
    </Card>
  );
}
