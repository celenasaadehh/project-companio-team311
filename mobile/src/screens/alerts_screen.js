// The therapist's action queue.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, RefreshControl, Alert as RNAlert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Btn, Disclaimer } from "../components/ui";
import { Avatar } from "./therapist";
import { getSessions, getDecisions } from "../services/engine";
import { acknowledgeRequest } from "../services/alerts";
import { useApp } from "../state/AppContext";

const FILTERS = ["Active", "Acknowledged", "All"];

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
};

export function Alerts({ navigation }) {
  const { patients, authUser } = useApp();
  const me = authUser?.name || authUser?.username || "Therapist";
  const [filter, setFilter] = useState("Active");
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const lists = await Promise.all(patients.map(async (p) => {
      const [s, d] = await Promise.all([
        getSessions(p.id).catch(() => null),
        getDecisions(p.id).catch(() => null),
      ]);
      const sessions = s?.sessions || [];
      const acked = new Set(sessions
        .filter((x) => x.type === "acknowledgement" && x.session_id)
        .map((x) => x.session_id));

      const out = [];

      for (const r of sessions) {
        if (r.type !== "emergency_alert" && r.type !== "call_request") continue;
        out.push({
          id: r.session_id, patient: p, at: r.created_at,
          priority: r.type === "emergency_alert" ? "high" : "normal",
          kind: r.type === "emergency_alert" ? "Marked as an emergency" : "Requested therapist contact",
          detail: r.message || "",
          acknowledged: r.ack_state === "acknowledged" || acked.has(r.session_id),
          actionable: true,
        });
      }

      for (const dec of (d?.decisions || [])) {
        const needsReview = dec.escalation_required || dec.patient_reported_helped === false;
        if (!needsReview) continue;
        out.push({
          id: dec.decision_id, patient: p, at: dec.timestamp,
          priority: dec.escalation_required ? "high" : "normal",
          kind: dec.escalation_required ? "Support escalated" : "Support did not help",
          detail: [dec.selected_action, dec.decision_source].filter(Boolean).join(" · "),
          acknowledged: false,
          episodeId: dec.episode_id || null,
          actionable: false,
        });
      }
      return out;
    }));

    setRows(lists.flat().sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)));
    setRefreshing(false);
  }, [patients]);

  useEffect(() => { load(); }, [load]);

  const shown = (rows || []).filter((r) =>
    filter === "All" ? true : filter === "Active" ? !r.acknowledged : r.acknowledged);

  const ack = async (row) => {
    setBusy(row.id);
    try {
      await acknowledgeRequest(row.patient.id, row.id, me);
      setRows((prev) => prev.map((x) => x.id === row.id ? { ...x, acknowledged: true } : x));
    } catch (e) {
      RNAlert.alert("Could not acknowledge",
        `${String(e?.message || e)}\n\nThe patient has NOT been told yet.`);
    } finally { setBusy(null); }
  };

  return (
    <Screen refreshControl={
      <RefreshControl refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.primary} />
    }>
      <AppHeader eyebrow="ACTION QUEUE" title="Alerts"
        subtitle="Items that may need you. Information-only updates are in Notifications." />

      <View style={{ flexDirection: "row", marginBottom: spacing.sm }}>
        {FILTERS.map((f) => (
          <Card key={f} style={{ marginTop: 0, marginRight: 8, paddingVertical: 8, paddingHorizontal: 15,
                                 backgroundColor: filter === f ? C.primary : undefined }}
            onPress={() => setFilter(f)}>
            <Text style={{ fontWeight: "700", fontSize: 13.5,
                           color: filter === f ? "#fff" : C.textSecondary }}>{f}</Text>
          </Card>
        ))}
      </View>

      {rows === null ? <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} /> : null}

      {rows !== null && shown.length === 0 ? (
        <Card>
          <EmptyState icon="checkmark-done-circle" title={
            filter === "Active" ? "Nothing needs your attention" : "Nothing here"}
            sub={filter === "Active"
              ? "Requests from patients and episodes that need review will appear here."
              : undefined} />
        </Card>
      ) : null}

      {shown.map((r) => (
        <Card key={r.id} accent={r.priority === "high" ? C.danger : C.warning}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar name={r.patient.name} color={r.patient.avatar || C.navy} size={40}
              s3Key={r.patient.avatarS3Key} patientId={r.patient.id} />
            <View style={{ flex: 1, marginLeft: 11 }}>
              <Text style={[type.meta, { color: r.priority === "high" ? C.danger : C.warning }]}>
                {r.priority === "high" ? "HIGH PRIORITY" : "REVIEW"}
              </Text>
              <Text style={type.title}>{r.patient.name}</Text>
              <Text style={[type.sub, { marginTop: 2 }]}>{r.kind}</Text>
              {r.detail ? <Text style={[type.meta, { marginTop: 3 }]}>{r.detail}</Text> : null}
              <Text style={[type.meta, { marginTop: 4 }]}>{ago(r.at)}</Text>
            </View>
          </View>

          {r.acknowledged ? (
            <View style={{ marginTop: 10 }}>
              <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
                title="Acknowledged" subtitle="The patient can see that you've seen this." />
            </View>
          ) : (
            <View style={{ flexDirection: "row", marginTop: spacing.md }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Btn label="Open patient" icon="person"
                  onPress={() => navigation.navigate("PatientRecord", { patientId: r.patient.id })} />
              </View>
              <View style={{ flex: 1 }}>
                {r.actionable ? (
                  <Btn label={busy === r.id ? "Sending…" : "Acknowledge"} icon="checkmark"
                    variant="outline" disabled={busy === r.id} onPress={() => ack(r)} />
                ) : (
                  <Btn label="Review event" icon="pulse" variant="outline"
                    onPress={() => navigation.navigate("EventDetail", {
                      patientId: r.patient.id, episodeId: r.episodeId })} />
                )}
              </View>
            </View>
          )}
        </Card>
      ))}

      <Disclaimer />
    </Screen>
  );
}
