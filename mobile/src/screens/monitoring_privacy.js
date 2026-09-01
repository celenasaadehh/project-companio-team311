// What Companio may sense, keep and contact.
import React, { useState, useEffect, useCallback } from "react";
import { View, Text, Switch, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, Disclaimer } from "../components/ui";
import { useApp } from "../state/AppContext";

const PAUSE_OPTIONS = [
  { label: "30 minutes", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "Until tomorrow", ms: null, untilTomorrow: true },
  { label: "Until I turn it back on", ms: null, indefinite: true },
];

function ToggleRow({ icon, tint, title, sub, value, onValueChange, disabled }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.surfaceStrong, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
        <Ionicons name={icon} size={19} color={tint || C.primary} />
      </View>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={type.title}>{title}</Text>
        {sub ? <Text style={[type.sub, { marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      <Switch value={!!value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

export function MonitoringPrivacy({ navigation }) {
  const { prefs, setPref, pauseMonitoring, resumeMonitoring, monitoringPausedUntil } = useApp();
  const [, force] = useState(0);

  useEffect(() => {
    if (!monitoringPausedUntil) return;
    const t = setInterval(() => force((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [monitoringPausedUntil]);

  const pausedFor = useCallback(() => {
    if (!monitoringPausedUntil) return null;
    if (monitoringPausedUntil === "indefinite") return "until you turn it back on";
    const mins = Math.max(0, Math.round((monitoringPausedUntil - Date.now()) / 60000));
    if (mins <= 0) return null;
    if (mins < 60) return `for ${mins} more minute${mins === 1 ? "" : "s"}`;
    return `for ${Math.round(mins / 60)} more hour${Math.round(mins / 60) === 1 ? "" : "s"}`;
  }, [monitoringPausedUntil]);

  const paused = !!pausedFor();

  return (
    <Screen>
      <AppHeader eyebrow="YOUR CONTROL" title="Monitoring & privacy"
        subtitle="What Companio may do, and when. You can change any of this at any time."
        onBack={() => navigation.goBack()} />

      <SectionTitle sub="Companio stops watching entirely. Nothing is recorded while paused.">
        Pause Companio
      </SectionTitle>
      {paused ? (
        <Card accent={C.warning}>
          <Row icon="pause-circle" iconFg={C.warning} iconBg={C.warningSoft}
            title="Monitoring is paused" subtitle={`Paused ${pausedFor()}.`} />
          <Btn label="Resume monitoring" icon="play" onPress={resumeMonitoring} />
        </Card>
      ) : (
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {PAUSE_OPTIONS.map((o) => (
              <Text key={o.label}
                onPress={() => {
                  let until = "indefinite";
                  if (o.ms) until = Date.now() + o.ms;
                  else if (o.untilTomorrow) {
                    const d = new Date(); d.setHours(24, 0, 0, 0); until = d.getTime();
                  }
                  pauseMonitoring(until);
                }}
                style={{
                  paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
                  backgroundColor: C.surfaceStrong, color: C.textPrimary,
                  fontWeight: "600", fontSize: 13.5, overflow: "hidden",
                }}>
                {o.label}
              </Text>
            ))}
          </View>
          <Text style={[type.meta, { marginTop: 12 }]}>
            Pausing stops monitoring, check-ins and automatic support. You can still ask for support any time.
          </Text>
        </Card>
      )}

      <SectionTitle sub="Each of these is separate — turning one off does not affect the others.">
        What Companio may sense
      </SectionTitle>
      <Card>
        <ToggleRow icon="pulse" title="Physiological monitoring"
          sub="Heart rate, HRV and sleep from your watch. Continuous while enabled."
          value={prefs.physiologicalMonitoring} onValueChange={(v) => setPref("physiologicalMonitoring", v)} />
        <ToggleRow icon="help-buoy" title="Automatic check-ins"
          sub="Asks how you're doing when your signals change."
          value={prefs.autoCheckIns} onValueChange={(v) => setPref("autoCheckIns", v)}
          disabled={!prefs.physiologicalMonitoring} />
        <ToggleRow icon="camera" tint={C.warning} title="Automatic image capture"
          sub="One photo when your signals stay high and you haven't answered. Never continuous video."
          value={prefs.autoCapture} onValueChange={(v) => setPref("autoCapture", v)} />
        <ToggleRow icon="mic" tint={C.warning} title="Voice recording"
          sub="Lets you talk to Companio. Recording only happens while you're speaking to it."
          value={prefs.voiceRecording} onValueChange={(v) => setPref("voiceRecording", v)} />
      </Card>

      <SectionTitle sub="Transcripts and recordings are separate choices — you can allow one without the other.">
        What is saved for your therapist
      </SectionTitle>
      <Card>
        <ToggleRow icon="document-text" title="Save transcripts"
          sub="The text of what you and Companio said."
          value={prefs.saveTranscripts} onValueChange={(v) => setPref("saveTranscripts", v)} />
        <ToggleRow icon="musical-notes" tint={C.warning} title="Save audio recordings"
          sub="The actual audio. More sensitive than a transcript — off by default."
          value={prefs.saveAudio} onValueChange={(v) => setPref("saveAudio", v)} />
        <ToggleRow icon="image" tint={C.warning} title="Save trigger images"
          sub="Photos captured during an episode, so your therapist can see what happened."
          value={prefs.saveImages} onValueChange={(v) => setPref("saveImages", v)} />
      </Card>

      <SectionTitle>Who Companio may contact</SectionTitle>
      <Card>
        <ToggleRow icon="medkit" title="Therapist alerts"
          sub="Notifies your therapist when something needs their attention."
          value={prefs.therapistAlerts} onValueChange={(v) => setPref("therapistAlerts", v)} />
        <ToggleRow icon="people" title="Caregiver escalation"
          sub="Offers to contact your emergency contact if support isn't helping."
          value={prefs.caregiverEscalation} onValueChange={(v) => setPref("caregiverEscalation", v)} />
      </Card>

      <Card onPress={() => navigation.navigate("PatientTabs", { screen: "Profile" })}>
        <Row icon="volume-high" iconFg={C.primary} iconBg={C.primarySoft}
          title="How Companio speaks"
          subtitle="Voice mode, interrupting, and the wake phrase all live in your Profile."
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <Card accent={C.warning}>
        <Row icon="information-circle" iconFg={C.warning} iconBg={C.warningSoft}
          title="What turning these off does today"
          subtitle="Companio stops keeping the file on your record, and your therapist cannot open it." />
        <Text style={[type.sub, { marginTop: 8 }]}>
          Audio and photos still have to be sent for processing — that is how the words are transcribed and objects are recognised. Automatic erasure after processing is not built yet, so we will not claim it. If you want nothing sent at all, turn off voice recording and automatic image capture above.
        </Text>
      </Card>

      <Card accent={C.primary}>
        <Text style={type.title}>What Companio never does</Text>
        <Text style={[type.sub, { marginTop: 8 }]}>
          It does not record video, and it does not listen continuously. Your heart rate is monitored continuously; the camera and microphone only activate for a specific moment, and only if you allowed it above.
        </Text>
        <Text style={[type.sub, { marginTop: 8 }]}>
          Your name is stored separately from your care records, and photos and recordings are encrypted — only your assigned therapist can open them.
        </Text>
      </Card>

      <Disclaimer />
    </Screen>
  );
}
