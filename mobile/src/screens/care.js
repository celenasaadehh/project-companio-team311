// Appointments, medication and care plan.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, EmptyState, Disclaimer, Btn } from "../components/ui";
import { useApp } from "../state/AppContext";

function useMe() { const { currentPatientId, patient } = useApp(); return patient(currentPatientId); }
function useTherapistName() { const { authUser } = useApp(); return authUser?.therapistName || "your therapist"; }

function MedicationRow({ med, index, onToggle }) {
  const today = new Date().toDateString();
  const takenToday = (med.takenDates || []).includes(today);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onToggle(index)}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Ionicons name={takenToday ? "checkmark-circle" : "ellipse-outline"} size={26} color={takenToday ? C.success : C.textMuted} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[type.title, { textDecorationLine: takenToday ? "line-through" : "none", color: takenToday ? C.textMuted : C.textPrimary }]}>{med.name}</Text>
        <Text style={[type.sub, { marginTop: 2 }]}>{[med.dose, med.frequency].filter(Boolean).join(" · ") || "As directed"}</Text>
      </View>
      <Pill text={takenToday ? "Taken today" : "Not yet"} fg={takenToday ? C.success : C.warning} bg={takenToday ? C.successSoft : C.warningSoft} />
    </TouchableOpacity>
  );
}

export function PatientCare({ navigation }) {
  const { events, currentPatientId, toggleMedicationTaken } = useApp();
  const p = useMe();
  const therapistName = useTherapistName();
  const appts = events.filter((e) => e.patientId === currentPatientId);
  const nextAppt = appts[0] || null;
  const meds = p?.medications || [];
  const today = new Date().toDateString();
  const takenCount = meds.filter((m) => (m.takenDates || []).includes(today)).length;
  const dueMed = meds.find((m) => !(m.takenDates || []).includes(today)) || null;

  return (
    <Screen>
      <AppHeader eyebrow="MY CARE" title="Care"
        subtitle="Everything related to your treatment." />

      <Card accent={C.primary}>
        <Row icon="medkit" iconFg={C.primary} iconBg={C.primarySoft}
          title={therapistName} subtitle="Your therapist" />
        {nextAppt ? (
          <Text style={[type.sub, { marginTop: 10 }]}>
            {`Next session · ${nextAppt.date} at ${nextAppt.time}`}
          </Text>
        ) : (
          <Text style={[type.sub, { marginTop: 10 }]}>No session scheduled yet.</Text>
        )}
        <View style={{ flexDirection: "row", marginTop: spacing.md }}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Btn label="Message" icon="chatbubble"
              onPress={() => navigation.navigate("Conversation", { patientId: currentPatientId, viewerRole: "patient" })} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn label="Request call" icon="call" variant="outline"
              onPress={() => navigation.navigate("RequestSupport")} />
          </View>
        </View>
      </Card>

      <SectionTitle sub={appts.length ? undefined : "Nothing scheduled yet."}>Appointments</SectionTitle>
      {nextAppt ? (
        <Card>
          <Row icon="calendar" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
            title={`${nextAppt.date} · ${nextAppt.time}`}
            subtitle={`${nextAppt.type}${nextAppt.mode ? ` · ${nextAppt.mode}` : ""} · ${therapistName}`}
            right={<Pill text="Scheduled" fg={C.success} bg={C.successSoft} />} />
        </Card>
      ) : (
        <Card><EmptyState icon="calendar" title="No appointments scheduled" /></Card>
      )}
      {appts.length > 1 ? (
        <Card onPress={() => navigation.navigate("Appointments")}>
          <Row icon="list" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
            title={`View all ${appts.length} appointments`}
            right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
        </Card>
      ) : null}

      <SectionTitle sub={meds.length ? `${takenCount} of ${meds.length} taken today` : "Your therapist hasn't assigned any yet."}>
        Medication
      </SectionTitle>
      {meds.length === 0 ? (
        <Card><EmptyState icon="medkit" title="No medications assigned" /></Card>
      ) : (
        <Card>
          {meds.map((m, i) => (
            <MedicationRow key={`${m.name}-${i}`} med={m} index={i}
              onToggle={(idx) => toggleMedicationTaken(currentPatientId, idx)} />
          ))}
        </Card>
      )}
      <Card onPress={() => navigation.navigate("Reminders")}>
        <Row icon="alarm" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
          title="Reminders" subtitle="Medication and session reminders"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <SectionTitle sub="Set by your therapist. You can read these any time.">My care plan</SectionTitle>
      <Card onPress={() => navigation.navigate("GroundingLibrary")}>
        <Row icon="leaf" iconFg={C.success} iconBg={C.successSoft}
          title="Grounding techniques" subtitle="The ones chosen for you, plus general ones"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      <Card onPress={() => navigation.navigate("MonitoringPrivacy")}>
        <Row icon="options" iconFg={C.primary} iconBg={C.primarySoft}
          title="My support preferences" subtitle="How and when Companio helps"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      <Card onPress={() => navigation.navigate("Profile")}>
        <Row icon="people" iconFg={C.warning} iconBg={C.warningSoft}
          title="Emergency & caregiver contacts" subtitle="Who Companio can reach for you"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <Text style={[type.meta, { marginTop: 10, textAlign: "center" }]}>
        For a medical emergency, call 911 or the 988 Suicide &amp; Crisis Lifeline — not this app.
      </Text>
      <Disclaimer />
    </Screen>
  );
}

export function Appointments({ navigation }) {
  const { events, currentPatientId } = useApp();
  const therapistName = useTherapistName();
  const mine = events.filter((e) => e.patientId === currentPatientId);

  const parsed = mine.map((e) => {
    const t = Date.parse(`${e.date} ${e.time || ""}`);
    return { ...e, _t: Number.isFinite(t) ? t : null };
  });
  const now = Date.now();
  const upcoming = parsed.filter((e) => e._t == null || e._t >= now)
    .sort((a, b) => (a._t ?? Infinity) - (b._t ?? Infinity));
  const past = parsed.filter((e) => e._t != null && e._t < now)
    .sort((a, b) => b._t - a._t);

  const Item = ({ e, dim }) => (
    <Card key={e.id} style={dim ? { opacity: 0.72 } : undefined}>
      <Row icon="calendar" iconFg={dim ? C.textMuted : C.accentBlue}
        iconBg={dim ? C.surfaceStrong : C.accentBlueSoft}
        title={`${e.date} · ${e.time}`}
        subtitle={`${e.type}${e.mode ? ` · ${e.mode}` : ""} · ${therapistName}`}
        right={dim ? <Pill text="Past" fg={C.textSecondary} bg={C.surfaceStrong} />
                   : <Pill text="Scheduled" fg={C.success} bg={C.successSoft} />} />
    </Card>
  );

  return (
    <Screen>
      <AppHeader eyebrow="MY CARE" title="Appointments"
        subtitle={`${mine.length} in total`} onBack={() => navigation.goBack()} />

      <SectionTitle>Upcoming</SectionTitle>
      {upcoming.length === 0
        ? <Card><EmptyState icon="calendar" title="Nothing scheduled" sub="Ask your therapist to book a session." /></Card>
        : upcoming.map((e) => <Item key={e.id} e={e} />)}

      <Card onPress={() => navigation.navigate("RequestSupport")}>
        <Row icon="add-circle" iconFg={C.primary} iconBg={C.primarySoft}
          title="Request an appointment" subtitle="Your therapist will see the request"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      {past.length ? (
        <>
          <SectionTitle>Past</SectionTitle>
          {past.map((e) => <Item key={e.id} e={e} dim />)}
        </>
      ) : null}
      <Disclaimer />
    </Screen>
  );
}
