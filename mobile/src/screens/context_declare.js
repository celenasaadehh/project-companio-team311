// Patient declares context so expected changes are not read as distress.
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, Disclaimer } from "../components/ui";
import { saveSession } from "../services/engine";
import { useApp } from "../state/AppContext";

export const CONTEXT_OPTIONS = [
  { id: "exercise",    label: "Going for a run or workout", icon: "walk",        hours: 3,
    note: "Your body stays revved up for hours afterwards." },
  { id: "caffeine",    label: "Had coffee or an energy drink", icon: "cafe",     hours: 5,
    note: "Caffeine keeps your body activated." },
  { id: "horror",      label: "Watching something intense",  icon: "film",       hours: 3,
    note: "Your body reacts, but you are not in danger." },
  { id: "exam",        label: "Exam, interview or deadline", icon: "school",     hours: 6,
    note: "Ordinary stress, not a trauma response." },
  { id: "travel",      label: "Travelling or flying",        icon: "airplane",   hours: 8 },
  { id: "illness",     label: "Feeling unwell",              icon: "thermometer",hours: 12,
    note: "Being unwell changes your physical signs." },
  { id: "poor_sleep",  label: "Barely slept",                icon: "moon",       hours: 16 },
  { id: "crowd",       label: "Going somewhere busy",        icon: "people",     hours: 4,
    note: "Companio keeps watching — this is a common trigger." },
];

export function DeclareContext({ navigation }) {
  const { currentPatientId, setPref, prefs } = useApp();
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = (id) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  async function save() {
    if (!selected.length && !note.trim()) return;
    setBusy(true);
    const chosen = CONTEXT_OPTIONS.filter((o) => selected.includes(o.id));
    const hours = Math.max(3, ...chosen.map((o) => o.hours || 3));
    const entry = {
      ids: selected,
      labels: chosen.map((o) => o.label),
      note: note.trim() || null,
      declared_at: Date.now(),
      expires_at: Date.now() + hours * 60 * 60 * 1000,
    };

    setPref("declaredContext", entry);

    try {
      await saveSession({
        patient_id: currentPatientId,
        type: "declared_context",
        context_ids: selected,
        context_labels: entry.labels,
        note: entry.note,
        expires_at: new Date(entry.expires_at).toISOString(),
        message: `Patient said: ${entry.labels.join(", ")}${entry.note ? ` — ${entry.note}` : ""}`,
      });
    } catch {
    }
    setBusy(false);
    setSaved(true);
  }

  const active = prefs?.declaredContext;
  const stillActive = active && active.expires_at > Date.now();

  return (
    <Screen>
      <AppHeader eyebrow="CONTEXT" title="Heads up, I'm about to…"
        subtitle="Tell Companio what's going on so it doesn't mistake it for distress."
        onBack={() => navigation.goBack()} />

      {stillActive ? (
        <Card accent={C.success}>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
            title="Companio knows about this"
            subtitle={active.labels?.join(", ")} />
          <Text style={[type.meta, { marginTop: 8 }]}>
            {`Applies for another ${Math.max(1, Math.round((active.expires_at - Date.now()) / 3600000))} hour(s).`}
          </Text>
          <Btn label="Clear it" icon="close" variant="outline"
            onPress={() => { setPref("declaredContext", null); setSaved(false); setSelected([]); }} />
        </Card>
      ) : null}

      <SectionTitle sub="Pick anything that applies. Companio keeps watching either way.">
        What's happening?
      </SectionTitle>
      {CONTEXT_OPTIONS.map((o) => {
        const on = selected.includes(o.id);
        return (
          <Card key={o.id} accent={on ? C.primary : undefined} onPress={() => toggle(o.id)}>
            <Row icon={on ? "checkmark-circle" : o.icon}
              iconFg={on ? C.primary : C.textSecondary}
              iconBg={on ? C.primarySoft : C.surfaceStrong}
              title={o.label} subtitle={o.note}
              right={<Text style={type.meta}>{`${o.hours}h`}</Text>} />
          </Card>
        );
      })}

      <SectionTitle sub="Optional — anything else worth knowing.">In your own words</SectionTitle>
      <Card>
        <TextInput value={note} onChangeText={setNote} multiline
          placeholder="e.g. going to my brother's wedding, lots of people"
          placeholderTextColor={C.textMuted}
          style={{ minHeight: 72, color: C.textPrimary, fontSize: 15, textAlignVertical: "top" }} />
      </Card>

      <Btn label={busy ? "Saving…" : saved ? "Saved" : "Tell Companio"} icon="checkmark"
        disabled={busy || (!selected.length && !note.trim())} onPress={save} />

      <Card>
        <Row icon="shield-checkmark" iconFg={C.success} iconBg={C.successSoft}
          title="Monitoring stays on"
          subtitle="This doesn't switch anything off. Companio still watches — it just won't treat an expected rise as distress, and your therapist sees the reason." />
      </Card>

      <Disclaimer />
    </Screen>
  );
}
