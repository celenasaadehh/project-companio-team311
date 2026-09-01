// Index of patient features.
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, SectionTitle, Pill, Card, Disclaimer } from "../components/ui";
import { useApp } from "../state/AppContext";

function FeatureCard({ icon, title, sub, status, statusTone = "muted", onPress }) {
  const toneColors = {
    live: [C.success, C.successSoft],
    connected: [C.success, C.successSoft],
    warn: [C.warning, C.warningSoft],
    muted: [C.textSecondary, C.surfaceAlt],
  };
  const [fg, bg] = toneColors[statusTone] || toneColors.muted;
  return (
    <Card onPress={onPress} style={{ marginTop: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.surfaceStrong, alignItems: "center", justifyContent: "center", marginRight: 14 }}>
          <Ionicons name={icon} size={22} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { fontSize: 16 }]}>{title}</Text>
          <Text style={[type.sub, { marginTop: 3 }]}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.textMuted} style={{ marginTop: 4 }} />
      </View>
      {status ? <View style={{ marginTop: 12 }}><Pill text={status} fg={fg} bg={bg} icon={statusTone === "live" || statusTone === "connected" ? "checkmark-circle" : undefined} /></View> : null}
    </Card>
  );
}

function Hub({ title, sub, count }) {
  return (
    <View style={{ marginTop: spacing.xxl, marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={type.h2}>{title}</Text>
        <View style={{ flex: 1 }} />
        <Pill text={`${count}`} fg={C.primary} bg={C.surfaceStrong} />
      </View>
      {sub ? <Text style={[type.sub, { marginTop: 3 }]}>{sub}</Text> : null}
    </View>
  );
}

export function FeaturesHub({ navigation }) {
  const { devices, vitals } = useApp();

  return (
    <Screen>
      <AppHeader eyebrow="EVERYTHING IN ONE PLACE" title="Features"
        subtitle="Grouped by when you need them, not by how they work."
        onBack={() => navigation.goBack()} />

      <Hub title="In the moment" count={4}
        sub="For right now, when something is happening." />
      <FeatureCard
        icon="heart" title="Ask for support now"
        sub="Tell Companio how you're doing. No trigger or wearable needed."
        status="Always available" statusTone="live"
        onPress={() => navigation.navigate("RequestSupport")}
      />
      <FeatureCard
        icon="camera" title="Camera trigger detection"
        sub="Your phone watches for anything matching the triggers your therapist recorded."
        status={devices.glasses ? "Camera enabled" : "Phone camera — smart glasses not connected"}
        statusTone={devices.glasses ? "connected" : "muted"}
        onPress={() => navigation.navigate("Glasses")}
      />
      <FeatureCard
        icon="mic" title="Voice check-in"
        sub="Say how you're feeling. Transcribed, then answered by the real decision engine."
        status="Ready" statusTone="live"
        onPress={() => navigation.navigate("VoiceCheckIn")}
      />
      <FeatureCard
        icon="leaf" title="Ways to steady yourself"
        sub="Ten grounding techniques — the ones your therapist chose for you, plus general ones anyone can try."
        onPress={() => navigation.navigate("GroundingLibrary")}
      />

      <Hub title="My body" count={3}
        sub="What your watch measures, and what it means." />
      <FeatureCard
        icon="watch" title="Connect your watch"
        sub="Heart rate, HRV and sleep from Apple Health — including Zepp, Garmin and Fitbit watches that sync into it."
        status={devices.watch ? `Connected${vitals?.hr ? ` · ${vitals.hr} bpm` : ""}` : "Not connected"}
        statusTone={devices.watch ? "connected" : "muted"}
        onPress={() => navigation.navigate("Devices")}
      />
      <FeatureCard
        icon="body" title="Calm calibration"
        sub="Records your own resting baseline, so you're compared to yourself and not to an average."
        status={devices.calibrated ? "Calibrated" : "Not calibrated yet"}
        statusTone={devices.calibrated ? "connected" : "warn"}
        onPress={() => navigation.navigate("ConnectWatch")}
      />
      <FeatureCard
        icon="pulse" title="Live monitoring"
        sub="Continuous tracking that accounts for exercise, caffeine and sleep before ever raising an alert."
        status={devices.watch && devices.calibrated ? "Ready" : "Needs a connected, calibrated watch"}
        statusTone={devices.watch && devices.calibrated ? "live" : "muted"}
        onPress={() => navigation.navigate("LiveMonitor")}
      />

      <Hub title="My care" count={4}
        sub="Your plan, your medication, your care team." />
      <FeatureCard
        icon="medkit" title="Care plan"
        sub="Appointments, medications and your care team, in one place."
        onPress={() => navigation.navigate("PatientTabs", { screen: "Care" })}
      />
      <FeatureCard
        icon="alarm" title="Reminders"
        sub="A daily time for each medication, and a nudge an hour before every session."
        onPress={() => navigation.navigate("Reminders")}
      />
      <FeatureCard
        icon="chatbubbles" title="Message your therapist"
        sub="Private messages, request a call, or ask for an appointment."
        onPress={() => navigation.navigate("Messages")}
      />
      <FeatureCard
        icon="stats-chart" title="Progress over time"
        sub="Your own trends, in charts you can talk through together."
        onPress={() => navigation.navigate("Progress")}
      />

      <Hub title="How it works" count={2}
        sub="Companio explains itself. Nothing here is hidden from you." />
      <FeatureCard
        icon="flash" title="How it decided"
        sub="A real, step-by-step trace of your recent moments — which rule or model decided, and why."
        onPress={() => navigation.navigate("DecisionInspector")}
      />
      <FeatureCard
        icon="lock-closed" title="Privacy & your data"
        sub="Your name is stored separately from your care records. Here's exactly how."
        onPress={() => navigation.navigate("PatientTabs", { screen: "Profile" })}
      />

      <Disclaimer />
    </Screen>
  );
}
