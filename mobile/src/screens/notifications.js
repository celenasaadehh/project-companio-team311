// The patient's notification inbox.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Disclaimer } from "../components/ui";
import { getSessions } from "../services/engine";
import { useApp } from "../state/AppContext";

const FILTERS = ["All", "Support", "Care", "Messages"];

const KIND = {
  SUPPORT: "Support",
  CARE: "Care",
  MESSAGE: "Messages",
  ALERT: "Alert",
};

function toEntry(r, therapistName) {
  const at = r.created_at || r.recorded_at;
  switch (r.type) {
    case "trigger_event":
      return {
        at, kind: KIND.SUPPORT, icon: "sparkles", tint: C.primary,
        source: "COMPANIO",
        title: r.normalized_visual_trigger ? "Support during a trigger" : "Companio checked your surroundings",
        body: r.message || (r.normalized_visual_trigger
          ? `Recognised ${r.normalized_visual_trigger}.`
          : "Nothing matched your triggers."),
        screen: "Companio",
      };
    case "voice_transcription":
      return {
        at, kind: KIND.SUPPORT, icon: "mic", tint: C.primary, source: "COMPANIO",
        title: "Voice check-in", body: r.companio_said || r.message || "You talked to Companio.",
        screen: "Companio",
      };
    case "check_in_response":
      return {
        at, kind: KIND.SUPPORT, icon: "help-buoy", tint: C.primary, source: "COMPANIO",
        title: "Check-in", body: r.message || "Companio checked in with you.",
        screen: "Companio",
      };
    case "medication_log":
      return {
        at, kind: KIND.CARE, icon: "medkit", tint: C.teal, source: "CARE",
        title: r.medication ? `${r.medication} ${r.taken ? "taken" : "not taken"}` : "Medication",
        body: r.message || "", screen: "Care",
      };
    case "message":
      if (r.sender_role === "patient") return null;
      return {
        at, kind: r.channel === "companio" ? KIND.SUPPORT : KIND.MESSAGE,
        icon: r.channel === "companio" ? "sparkles" : "chatbubbles",
        tint: r.channel === "companio" ? C.primary : C.accentBlue,
        source: r.channel === "companio" ? "COMPANIO" : (therapistName || "THERAPIST").toUpperCase(),
        title: r.channel === "companio" ? "Companio replied" : `${therapistName || "Your therapist"} replied`,
        body: r.message || "", screen: r.channel === "companio" ? "Companio" : "Conversation",
      };
    case "acknowledgement":
      return {
        at, kind: KIND.MESSAGE, icon: "checkmark-circle", tint: C.success,
        source: (r.acknowledged_by || therapistName || "THERAPIST").toUpperCase(),
        title: "Your request was seen",
        body: r.message || "", screen: "Conversation",
      };
    case "emergency_alert":
    case "call_request":
      return {
        at, kind: KIND.ALERT, icon: "alert-circle", tint: C.danger, source: "URGENT",
        title: r.type === "emergency_alert" ? "You marked this urgent" : "You asked for contact",
        body: r.ack_state === "acknowledged"
          ? "Your therapist has seen this."
          : "Waiting for your therapist to acknowledge.",
        screen: "Conversation",
      };
    default:
      return null;
  }
}

const groupOf = (iso) => {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d >= today) return "Today";
  if (d >= yest) return "Yesterday";
  return "Earlier";
};

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
};

export function Notifications({ navigation }) {
  const { currentPatientId, authUser } = useApp();
  const therapistName = authUser?.therapistName || "Your therapist";
  const [filter, setFilter] = useState("All");
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getSessions(currentPatientId);
      const entries = (r?.sessions || [])
        .map((x) => toEntry(x, therapistName))
        .filter(Boolean)
        .filter((e) => e.at)
        .sort((a, b) => new Date(b.at) - new Date(a.at));
      setRows(entries);
    } catch {
      setRows([]);
    } finally { setRefreshing(false); }
  }, [currentPatientId, therapistName]);

  useEffect(() => { load(); }, [load]);

  const shown = (rows || []).filter((e) =>
    filter === "All" ? true
      : filter === "Messages" ? e.kind === KIND.MESSAGE || e.kind === KIND.ALERT
      : e.kind === filter);

  const groups = shown.reduce((acc, e) => {
    const g = groupOf(e.at);
    (acc[g] = acc[g] || []).push(e);
    return acc;
  }, {});

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />
    }>
      <AppHeader title="Notifications" subtitle="Everything Companio and your therapist have sent."
        onBack={() => navigation.goBack()} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.sm }}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)} activeOpacity={0.8}
            style={{ paddingVertical: 8, paddingHorizontal: 15, borderRadius: radius.pill,
                     marginRight: 8, marginBottom: 8,
                     backgroundColor: filter === f ? C.primary : C.surfaceStrong }}>
            <Text style={{ fontWeight: "700", fontSize: 13.5,
                           color: filter === f ? "#fff" : C.textSecondary }}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {rows === null ? null : shown.length === 0 ? (
        <Card>
          <EmptyState icon="notifications-off" title="Nothing here yet"
            sub={filter === "All"
              ? "When Companio checks in, your therapist writes, or a reminder is due, it appears here."
              : `No ${filter.toLowerCase()} notifications yet.`} />
        </Card>
      ) : ["Today", "Yesterday", "Earlier"].map((g) => (
        groups[g]?.length ? (
          <View key={g}>
            <SectionTitle>{g}</SectionTitle>
            {groups[g].map((e, i) => (
              <Card key={`${g}-${i}`} accent={e.kind === KIND.ALERT ? C.danger : undefined}
                onPress={() => {
                  try {
                    const TABS = ["Home", "Companio", "Care", "Progress", "Profile"];
                    if (TABS.includes(e.screen)) navigation.navigate("PatientTabs", { screen: e.screen });
                    else navigation.navigate(e.screen, e.params || {});
                  } catch {}
                }}>
                <View style={{ flexDirection: "row" }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19,
                                 backgroundColor: C.surfaceStrong, alignItems: "center",
                                 justifyContent: "center", marginRight: 11 }}>
                    <Ionicons name={e.icon} size={18} color={e.tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.meta, { color: e.tint }]}>{e.source}</Text>
                    <Text style={[type.title, { fontSize: 15, marginTop: 1 }]}>{e.title}</Text>
                    {e.body ? (
                      <Text style={[type.sub, { marginTop: 3 }]} numberOfLines={2}>{e.body}</Text>
                    ) : null}
                    <Text style={[type.meta, { marginTop: 5 }]}>{ago(e.at)}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : null
      ))}

      <Disclaimer />
    </Screen>
  );
}
