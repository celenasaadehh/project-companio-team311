// "I'm steady now" — the patient closes an episode, and says what helped.
import React, { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Card, Row, Btn } from "./ui";
import { getEpisode, closeEpisode, offeredActions } from "../services/episode";
import { saveSession, saveDecision } from "../services/engine";
import { reportSyncFailure } from "../services/errors";

export const RECOVERY = {
  SETTLED: "recovered",
  STILL_SHAKEN: "still_shaken",
  NEEDS_PERSON: "escalated",
};

// Physiology alone cannot tell recovery from distraction: a heart rate returns
// to baseline whether someone actually settled or simply stopped moving. Only
// the patient knows which, so the episode stays open until they say. It also
// gives the bandit the one label it cannot infer -- whether the thing Companio
// offered is what actually helped.
export function StabilityCheck({ patientId, onClosed }) {
  const ep = getEpisode();
  const [phase, setPhase] = useState("ask");
  const [busy, setBusy] = useState(false);

  if (!ep) return null;

  const tried = offeredActions();

  async function close(outcome, helpedAction) {
    if (busy) return;
    setBusy(true);
    const closed = closeEpisode(outcome);
    try {
      await saveSession({
        patient_id: patientId,
        session_id: `ep_close_${closed?.episode_id || Date.now()}`,
        episode_id: closed?.episode_id || null,
        kind: "episode_close",
        outcome,
        actions_offered: tried,
        action_that_helped: helpedAction || null,
        episode_started_at: closed?.started_at || null,
        closed_at: closed?.closed_at || null,
        opened_by: closed?.opened_by || null,
      });
      // The bandit learns from decision outcomes, not from sessions, so the
      // reward has to be written where it will actually read it.
      if (helpedAction) {
        await saveDecision({
          patient_id: patientId,
          episode_id: closed?.episode_id || null,
          selected_action: helpedAction,
          outcome: "helped",
          source: "patient_confirmed_recovery",
        });
      }
    } catch (e) {
      reportSyncFailure("episode_close", e);
    } finally {
      setBusy(false);
      onClosed?.(outcome);
    }
  }

  if (phase === "ask") {
    return (
      <Card accent={C.primary}>
        <Row icon="pulse" iconFg={C.primary} iconBg={C.primarySoft}
          title="Companio is still watching this moment"
          subtitle="It stays open until you tell it you're through it — your body settling isn't proof on its own." />
        <View style={{ flexDirection: "row", marginTop: spacing.sm }}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Btn label="I'm steady now" icon="checkmark-circle" disabled={busy}
              onPress={() => {
                // Nothing was offered, so there is nothing to credit.
                if (!tried.length) return close(RECOVERY.SETTLED);
                return setPhase("what");
              }} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn label="Still shaken" icon="alert-circle" variant="outline"
              onPress={() => close(RECOVERY.STILL_SHAKEN)} />
          </View>
        </View>
      </Card>
    );
  }

  if (phase === "what") {
    return (
      <Card accent={C.success}>
        <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
          title="Good. What actually helped?"
          subtitle="This is the only way Companio learns what works for you specifically." />
        <View style={{ marginTop: spacing.sm }}>
          {tried.map((t) => (
            <TouchableOpacity key={t} activeOpacity={0.78} disabled={busy}
              onPress={() => close(RECOVERY.SETTLED, t)}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12,
                       paddingHorizontal: 14, borderRadius: radius.md, marginBottom: 8,
                       backgroundColor: C.surfaceStrong }}>
              <Ionicons name="leaf" size={16} color={C.success} />
              <Text style={{ marginLeft: 9, flex: 1, fontWeight: "600", fontSize: 14,
                             color: C.textPrimary }}>{t}</Text>
            </TouchableOpacity>
          ))}
          <Btn label="None of them — it passed on its own" variant="outline"
            disabled={busy} onPress={() => close(RECOVERY.SETTLED)} />
        </View>
        <Text style={[type.meta, { marginTop: 8 }]}>
          Your therapist sees this, and Companio offers what helps you more often.
        </Text>
      </Card>
    );
  }

  return null;
}
