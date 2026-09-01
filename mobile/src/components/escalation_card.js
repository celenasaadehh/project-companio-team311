// The contact ladder shown when every approved intervention has been tried.
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Card, Row, Btn } from "./ui";
import { escalationContacts, openContact, CONTACT_KIND } from "../services/escalation";
import { raiseEmergencyAlert } from "../services/alerts";
import { reportSyncFailure } from "../services/errors";

export function EscalationCard({ profile, patientId, therapistName, onMessaged }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const contacts = escalationContacts({ ...profile, therapist_name: therapistName });

  async function messageTherapist() {
    if (busy) return;
    setBusy(true);
    try {
      await raiseEmergencyAlert(patientId,
        "Every approved intervention was tried during this episode and none of them helped.");
      setSent(true);
      onMessaged?.();
    } catch (e) {
      reportSyncFailure("escalation_message", e);
      // A failed send must never look like a successful one: someone waiting
      // for a reply that was never sent is the worst outcome here.
      Alert.alert("That message did not send",
        "Companio could not reach the server. Please call instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card accent={C.danger}>
      <Row icon="hand-left" iconFg={C.danger} iconBg={C.dangerSoft}
        title="We've tried everything your therapist approved"
        subtitle="None of it helped tonight. Companio isn't going to invent something new — this is the point where a person should be involved." />

      {contacts.length === 0 ? (
        <View style={{ marginTop: spacing.sm, padding: 12, borderRadius: radius.md,
                       backgroundColor: C.dangerSoft }}>
          <Text style={[type.title, { fontSize: 14, color: C.danger }]}>
            No contacts have been set up yet
          </Text>
          <Text style={[type.sub, { marginTop: 4 }]}>
            Your therapist hasn't added an emergency contact or a crisis line to your plan.
            If you are in danger right now, call your local emergency number.
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {contacts.map((c, i) => {
            const isMessage = c.kind === CONTACT_KIND.THERAPIST && !c.href;
            const done = isMessage && sent;
            return (
              <TouchableOpacity key={`${c.kind}_${i}`} activeOpacity={0.8}
                disabled={busy || done}
                onPress={() => (isMessage ? messageTherapist() : openContact(c).then((ok) => {
                  if (!ok) Alert.alert("Couldn't open that",
                    "This device can't place that call. The number is in your care plan.");
                }))}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13,
                         paddingHorizontal: 14, borderRadius: radius.md, marginBottom: 8,
                         backgroundColor: done ? C.successSoft : C.surfaceStrong }}>
                <Ionicons name={done ? "checkmark-circle" : c.icon} size={19}
                  color={done ? C.success : C.danger} />
                <View style={{ flex: 1, marginLeft: 11 }}>
                  <Text style={{ fontWeight: "700", fontSize: 14.5, color: C.textPrimary }}>
                    {c.label}
                  </Text>
                  <Text style={[type.sub, { marginTop: 1 }]}>
                    {done ? "Message sent — they've been told this is urgent" : c.detail}
                  </Text>
                </View>
                {!done ? (
                  <Text style={{ fontWeight: "700", fontSize: 13, color: C.danger }}>
                    {c.action}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={[type.meta, { marginTop: 6 }]}>
        Companio is not a crisis service and nobody is watching this in real time.
        If you are in immediate danger, call your local emergency number.
      </Text>
    </Card>
  );
}
