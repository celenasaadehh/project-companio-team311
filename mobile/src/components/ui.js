// Shared UI components.
import React, { useRef, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Animated, Pressable, Easing, Linking } from "react-native";
import Svg, { Path, G, Circle, Defs, RadialGradient as SvgRadialGradient, Stop as SvgStop } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
let LinearGradient = null;
try { LinearGradient = require("expo-linear-gradient").LinearGradient || null; } catch { LinearGradient = null; }
import { getCriticalSyncFailures, onSyncFailure } from "../services/errors";
import { colors as C, spacing, radius, type, shadow, riskColor, gradients } from "../theme/theme";

export const Screen = ({ children, scroll = true, style, refreshControl }) => {
  const inner = <View style={[{ paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 44 }, style]}>{children}</View>;
  const body = scroll
    ? <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }} refreshControl={refreshControl}>{inner}</ScrollView>
    : inner;
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {LinearGradient ? (
        <LinearGradient
          colors={gradients.screen}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      <SafeAreaView style={{ flex: 1, backgroundColor: "transparent" }} edges={["top", "left", "right"]}>
        {body}
      </SafeAreaView>
    </View>
  );
};

export const AppHeader = ({ title, subtitle, right, onBack, eyebrow }) => (
  <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xl }}>
    {onBack ? (
      <TouchableOpacity onPress={onBack} style={st.back} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
      </TouchableOpacity>
    ) : null}
    <View style={{ flex: 1, paddingRight: spacing.md }}>
      {eyebrow ? <Text style={[type.meta, { color: C.primary, marginBottom: 5 }]}>{eyebrow}</Text> : null}
      <Text style={type.h1}>{title}</Text>
      {subtitle ? <Text style={[type.sub, { marginTop: 5 }]}>{subtitle}</Text> : null}
    </View>
    {right}
  </View>
);

export const Card = ({ children, style, onPress, accent }) => {
  const inner = (
    <View style={[st.cardInner, accent ? { borderTopWidth: 2, borderTopColor: accent } : null]}>
      {children}
    </View>
  );
  const body = LinearGradient ? (
    <LinearGradient
      colors={gradients.glass}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[st.card, style]}
    >
      {inner}
    </LinearGradient>
  ) : (
    <View style={[st.card, { backgroundColor: C.surface }, style]}>{inner}</View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.8} onPress={onPress}>{body}</TouchableOpacity> : body;
};

export const SectionTitle = ({ children, right, sub }) => (
  <View style={{ marginTop: spacing.xxl, marginBottom: spacing.sm }}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={type.h2}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
    {sub ? <Text style={[type.sub, { marginTop: 3 }]}>{sub}</Text> : null}
  </View>
);

export const Divider = ({ style }) => <View style={[{ height: 1, backgroundColor: C.border, marginVertical: spacing.md }, style]} />;

export const Pill = ({ text, fg = C.primary, bg = C.primarySoft, icon }) => (
  <View style={[st.pill, { backgroundColor: bg }]}> 
    {icon ? <Ionicons name={icon} size={12} color={fg} style={{ marginRight: 4 }} /> : null}
    <Text style={{ color: fg, fontSize: 11.5, fontWeight: "700" }}>{text}</Text>
  </View>
);

export const IconChip = ({ icon, fg = C.primary, bg = C.primarySoft, size = 38 }) => (
  <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
    <Ionicons name={icon} size={size * 0.48} color={fg} />
  </View>
);

export const Btn = ({ label, onPress, color, icon, variant = "solid", disabled }) => {
  const outline = variant === "outline";
  const ghost = variant === "ghost";
  const flat = outline || ghost;
  const tint = color || C.primary;
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={18} color={flat ? tint : "#EAF7FF"} style={{ marginRight: 7 }} /> : null}
      <Text style={{ color: flat ? tint : "#EAF7FF", fontSize: 16, fontWeight: "700", letterSpacing: -0.2 }}>{label}</Text>
    </>
  );
  const useGradient = !flat && !color && !!LinearGradient;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={{ opacity: disabled ? 0.45 : 1 }}>
      {useGradient ? (
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.btn}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[st.btn, { backgroundColor: flat ? "transparent" : tint, borderWidth: outline ? 1 : 0, borderColor: tint }]}>
          {content}
        </View>
      )}
    </TouchableOpacity>
  );
};

export const Row = ({ icon, iconFg = C.primary, iconBg = C.primarySoft, title, subtitle, right, onPress, compact = false }) => {
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: compact ? 4 : 2 }}>
      {icon ? <IconChip icon={icon} fg={iconFg} bg={iconBg} size={compact ? 34 : 40} /> : null}
      <View style={{ flex: 1, marginLeft: icon ? spacing.md : 0, paddingRight: 8 }}>
        <Text style={type.title}>{title}</Text>
        {subtitle ? <Text style={[type.sub, { marginTop: 2 }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {typeof right === "string" ? <Text style={{ fontWeight: "700", color: C.textPrimary }}>{right}</Text> : right}
    </View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.72} onPress={onPress}>{body}</TouchableOpacity> : body;
};

export const MetricCard = ({ icon, label, value, sub, fg = C.primary, bg = C.primarySoft, trend }) => (
  <View style={st.metricBlock}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {icon ? <Ionicons name={icon} size={15} color={fg} style={{ marginRight: 5 }} /> : null}
      <Text style={[type.meta, { color: C.textSecondary }]}>{label}</Text>
    </View>
    <Text style={[type.metric, { marginTop: 5 }]}>{value}</Text>
    {sub ? <Text style={[type.meta, { marginTop: 1 }]}>{sub}</Text> : null}
    {trend ? <Text style={{ fontSize: 11.5, color: C.success, marginTop: 3, fontWeight: "600" }}>{trend}</Text> : null}
  </View>
);

export const RiskBadge = ({ level }) => {
  const r = riskColor(level);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: r.fg, marginRight: 6 }} />
      <Text style={{ color: r.fg, fontSize: 12, fontWeight: "700" }}>{r.label}</Text>
    </View>
  );
};

export const ProgressBar = ({ value, color = C.primary }) => (
  <View style={{ height: 6, borderRadius: 6, backgroundColor: C.surfaceStrong, overflow: "hidden", marginTop: 8 }}>
    <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", backgroundColor: color, borderRadius: 6 }} />
  </View>
);

export const QuickAction = ({ icon, label, onPress, fg = C.primary, bg = C.primarySoft }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.78} style={st.quick}>
    <IconChip icon={icon} fg={fg} bg={bg} />
    <Text style={{ fontSize: 13.5, fontWeight: "680", color: C.textPrimary, marginTop: 8 }}>{label}</Text>
  </TouchableOpacity>
);

export const DecisionSourceBadge = ({ source }) => {
  if (source === "therapist_rule") return <Pill text="Therapist rule" fg="#fff" bg={C.primary} icon="shield-checkmark" />;
  if (source === "ai_reasoning") return <Pill text="AI reasoning" fg={C.lavender} bg={C.lavenderSoft} icon="sparkles" />;
  if (source === "safety_escalation") return <Pill text="Escalated to a person" fg={C.danger} bg={C.dangerSoft} icon="hand-left" />;
  return <Pill text="Safe fallback" fg={C.textSecondary} bg="#EEF2F6" icon="leaf" />;
};

export const EmptyState = ({ icon = "file-tray", title, sub }) => (
  <View style={{ alignItems: "center", paddingVertical: 36 }}>
    <IconChip icon={icon} fg={C.textMuted} bg={C.surfaceStrong} size={48} />
    <Text style={[type.title, { marginTop: 12 }]}>{title}</Text>
    {sub ? <Text style={[type.sub, { marginTop: 4, textAlign: "center", maxWidth: 270 }]}>{sub}</Text> : null}
  </View>
);

export const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={[st.chip, active && st.chipActive]}>
    <Text style={{ fontSize: 13, fontWeight: "650", color: active ? C.textPrimary : C.textSecondary }}>{label}</Text>
  </TouchableOpacity>
);

export function SyncFailureBanner({ onPress }) {
  const [failures, setFailures] = useState(() => getCriticalSyncFailures());
  useEffect(() => onSyncFailure(() => setFailures(getCriticalSyncFailures())), []);
  if (!failures.length) return null;
  const newest = failures[0];
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} disabled={!onPress}
      style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.dangerSoft,
               borderRadius: radius.md, padding: 12, marginBottom: spacing.md,
               borderWidth: 1, borderColor: C.danger }}>
      <Ionicons name="cloud-offline" size={19} color={C.danger} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={[type.title, { fontSize: 14.5 }]}>
          {failures.length === 1 ? "Something didn't save" : `${failures.length} things didn't save`}
        </Text>
        <Text style={[type.sub, { marginTop: 2 }]} numberOfLines={2}>
          {`${SYNC_LABELS[newest.operation] || newest.operation}: ${newest.message}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const SYNC_LABELS = {
  medication_log: "Medication log",
  daily_snapshot: "Daily health summary",
  therapist_push_token: "Alert delivery setup",
  load_caseload: "Your patient list",
  appointment_request: "Appointment request",
};

export function CrisisContacts({ therapistName, caregiver, onContactTherapist, note }) {
  const call = (number) => {
    const n = String(number || "").replace(/[^+\d]/g, "");
    if (n) Linking.openURL(`tel:${n}`).catch(() => {});
  };
  return (
    <Card accent={C.danger}>
      <Text style={type.title}>Reach someone now</Text>
      {note ? <Text style={[type.sub, { marginTop: 6 }]}>{note}</Text> : null}

      {onContactTherapist ? (
        <View style={{ marginTop: 10 }}>
          <Btn label={therapistName ? `Tell ${therapistName} I need them` : "Tell my therapist I need them"}
            icon="medkit" onPress={onContactTherapist} />
        </View>
      ) : null}

      {caregiver?.phone ? (
        <View style={{ marginTop: 8 }}>
          <Btn label={`Call ${caregiver.name || "my support person"}`} icon="call"
            variant="outline" onPress={() => call(caregiver.phone)} />
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <Btn label="Call 988 — crisis line, 24 hours" icon="alert-circle"
          variant="outline" color={C.danger} onPress={() => call("988")} />
      </View>
      <Text style={[type.meta, { marginTop: 10 }]}>
        Companio is not an emergency service and no one is watching this in real time. If you are in immediate danger, call 911.
      </Text>
    </Card>
  );
}

export const Disclaimer = ({ text = "Companio supports your care — it doesn't diagnose or replace your therapist. In a crisis, call 988." }) => (
  <Text style={{ fontSize: 11.5, color: C.textMuted, textAlign: "center", marginTop: 24, lineHeight: 16, paddingHorizontal: 8 }}>{text}</Text>
);

const GradientBase = ({ colors: g, style, children }) => {
  if (!LinearGradient) return <View style={[style, { backgroundColor: g[0] }]}>{children}</View>;
  return (
    <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
};

export const GradientCard = ({ colors: g = gradients.ocean, children, style, onPress }) => {
  const body = <GradientBase colors={g} style={[gradSt.card, style]}>{children}</GradientBase>;
  return onPress ? <TouchableOpacity activeOpacity={0.88} onPress={onPress}>{body}</TouchableOpacity> : body;
};

export const HeroAction = ({ eyebrow, title, subtitle, icon = "heart", onPress, colors: g = gradients.ocean }) => (
  <GradientCard colors={g} onPress={onPress}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={gradSt.heroIcon}><Ionicons name={icon} size={24} color="#fff" /></View>
      <View style={{ flex: 1, marginLeft: spacing.lg }}>
        {eyebrow ? <Text style={gradSt.heroEyebrow}>{eyebrow}</Text> : null}
        <Text style={gradSt.heroTitle}>{title}</Text>
        {subtitle ? <Text style={gradSt.heroSub}>{subtitle}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.85)" /> : null}
    </View>
  </GradientCard>
);

export const StatTile = ({ label, value, unit, icon, tint = C.primary, onPress }) => {
  const body = (
    <View style={statSt.tile}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
        {icon ? <Ionicons name={icon} size={14} color={tint} style={{ marginRight: 5 }} /> : null}
        <Text style={[type.meta, { color: tint }]} numberOfLines={1}>{label}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={[type.metric, { fontSize: 28 }]}>{value ?? "—"}</Text>
        {unit ? <Text style={[type.sub, { marginLeft: 4 }]}>{unit}</Text> : null}
      </View>
    </View>
  );
  return onPress ? <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ flex: 1 }}>{body}</TouchableOpacity> : body;
};

const gradSt = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing.xl, marginBottom: spacing.md, ...shadow.floating },
  heroIcon: { width: 50, height: 50, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  heroEyebrow: { fontSize: 11.5, fontWeight: "700", color: "rgba(255,255,255,0.82)", letterSpacing: 0.7, marginBottom: 3 },
  heroTitle: { fontSize: 19, fontWeight: "700", color: "#fff", letterSpacing: -0.3 },
  heroSub: { fontSize: 13.5, color: "rgba(255,255,255,0.86)", marginTop: 3, lineHeight: 18 },
});

const statSt = StyleSheet.create({
  tile: {
    flex: 1, backgroundColor: C.surface, borderRadius: radius.md, padding: spacing.lg,
    borderWidth: 1, borderColor: C.border, ...shadow.card,
  },
});

export const BubbleCard = ({ title, subtitle, icon = "sparkles-outline", iconTint = C.primary, value, badge, badgeTone = "muted", onPress, children, compact = false }) => {
  const Wrapper = onPress ? Pressable : View;
  const badgeColors = { muted: [C.textMuted, C.surfaceStrong], live: [C.success, C.successSoft], warn: [C.warning, C.warningSoft] }[badgeTone] || [C.textMuted, C.surfaceStrong];
  return (
    <Wrapper onPress={onPress} style={({ pressed }) => [bubbleSt.card, compact && bubbleSt.compact, { opacity: pressed ? 0.88 : 1 }]}>
      <View style={bubbleSt.row}>
        <View style={[bubbleSt.iconBubble, { backgroundColor: `${iconTint}18` }]}>
          <Ionicons name={icon} size={21} color={iconTint} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={bubbleSt.titleRow}>
            <Text style={type.title}>{title}</Text>
            {badge ? <View style={[bubbleSt.badge, { backgroundColor: badgeColors[1] }]}><Text style={[bubbleSt.badgeText, { color: badgeColors[0] }]}>{badge}</Text></View> : null}
          </View>
          {subtitle ? <Text style={[type.sub, { marginTop: 3 }]}>{subtitle}</Text> : null}
        </View>
        {value ? <Text style={{ fontSize: 17, fontWeight: "600", color: C.textPrimary, marginRight: 4 }}>{value}</Text> : null}
        {onPress ? <Ionicons name="chevron-forward" size={19} color={C.textMuted} /> : null}
      </View>
      {children ? <View style={{ marginTop: spacing.md }}>{children}</View> : null}
    </Wrapper>
  );
};

const bubbleSt = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, padding: spacing.md, marginBottom: spacing.sm, ...shadow.card },
  compact: { paddingVertical: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBubble: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
});

export function EngineTrace({ trace, source }) {
  if (!trace || !trace.length) return null;
  return (
    <Card accent={C.lavender}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <Ionicons name="git-branch" size={16} color={C.lavender} style={{ marginRight: 7 }} />
        <Text style={type.meta}>HOW THIS WAS DECIDED</Text>
        <View style={{ flex: 1 }} />
        {source ? <DecisionSourceBadge source={source} /> : null}
      </View>
      {trace.map((t, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: 9,
          borderTopWidth: i === 0 ? 0 : 1, borderTopColor: C.border }}>
          <Ionicons
            name={t.hit ? "checkmark-circle" : "ellipse-outline"}
            size={17}
            color={t.hit ? C.success : C.textMuted}
            style={{ marginTop: 2, marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={[type.title, { fontSize: 14.5 }]}>{t.step}</Text>
            {t.detail ? <Text style={[type.meta, { marginTop: 2, letterSpacing: 0 }]}>{t.detail}</Text> : null}
            <Text style={[type.sub, { marginTop: 3 }]}>{t.result}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const ORB_STOPS = [
  { deg: 0,   c: "#DFF8FF" },
  { deg: 56,  c: "#A8E2F8" },
  { deg: 112, c: "#7DC2ED" },
  { deg: 175, c: "#5A92D2" },
  { deg: 240, c: "#3B68AA" },
  { deg: 305, c: "#274A80" },
  { deg: 360, c: "#DFF8FF" },
];
const ORB_FROM = 220;
const WEDGES = 180;

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

function orbColorAt(deg) {
  const d = ((deg % 360) + 360) % 360;
  for (let i = 0; i < ORB_STOPS.length - 1; i++) {
    const a = ORB_STOPS[i], b = ORB_STOPS[i + 1];
    if (d >= a.deg && d <= b.deg) {
      const t = (d - a.deg) / (b.deg - a.deg || 1);
      const [r1, g1, b1] = hex2rgb(a.c), [r2, g2, b2] = hex2rgb(b.c);
      return rgb2hex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
    }
  }
  return ORB_STOPS[0].c;
}

function wedgePath(a1, a2, size) {
  const rO = size / 2, rI = size * 0.17, cx = rO, cy = rO;
  const rad = (a) => ((a - 90) * Math.PI) / 180;
  const p = (r, a) => [cx + r * Math.cos(rad(a)), cy + r * Math.sin(rad(a))];
  const [x1, y1] = p(rO, a1), [x2, y2] = p(rO, a2);
  const [x3, y3] = p(rI, a2), [x4, y4] = p(rI, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  const f = (n) => n.toFixed(2);
  return `M ${f(x1)} ${f(y1)} A ${rO} ${rO} 0 ${large} 1 ${f(x2)} ${f(y2)} ` +
         `L ${f(x3)} ${f(y3)} A ${rI} ${rI} 0 ${large} 0 ${f(x4)} ${f(y4)} Z`;
}

const ORB_SIZE = 170;

function WaveBars({ active }) {
  const bars = [16, 29, 39, 26, 14];
  const vals = useRef(bars.map(() => new Animated.Value(1))).current;
  useEffect(() => {
    if (!active) return;
    const loops = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 0.5, duration: 550, delay: i * 100, useNativeDriver: true }),
          Animated.timing(v, { toValue: 1, duration: 550, useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active]);
  if (!active) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {bars.map((h, i) => (
        <Animated.View key={i} style={{ width: 4, height: h, borderRadius: 4, backgroundColor: "#173B60", transform: [{ scaleY: vals[i] }] }} />
      ))}
    </View>
  );
}

export function SupportOrb({ mode = "idle", onPress }) {
  const scaleV = useRef(new Animated.Value(1)).current;
  const spinV = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scaleV.setValue(1);
    let loop;
    if (mode === "listening") {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(scaleV, { toValue: 1.07, duration: 525, useNativeDriver: true }),
        Animated.timing(scaleV, { toValue: 0.96, duration: 525, useNativeDriver: true }),
      ]));
    } else if (mode === "speaking") {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(scaleV, { toValue: 1.06, duration: 350, useNativeDriver: true }),
        Animated.timing(scaleV, { toValue: 0.97, duration: 350, useNativeDriver: true }),
      ]));
    } else if (mode === "idle") {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(scaleV, { toValue: 1.02, duration: 1600, useNativeDriver: true }),
        Animated.timing(scaleV, { toValue: 1.0, duration: 1600, useNativeDriver: true }),
      ]));
    }
    loop?.start();
    return () => loop?.stop();
  }, [mode]);

  useEffect(() => {
    spinV.setValue(0);
    if (mode !== "thinking") return;
    const loop = Animated.loop(Animated.timing(spinV, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [mode]);

  const spin = spinV.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const label = { idle: "Ready", listening: "Listening", thinking: "Transcribing", speaking: "Speaking" }[mode] || "Ready";
  const help = {
    idle: "Tap the orb when you want to talk.",
    listening: "I'm listening — take your time.",
    thinking: "Working out the best way to help.",
    speaking: "Companio is responding.",
  }[mode];

  const wedges = [];
  for (let i = 0; i < WEDGES; i++) {
    const a1 = (i * 360) / WEDGES;
    const a2 = ((i + 1) * 360) / WEDGES + 0.35;
    wedges.push(<Path key={i} d={wedgePath(a1, a2, ORB_SIZE)} fill={orbColorAt(a1 - ORB_FROM)} />);
  }

  return (
    <View style={orbSt.wrap}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Talk to Companio — ${label}`} disabled={!onPress}>
        <Animated.View style={[orbSt.orb, { transform: [{ scale: scaleV }] }]}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Svg width={ORB_SIZE} height={ORB_SIZE} viewBox={`0 0 ${ORB_SIZE} ${ORB_SIZE}`}>
              <Defs>
                <SvgRadialGradient id="orbCore" cx="38%" cy="30%" r="78%">
                  <SvgStop offset="0" stopColor="#EAF9FF" stopOpacity="1" />
                  <SvgStop offset="0.55" stopColor="#A8D8F2" stopOpacity="1" />
                  <SvgStop offset="1" stopColor="#6FA6DA" stopOpacity="1" />
                </SvgRadialGradient>
                <SvgRadialGradient id="orbGloss" cx="35%" cy="25%" r="55%">
                  <SvgStop offset="0" stopColor="#FFFFFF" stopOpacity="0.70" />
                  <SvgStop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
                </SvgRadialGradient>
              </Defs>
              <G>{wedges}</G>
              <Circle cx={ORB_SIZE / 2} cy={ORB_SIZE / 2} r={ORB_SIZE * 0.175} fill="url(#orbCore)" />
              <Circle cx={ORB_SIZE / 2} cy={ORB_SIZE / 2} r={ORB_SIZE / 2 - 4} fill="url(#orbGloss)" />
            </Svg>
          </Animated.View>

          <View style={orbSt.iconLayer} pointerEvents="none">
            {mode === "listening"
              ? <WaveBars active />
              : <Ionicons
                  name={mode === "speaking" ? "volume-high" : mode === "thinking" ? "sync" : "mic"}
                  size={42} color="#173B60" />}
          </View>
        </Animated.View>
      </Pressable>

      <Text style={orbSt.stateLabel}>{label}</Text>
      <Text style={orbSt.stateHelp}>{help}</Text>
    </View>
  );
}

const orbSt = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg },
  orb: {
    width: ORB_SIZE, height: ORB_SIZE, borderRadius: ORB_SIZE / 2,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#1B4C86", shadowOpacity: 0.32, shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 }, elevation: 8,
  },
  iconLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  stateLabel: { marginTop: 22, fontSize: 10.5, letterSpacing: 1.5, fontWeight: "800", color: "#3E6785", textTransform: "uppercase" },
  stateHelp: { marginTop: 7, fontSize: 13, color: "#406783", textAlign: "center", maxWidth: 290, lineHeight: 19 },
});

export function ConfoundBanner({ visible, onAnswer, onDismiss }) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: visible ? 0 : -100, useNativeDriver: true, friction: 9, tension: 60 }),
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[bannerSt.wrap, { transform: [{ translateY }], opacity }]} pointerEvents={visible ? "auto" : "none"}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <Ionicons name="pulse" size={16} color={C.textSecondary} style={{ marginTop: 2, marginRight: 8 }} />
        <Text style={[type.meta, { flex: 1, color: C.textSecondary }]}>Heart rate's a little elevated — anything explain it?</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={10}><Ionicons name="close" size={16} color={C.textMuted} /></TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
        {["Just worked out", "Had caffeine", "Not sure"].map((label) => (
          <TouchableOpacity key={label} onPress={() => onAnswer(label)} style={bannerSt.chip}>
            <Text style={bannerSt.chipText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Animated.View>
  );
}

const bannerSt = StyleSheet.create({
  wrap: {
    backgroundColor: C.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md, ...shadow.floating,
  },
  chip: { backgroundColor: C.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, marginTop: 4 },
  chipText: { fontSize: 12, fontWeight: "600", color: C.textPrimary },
});

const st = StyleSheet.create({
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center", marginRight: 10 },
  card: { borderRadius: radius.lg, marginTop: spacing.md, overflow: "hidden", borderWidth: 1, borderColor: C.border, ...shadow.card },
  cardInner: { padding: spacing.xl },
  metricBlock: { flex: 1, minWidth: "46%", paddingVertical: 13, paddingHorizontal: 4, marginRight: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  pill: { flexDirection: "row", alignItems: "center", borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 9, alignSelf: "flex-start" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: radius.pill, paddingVertical: 16, paddingHorizontal: 20, marginTop: spacing.sm },
  quick: { width: "48%", minHeight: 92, backgroundColor: C.surface, borderRadius: radius.lg, padding: spacing.lg, marginRight: "2%", marginBottom: 8, borderWidth: 1, borderColor: C.border },
  chip: { backgroundColor: C.surfaceStrong, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginTop: 8, borderWidth: 1, borderColor: "transparent" },
  chipActive: { backgroundColor: C.surface, borderColor: C.borderStrong, ...shadow.card },
  banner: { flexDirection: "row", alignItems: "center", borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10, alignSelf: "flex-start" },
});
