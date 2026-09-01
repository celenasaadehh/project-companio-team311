// Medication and appointment reminders.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, EmptyState, Disclaimer } from "../components/ui";
import {
  isNotifyAvailable, requestNotifyPermission, scheduleDaily, scheduleAt,
  listScheduled, cancelScheduled, cancelAllScheduled, notifyNow,
} from "../services/notify";
import { useApp } from "../state/AppContext";

function useMe() { const { currentPatientId, patient } = useApp(); return patient(currentPatientId); }

export function Reminders({ navigation }) {
  const p = useMe();
  const { events, currentPatientId } = useApp();
  const meds = p?.medications || [];
  const appts = events.filter((e) => e.patientId === currentPatientId);

  const [granted, setGranted] = useState(null);
  const [scheduled, setScheduled] = useState([]);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(null);
  const [note, setNote] = useState(null);

  const refresh = useCallback(async () => {
    setScheduled(await listScheduled());
  }, []);

  useEffect(() => {
    (async () => {
      const perm = await requestNotifyPermission();
      setGranted(perm.ok);
      if (perm.ok) refresh();
    })();
  }, [refresh]);

  async function addMedReminder(med, date) {
    setBusy(true);
    const id = await scheduleDaily(
      "Time for your medication",
      `${med.name}${med.dose ? ` · ${med.dose}` : ""}`,
      date.getHours(), date.getMinutes(),
    );
    setNote(id ? `Daily reminder set for ${med.name}.` : "Could not schedule that reminder.");
    await refresh();
    setBusy(false);
  }

  async function addApptReminders() {
    setBusy(true);
    let n = 0;
    for (const e of appts) {
      const when = new Date(`${e.date} ${e.time || "09:00"}`);
      if (isNaN(when)) continue;
      const hourBefore = new Date(when.getTime() - 60 * 60 * 1000);
      const id = await scheduleAt("Session in 1 hour", `${e.type || "Session"} with your therapist`, hourBefore);
      if (id) n += 1;
    }
    setNote(n ? `${n} appointment reminder${n === 1 ? "" : "s"} set.` : "No upcoming appointments with a valid date to remind you about.");
    await refresh();
    setBusy(false);
  }

  async function remove(id) {
    await cancelScheduled(id);
    await refresh();
  }

  async function removeAll() {
    await cancelAllScheduled();
    await refresh();
    setNote("All reminders cleared.");
  }

  if (!isNotifyAvailable) {
    return (
      <Screen>
        <AppHeader eyebrow="REMINDERS" title="Reminders" onBack={() => navigation.goBack()} />
        <Card accent={C.warning}>
          <Row icon="notifications-off" iconFg={C.warning} iconBg={C.warningSoft}
            title="Notifications unavailable" subtitle="This build doesn't include the notifications module." />
        </Card>
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader eyebrow="REMINDERS" title="Reminders"
        subtitle="Medication and session reminders, scheduled on this device."
        onBack={() => navigation.goBack()} />

      {granted === false ? (
        <Card accent={C.danger}>
          <Row icon="notifications-off" iconFg={C.danger} iconBg={C.dangerSoft}
            title="Notifications are off"
            subtitle="Turn them on in Settings → Notifications → Companio, then come back." />
        </Card>
      ) : null}

      {note ? (
        <Card accent={C.success}>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft} title={note} />
        </Card>
      ) : null}

      <SectionTitle sub={meds.length ? "Tap a medication to pick a daily time." : "Your therapist hasn't assigned any yet."}>
        Medication reminders
      </SectionTitle>
      {meds.length === 0 ? (
        <Card><EmptyState icon="medkit" title="No medications assigned" /></Card>
      ) : (
        <Card>
          {meds.map((m, i) => (
            <Row key={`${m.name}-${i}`} icon="alarm" iconFg={C.primary} iconBg={C.primarySoft}
              title={m.name} subtitle={[m.dose, m.frequency].filter(Boolean).join(" · ") || "As directed"}
              right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
              onPress={() => setPicker({ medIndex: i, date: new Date() })} />
          ))}
        </Card>
      )}

      {picker ? (
        <Card accent={C.primary}>
          <Text style={type.title}>What time each day?</Text>
          <DateTimePicker
            value={picker.date}
            mode="time"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(_, d) => d && setPicker((s) => ({ ...s, date: d }))}
          />
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Btn label="Set reminder" icon="alarm" disabled={busy}
                onPress={() => { addMedReminder(meds[picker.medIndex], picker.date); setPicker(null); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn label="Cancel" variant="outline" color={C.textSecondary} onPress={() => setPicker(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      <SectionTitle sub={appts.length ? "One hour before each scheduled session." : "Nothing scheduled yet."}>
        Session reminders
      </SectionTitle>
      <Card>
        {appts.length === 0
          ? <EmptyState icon="calendar" title="No appointments" />
          : <Btn label="Remind me before each session" icon="calendar" onPress={addApptReminders} disabled={busy} />}
      </Card>

      <SectionTitle sub="Read back from iOS — this is genuinely what's scheduled.">
        Scheduled ({scheduled.length})
      </SectionTitle>
      {scheduled.length === 0 ? (
        <Card><EmptyState icon="notifications-outline" title="Nothing scheduled yet" sub="Reminders you set will appear here." /></Card>
      ) : (
        <>
          <Card>
            {scheduled.map((s) => {
              const t = s.trigger || {};
              const when = t.hour != null
                ? `Every day at ${String(t.hour).padStart(2, "0")}:${String(t.minute ?? 0).padStart(2, "0")}`
                : t.value ? new Date(t.value).toLocaleString()
                : t.dateComponents ? `Every day at ${String(t.dateComponents.hour ?? 0).padStart(2, "0")}:${String(t.dateComponents.minute ?? 0).padStart(2, "0")}`
                : "Scheduled";
              return (
                <Row key={s.identifier} icon="alarm" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
                  title={s.content?.title || "Reminder"}
                  subtitle={`${s.content?.body || ""}${s.content?.body ? " · " : ""}${when}`}
                  right={<Ionicons name="close-circle" size={22} color={C.danger} />}
                  onPress={() => remove(s.identifier)} />
              );
            })}
          </Card>
          <Btn label="Clear all reminders" variant="outline" color={C.danger} icon="trash" onPress={removeAll} />
        </>
      )}

      <SectionTitle>Test</SectionTitle>
      <Card>
        <Row icon="send" iconFg={C.teal} iconBg={C.tealSoft}
          title="Send a test notification"
          subtitle="Fires in 5 seconds so you can confirm they work."
          onPress={() => { notifyNow("Companio", "Reminders are working.", 5); setNote("Test notification will arrive in 5 seconds."); }}
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <Disclaimer />
    </Screen>
  );
}
