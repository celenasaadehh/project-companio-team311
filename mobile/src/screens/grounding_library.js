// Grounding techniques, split by what the therapist chose.
import React, { useState, useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, Disclaimer } from "../components/ui";
import { GROUNDING_TECHNIQUES, matchTechnique } from "../data/grounding";
import { useApp } from "../state/AppContext";

const GENERAL_SAFE = [
  "sensory_54321", "orient_room", "feet_floor",
  "five_things_colour", "categories", "counting_backwards", "hold_object",
];

function TechniqueCard({ t, chosen, onPress }) {
  return (
    <Card onPress={onPress} accent={chosen ? C.primary : undefined}>
      <Row
        icon={t.icon}
        iconFg={chosen ? C.primary : C.textSecondary}
        iconBg={chosen ? C.primarySoft : C.surfaceStrong}
        title={t.name}
        subtitle={t.blurb}
        right={
          <View style={{ alignItems: "flex-end" }}>
            <Text style={type.meta}>{t.duration}</Text>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={{ marginTop: 4 }} />
          </View>
        }
      />
      {t.caution ? (
        <View style={{ flexDirection: "row", marginTop: 8, alignItems: "flex-start" }}>
          <Ionicons name="information-circle" size={15} color={C.warning} style={{ marginTop: 1 }} />
          <Text style={[type.meta, { flex: 1, marginLeft: 6 }]}>{t.caution}</Text>
        </View>
      ) : null}
    </Card>
  );
}

export function GroundingLibrary({ navigation }) {
  const { currentPatientId, patient } = useApp();
  const p = patient ? patient(currentPatientId) : null;

  const plan = p?.treatmentPlan || {};
  const approved = (plan.approvedInterventions || []).map((a) => String(a).toLowerCase());
  const forbidden = (plan.forbiddenInterventions || []).map((a) => String(a).toLowerCase());

  const { chosen, general } = useMemo(() => {
    const isForbidden = (t) =>
      forbidden.some((f) => f.includes(t.id) || t.name.toLowerCase().includes(f) || f.includes(t.name.toLowerCase()));

    const allowed = GROUNDING_TECHNIQUES.filter((t) => !isForbidden(t));

    const isChosen = (t) =>
      approved.some((a) => {
        const m = matchTechnique(a);
        return (m && m.id === t.id) || a.includes(t.id) || t.name.toLowerCase().includes(a);
      });

    return {
      chosen: allowed.filter(isChosen),
      general: allowed.filter((t) => !isChosen(t) && GENERAL_SAFE.includes(t.id)),
    };
  }, [approved.join("|"), forbidden.join("|")]);

  const open = (t) => navigation.navigate("Support", { techniqueId: t.id });

  return (
    <Screen>
      <AppHeader eyebrow="GROUNDING" title="Ways to steady yourself"
        subtitle="Different things work on different days. Try any of them."
        onBack={() => navigation.goBack()} />

      {chosen.length ? (
        <>
          <SectionTitle sub="Your therapist picked these for you specifically.">
            Chosen for you
          </SectionTitle>
          {chosen.map((t) => <TechniqueCard key={t.id} t={t} chosen onPress={() => open(t)} />)}
        </>
      ) : (
        <Card>
          <Row icon="person" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
            title="Nothing chosen for you yet"
            subtitle="When your therapist adds techniques to your plan, they appear here first." />
        </Card>
      )}

      <SectionTitle sub="General techniques anyone can use. Not chosen for you personally.">
        Everyone can try
      </SectionTitle>
      {general.map((t) => <TechniqueCard key={t.id} t={t} onPress={() => open(t)} />)}

      <Disclaimer text="If something makes you feel worse, stop — and tell your therapist. That is useful information, not a failure." />
    </Screen>
  );
}
