import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Pill, Btn, Chip, IconChip, DecisionSourceBadge, Disclaimer } from "../components/ui";
import { RiskGauge, Sparkline } from "../components/charts";
import { RISK_SCENARIOS, DEMO_SCENARIOS, FEATURE_NAMES, SENSOR_STREAMS, RISK_THRESHOLDS, ACTION_FOR_LEVEL, supportForScore, SUPPORT_TO_RISKLEVEL, processMoment, makeDecisionRecord, makeSafe, apiCall } from "../services/engine";
import { useApp } from "../state/AppContext";
import { EXAMPLE_PATIENT } from "../data/demoData";

const wave = (b, a) => Array.from({ length: 12 }, (_, i) => +(b + a * Math.sin(i / 1.5)).toFixed(1));

export function DemoHome({ navigation }) {
  const { resetDemoData } = useApp();
  const engines = [
    ["1 · Risk engine", "pulse", "Wearable → 16 features → Random Forest → distress score", "RiskEngineDemo", C.teal, C.tealSoft],
    ["2 · Therapist engine", "shield-checkmark", "Identity, privacy boundary, rules, validation", "TherapistEngineDemo", C.primary, C.primarySoft],
    ["3 · Decision & safety engine", "git-branch", "Seen vs unseen · AI vs rules · fail-closed safety", "DecisionDemo", C.lavender, C.lavenderSoft],
  ];
  const detectors = [
    ["1 · TF-IDF + Logistic Reg.", "text", "67.8% · archived, not live", C.textMuted, "#EEF1F6"],
    ["2 · MiniLM embeddings", "git-network", "73.2% · archived, not live", C.textMuted, "#EEF1F6"],
    ["3 · DistilBERT · LIVE", "hardware-chip", "78.5% · actually wired into /api/detect · ROC AUC 0.857", C.lavender, C.lavenderSoft],
  ];
  return (
    <Screen>
      <AppHeader title="Engine demo" subtitle="Deterministic offline scenarios + optional live APIs" onBack={() => navigation.goBack()} right={<TouchableOpacity accessibilityRole="button" accessibilityLabel="Reset demo data" onPress={resetDemoData} style={{ padding: 10 }}><Ionicons name="refresh" size={22} color={C.primary} /></TouchableOpacity>} />

      <SectionTitle>The three engines</SectionTitle>
      {engines.map(([t, ic, s, dest, fg, bg]) => (
        <Card key={t} onPress={() => navigation.navigate(dest)}>
          <Row icon={ic} iconFg={fg} iconBg={bg} title={t} subtitle={s} right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
        </Card>
      ))}

      <SectionTitle>The three AI detection models</SectionTitle>
      <Card onPress={() => navigation.navigate("DetectorsDemo")}>
        <Row icon="layers" iconFg={C.primary} iconBg={C.primarySoft} title="Compare all three models" subtitle="Same text, three different AI approaches, side by side"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
        <View style={{ marginTop: 6 }}>
          {detectors.map(([t, ic, s, fg, bg]) => <Row key={t} icon={ic} iconFg={fg} iconBg={bg} title={t} subtitle={s} />)}
        </View>
      </Card>

      <SectionTitle>The two devices</SectionTitle>
      <Card onPress={() => navigation.navigate("Glasses")}>
        <Row icon="glasses" iconFg={C.teal} iconBg={C.tealSoft} title="Companio Glasses" subtitle="Camera → object detection → trigger → spoken calming response"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      <Card onPress={() => navigation.navigate("ConnectWatch")}>
        <Row icon="watch" iconFg={C.primary} iconBg={C.primarySoft} title="Companio Watch" subtitle="Calibration → live heart rate → distress signal"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <SectionTitle>Putting it together</SectionTitle>
      <Card onPress={() => navigation.navigate("FullPipeline")}>
        <Row icon="git-branch" iconFg={C.warning} iconBg={C.warningSoft} title="Full pipeline" subtitle="Wearable → engines → safety → app" right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      <Card onPress={() => navigation.navigate("Privacy")}>
        <Row icon="shield-half" iconFg={C.primary} iconBg={C.primarySoft} title="Data privacy" subtitle="Identity separated from clinical data" right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      <Disclaimer />
    </Screen>
  );
}

// The three distress-detection models, kept visibly distinct.
export function DetectorsDemo({ navigation }) {
  const [text, setText] = useState("I keep having flashbacks and my heart is racing at night.");
  const [live, setLive] = useState(null);
  const [loading, setLoading] = useState(false);
  const models = [
    { name: "TF-IDF + Logistic Regression", acc: 0.6783, how: "Counts telling keywords (word frequencies). No understanding of meaning — but fast, tiny, and fully explainable.", uses: "Archived — see ml/archived_weaker_models/", fg: C.textSecondary, bg: "#EEF1F6", icon: "text" },
    { name: "MiniLM sentence embeddings", acc: 0.7315, how: "Turns the sentence into a 384-d meaning vector, so paraphrases (‘can’t stop reliving it’) land near ‘flashbacks’.", uses: "Archived — see ml/archived_weaker_models/", fg: C.textSecondary, bg: "#EEF1F6", icon: "git-network" },
    { name: "DistilBERT (fine-tuned) · LIVE", acc: 0.7846, how: "A transformer that reads words in context. Heaviest to run, but best at subtle, real-world phrasing.", uses: "The one /api/detect actually calls", fg: C.lavender, bg: C.lavenderSoft, icon: "hardware-chip" },
  ];
  async function detect() {
    setLoading(true);
    try { const r = await apiCall("/api/detect", { text }); setLive({ distress: r.distress, ok: true }); }
    catch { setLive({ distress: "stress", ok: false }); }
    finally { setLoading(false); }
  }
  return (
    <Screen>
      <AppHeader title="Detection models" subtitle="Three separate AI systems for the same job" onBack={() => navigation.goBack()} />
      <Card>
        <SectionTitle>Try it on a sentence</SectionTitle>
        <TextInput value={text} onChangeText={setText} multiline placeholder="Type how someone might describe how they feel…" placeholderTextColor={C.textMuted}
          style={{ backgroundColor: C.background, borderRadius: radius.md, padding: 12, minHeight: 70, fontSize: 15, color: C.textPrimary, textAlignVertical: "top" }} />
        <View style={{ marginTop: spacing.sm }}><Btn label="Run detection" icon="pulse" onPress={detect} /></View>
        {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 10 }} /> : null}
        {live ? (
          <View style={{ marginTop: 10 }}>
            <Pill text={`distress: ${live.distress}`} fg={live.distress === "stress" ? C.danger : C.success} bg={live.distress === "stress" ? C.dangerSoft : C.successSoft} />
            <Text style={[type.meta, { marginTop: 6 }]}>{live.ok ? "Live engine · /api/detect" : "Demo data · backend not reachable"}</Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>How the three differ</SectionTitle>
      {models.map((m) => (
        <Card key={m.name} accent={m.fg}>
          <Row icon={m.icon} iconFg={m.fg} iconBg={m.bg} title={m.name} right={<Pill text={`${Math.round(m.acc * 100)}%`} fg={m.fg} bg={m.bg} />} />
          <Text style={[type.body, { marginTop: 8 }]}>{m.how}</Text>
          <Text style={[type.meta, { marginTop: 6 }]}>Best for: {m.uses}</Text>
        </Card>
      ))}
      <Text style={[type.meta, { marginTop: 8 }]}>Accuracy from the same Reddit proof-of-concept test set. Honest caps: this task tops out near 80% — not inflated.</Text>
      <Disclaimer />
    </Screen>
  );
}

const RISK_STATUS = [
  "Tap ▶ to run a live analysis",
  "Reading 30 seconds of wearable data…",
  "Extracting 16 features…",
  "Running the Random Forest…",
  "Distress score ready",
  "Mapping score → support level",
  "Analysis complete",
];

export function RiskEngineDemo({ navigation }) {
  const [key, setKey] = useState("baseline");
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tech, setTech] = useState(false);
  const timers = useRef([]);
  const sc = RISK_SCENARIOS[key];
  const level = supportForScore(sc.score);
  const action = ACTION_FOR_LEVEL[level];

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);
  function play() {
    clearTimers(); setStage(0); setPlaying(true);
    const seq = [[300, 1], [1500, 2], [2900, 3], [4600, 4], [5700, 5], [6600, 6]];
    seq.forEach(([t, s]) => timers.current.push(setTimeout(() => { setStage(s); if (s === 6) setPlaying(false); }, t)));
  }
  function pick(k) { clearTimers(); setPlaying(false); setStage(0); setKey(k); }
  const calculating = playing && stage === 3;

  return (
    <Screen>
      <AppHeader title="Risk engine" subtitle="Physiological distress — not a PTSD diagnosis" onBack={() => navigation.goBack()} />
      <View style={{ flexDirection: "row" }}>{Object.keys(RISK_SCENARIOS).map((k) => <Chip key={k} label={RISK_SCENARIOS[k].label} active={key === k} onPress={() => pick(k)} />)}</View>

      {/* live status banner */}
      <Card accent={C.primary}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {playing ? <ActivityIndicator color={C.primary} style={{ marginRight: 10 }} /> : <Ionicons name={stage === 6 ? "checkmark-circle" : "flash"} size={22} color={stage === 6 ? C.success : C.primary} style={{ marginRight: 10 }} />}
          <Text style={[type.title, { flex: 1 }]}>{RISK_STATUS[stage]}</Text>
        </View>
        <View style={{ height: 6, backgroundColor: C.border, borderRadius: 3, marginTop: 10, overflow: "hidden" }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.primary, width: `${(stage / 6) * 100}%` }} />
        </View>
        <View style={{ marginTop: 12 }}><Btn label={stage === 0 ? "▶  Run analysis" : playing ? "Analysing…" : "▶  Run again"} icon="play" onPress={play} disabled={playing} /></View>
      </Card>

      <Reveal show={stage >= 1}>
        <StepCard n={1} title="Receive 30 seconds of wearable data">
          <Text style={type.sub}>HR · EDA · temperature · movement · IBI/HRV — exactly 30 one-second samples.</Text>
          <View style={{ marginTop: 8 }}><Pill text="Compared to your personal calm baseline" fg={C.primary} bg={C.primarySoft} icon="person" /></View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
            {[["Heart rate", sc.hr, C.danger], ["EDA", sc.eda, C.teal], ["Temp", sc.temp, C.warning]].map(([l, v, col]) => (
              <View key={l} style={{ width: "50%", marginBottom: 8 }}><Text style={type.meta}>{l}</Text><Sparkline data={wave(v, v * 0.06)} color={col} /></View>
            ))}
          </View>
          <Pill text="30 / 30 samples" fg={C.success} bg={C.successSoft} icon="checkmark" />
        </StepCard>
      </Reveal>

      <Reveal show={stage >= 2}>
        <StepCard n={2} title="Extract 16 features">
          <Text style={type.sub}>The 30-second window is compressed into exactly 16 numbers. A few of the formulas:</Text>
          <Formula t="HR_mean = (1/N) · Σ hrᵢ" />
          <Formula t="HR_std  = √( (1/N) · Σ (hrᵢ − HR_mean)² )" />
          <Formula t="SDNN    = std(IBI)          RMSSD = √( mean(ΔIBI²) )" />
          <Formula t="EDA_slope = (EDA_last − EDA_first) / 30s" />
          <View style={{ marginTop: 10 }}><Pill text="16 / 16 features extracted" fg={C.success} bg={C.successSoft} icon="checkmark" /></View>
          <View style={{ backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 10, marginTop: 8 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((r) => (
              <View key={r} style={{ flexDirection: "row" }}>
                {[FEATURE_NAMES[r], FEATURE_NAMES[r + 8]].map((f, c) => (
                  <View key={c} style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 3 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center", marginRight: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: C.primary }}>{r + 1 + c * 8}</Text>
                    </View>
                    <Text style={{ fontSize: 11.5, color: C.textSecondary, flex: 1 }} numberOfLines={1}>{f}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
          <Text style={[type.meta, { marginTop: 6 }]}>HR (3) · EDA (4) · temperature (3) · movement (3) · HRV: SDNN + RMSSD (2 of the IBI features) = 16</Text>
        </StepCard>
      </Reveal>

      <Reveal show={stage >= 3}>
        <StepCard n={3} title="Run trained Random Forest">
          <Text style={type.sub}>models/wesad_stress_model.joblib → predict_proba(features)</Text>
          {calculating ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
              <ActivityIndicator color={C.lavender} /><Text style={[type.sub, { marginLeft: 10 }]}>calculating across decision trees…</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
              <AnimatedCount value={sc.score} play={stage >= 4} />
              <View style={{ marginLeft: 12 }}><Pill text={sc.pattern} fg={C.lavender} bg={C.lavenderSoft} /></View>
            </View>
          )}
          <Text style={[type.meta, { marginTop: 6 }]}>Physiological stress classification — NOT a PTSD diagnosis.</Text>
        </StepCard>
      </Reveal>

      <Reveal show={stage >= 5}>
        <StepCard n={4} title="Convert score → support level">
          <RiskGauge score={sc.score} thresholds={[0.175, 0.5]} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
            <Text style={type.meta}>baseline &lt; 0.175</Text><Text style={type.meta}>elevated</Text><Text style={type.meta}>high ≥ 0.50</Text>
          </View>
          <Text style={[type.meta, { marginTop: 4 }]}>0.175 is the model's learned detection threshold. The elevated/high split is a prototype product rule.</Text>
          <View style={{ marginTop: 8 }}><Pill text={`support: ${level}`} fg={level === "high" ? C.danger : level === "elevated" ? C.warning : C.success} bg={level === "high" ? C.dangerSoft : level === "elevated" ? C.warningSoft : C.successSoft} /></View>
        </StepCard>
      </Reveal>

      <Reveal show={stage >= 6}>
        <StepCard n={5} title="Return an app action">
          <Row title={level} right={action} />
          <Card style={{ backgroundColor: C.surfaceAlt, marginTop: 8 }}>
            <Text style={{ fontFamily: "Courier", fontSize: 11.5, color: C.textSecondary }}>
{`{
  "physiological_distress_score": ${sc.score},
  "support_level": "${level}",
  "action": "${action}"
}`}
            </Text>
          </Card>
        </StepCard>
        {/* animated handoff to the therapist engine */}
        <Card accent={C.lavender}>
          <View style={{ alignItems: "center" }}>
            <Ionicons name="arrow-down-circle" size={26} color={C.lavender} />
            <Text style={[type.title, { marginTop: 6, textAlign: "center" }]}>Passing this score to the Therapist Engine</Text>
            <Text style={[type.sub, { textAlign: "center", marginTop: 4 }]}>Rules decide first. If the patient speaks, the text is read by the detection models — DistilBERT (78.5%), MiniLM (73.2%), TF-IDF (67.8%).</Text>
            <View style={{ marginTop: 10, alignSelf: "stretch" }}><Btn label="Continue to Therapist Engine" color={C.lavender} icon="arrow-forward" onPress={() => navigation.navigate("TherapistEngineDemo")} /></View>
          </View>
        </Card>
      </Reveal>

      <Card onPress={() => setTech((v) => !v)}>
        <Row icon="construct" iconFg={C.textSecondary} iconBg="#EEF1F6" title="Technical details" right={<Ionicons name={tech ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />} />
        {tech ? (
          <View style={{ marginTop: 8 }}>
            <KV k="Inputs" v="6 arrays × 30 samples" /><KV k="Features" v="16" /><KV k="Model" v="Random Forest (personalized)" />
            <KV k="Dataset" v="WESAD" /><KV k="Calibration" v="per-user calm baseline" /><KV k="Threshold" v="0.175 (learned)" /><KV k="Diagnosis" v="None" />
            <View style={{ marginTop: 8 }}>
              <Text style={[type.meta, { color: C.textSecondary }]}>Personalized leave-one-subject-out (S2/S3/S4 · prototype):</Text>
              <KV k="Accuracy" v="90.9%" /><KV k="Balanced acc" v="92.1%" /><KV k="Precision" v="84.6%" />
              <KV k="Recall" v="95.9%" /><KV k="F1" v="0.889" /><KV k="ROC-AUC" v="0.987" />
              <Text style={[type.meta, { marginTop: 6 }]}>Prototype evaluation on 3 subjects — not clinical validation.</Text>
            </View>
          </View>
        ) : null}
      </Card>
      <Disclaimer />
    </Screen>
  );
}

const Formula = ({ t }) => (
  <View style={{ backgroundColor: C.surfaceAlt, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 6 }}>
    <Text style={{ fontFamily: "Courier", fontSize: 12, color: C.textPrimary }}>{t}</Text>
  </View>
);

// Fades + slides content in when `show` flips true.
function Reveal({ show, children }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (show) Animated.timing(a, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    else a.setValue(0);
  }, [show]);
  if (!show) return null;
  return <Animated.View style={{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>{children}</Animated.View>;
}

// Counts up to `value` (0–1) when play flips true.
function AnimatedCount({ value, play }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!play) return;
    let raf, start;
    const step = (ts) => { if (!start) start = ts; const p = Math.min((ts - start) / 900, 1); setN(value * p); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [play, value]);
  return <Text style={{ fontSize: 38, fontWeight: "800", color: C.textPrimary, letterSpacing: -1 }}>{n.toFixed(2)}</Text>;
}

export function TherapistEngineDemo({ navigation }) {
  return (
    <Screen>
      <AppHeader title="Therapist engine" subtitle="Privacy boundary · authority · validation" onBack={() => navigation.goBack()} />
      <Card accent={C.lavender}>
        <Row icon="shield-checkmark" iconFg={C.lavender} iconBg={C.lavenderSoft} title="Therapist Decision Engine" subtitle="Therapist rules first (authority 1.0) · AI only for unseen moments" />
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8 }}>
          <Pill text="DistilBERT · 78.5%" fg={C.lavender} bg={C.lavenderSoft} />
          <View style={{ width: 6 }} /><Pill text="MiniLM · 73.2%" fg={C.teal} bg={C.tealSoft} />
          <View style={{ width: 6 }} /><Pill text="TF-IDF · 67.8%" fg={C.warning} bg={C.warningSoft} />
        </View>
        <Text style={[type.meta, { marginTop: 8 }]}>Text understanding uses these models. The rule hierarchy — not the AI — has final authority.</Text>
      </Card>
      <SectionTitle>1 · Identity record</SectionTitle>
      <Card accent={C.primary}><Row icon="finger-print" title="Identity store" subtitle="The one place direct identity lives" />
        <View style={{ marginTop: 8 }}><KV k="internal_patient_id" v="P-001" /><KV k="display_name" v="Alex Johnson" /><KV k="email" v="alex@example.com" /><KV k="cognito_user_id" v="cognito-abc-123" /><KV k="role" v="PATIENT" /></View>
      </Card>
      <View style={{ alignItems: "center", paddingVertical: 6 }}><Pill text="linked only by P-001" fg={C.textSecondary} bg="#EEF1F6" icon="link" /></View>
      <SectionTitle>2 · Clinical profile (knows only P-001)</SectionTitle>
      <Card accent={C.teal}><Row icon="medkit" iconFg={C.teal} iconBg={C.tealSoft} title="Clinical store" subtitle="No name · no email" />
        <View style={{ marginTop: 8 }}><KV k="patient_id" v="P-001" /><KV k="triggers" v="crowds, loud bangs" /><KV k="approved" v="calm mode, breathing" /><KV k="forbidden" v="flashing lights" /><KV k="baseline HR" v="68" /></View>
      </Card>
      <SectionTitle>3 · Therapist rule (highest authority)</SectionTitle>
      <Card accent={C.lavender}><Row icon="shield-checkmark" iconFg={C.lavender} iconBg={C.lavenderSoft} title="TR-001" subtitle="Therapist rule > AI reasoning" />
        <View style={{ marginTop: 8 }}><KV k="min_risk_level" v="HIGH" /><KV k="trigger_conditions" v='["crowd"]' /><KV k="approved_action" v="offer calm mode" /><KV k="ai_override_allowed" v="false" /><KV k="priority" v="10" /></View>
      </Card>
      <SectionTitle>4 · Validation (Pydantic guards)</SectionTitle>
      <Card><Row icon="close-circle" iconFg={C.danger} iconBg={C.dangerSoft} title="known_triggers = [123]" right={<Pill text="Rejected" fg={C.danger} bg={C.dangerSoft} />} /></Card>
      <Card><Row icon="close-circle" iconFg={C.danger} iconBg={C.dangerSoft} title='email = "not-an-email"' right={<Pill text="Rejected" fg={C.danger} bg={C.dangerSoft} />} /></Card>
      <Text style={[type.meta, { marginTop: 8 }]}>Validation protects the data boundary before the decision engine runs.</Text>
      <Disclaimer />
    </Screen>
  );
}

export function DecisionDemo({ navigation }) {
  const { addDecision } = useApp();
  const [mode, setMode] = useState("ai");
  const [scenario, setScenario] = useState("seen");
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [out, setOut] = useState(null);

  const scenarios = DEMO_SCENARIOS;
  async function run() {
    const s = scenarios[scenario];
    setLoading(true); setOut(null);
    try {
      let result;
      if (live) {
        const r = await apiCall("/api/decide", { patient_id: "P-001", risk_level: s.riskLevel, risk_score: s.score, observed_triggers: s.triggers, mode });
        result = { decision_source: r.decision.decision_source, action: r.decision.selected_action, confidence: r.decision.confidence, reason_code: r.decision.reason_code, message: r.spoken_message, safety: "passed", rule_id: r.decision.therapist_rule_id, observed: s.triggers, risk_level: s.riskLevel };
      } else {
        if (s.forceUnsafe) {
          const guard = makeSafe("You are completely safe and you are having a panic attack. Take your medication.");
          result = {
            decision_source: "safe_fallback", rule_id: null, action: "offer neutral grounding; flag for therapist review",
            confidence: 0.3, reason_code: `ai message blocked: ${guard.reason}`, message: guard.safe,
            safety: `blocked (${guard.reason})`, risk_level: s.riskLevel, observed: s.triggers,
          };
        } else {
          result = processMoment({ patient: EXAMPLE_PATIENT, riskLevel: s.riskLevel, observedTriggers: s.triggers, mode: s.mode || mode });
        }
      }
      setOut(result);
      addDecision(makeDecisionRecord(EXAMPLE_PATIENT.id, result, s.score));
    } catch {
      const fallback = s.forceUnsafe ? { decision_source: "safe_fallback", rule_id: null, action: "offer neutral grounding; flag for therapist review", confidence: 0.3, reason_code: "live engine unavailable during unsafe scenario", message: "I'm here with you. Let's take this one breath at a time.", safety: "fallback", risk_level: s.riskLevel, observed: s.triggers } : processMoment({ patient: EXAMPLE_PATIENT, riskLevel: s.riskLevel, observedTriggers: s.triggers, mode: s.mode || mode });
      setOut(fallback);
      setLive(false);
    } finally { setLoading(false); }
  }

  return (
    <Screen>
      <AppHeader title="Decision & safety" subtitle="Therapist rules first · AI only for unseen" onBack={() => navigation.goBack()} />
      <SectionTitle>Scenario</SectionTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{Object.keys(scenarios).map((k) => <Chip key={k} label={scenarios[k].label} active={scenario === k} onPress={() => { setScenario(k); if (scenarios[k].mode) setMode(scenarios[k].mode); setOut(null); }} />)}</View>
      <SectionTitle>Mode</SectionTitle>
      <View style={{ flexDirection: "row" }}>
        <Chip label="Rules only" active={mode === "rules_only"} onPress={() => setMode("rules_only")} />
        <Chip label="Rules + AI" active={mode === "ai"} onPress={() => setMode("ai")} />
        <Chip label={live ? "Live" : "Demo"} active={live} onPress={() => setLive((v) => !v)} />
      </View>
      <View style={{ marginTop: spacing.md }}><Btn label="Run this moment" icon="play" onPress={run} /></View>
      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 14 }} /> : null}
      {out ? (
        <Card accent={out.decision_source === "therapist_rule" ? C.primary : out.decision_source === "ai_reasoning" ? C.lavender : C.textMuted}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <DecisionSourceBadge source={out.decision_source} />
            <Pill text={`conf ${out.confidence}`} fg={C.textSecondary} bg="#EEF1F6" />
          </View>
          {out.rule_id ? <Text style={[type.sub, { marginTop: 8 }]}>Matched rule: {out.rule_id}</Text> : <Text style={[type.sub, { marginTop: 8 }]}>No therapist rule matched.</Text>}
          <Text style={[type.title, { marginTop: 4 }]}>Action: {out.action}</Text>
          <Text style={[type.body, { marginTop: 8 }]}>“{out.message}”</Text>
          <Text style={[type.meta, { marginTop: 8 }]}>reason: {out.reason_code} · safety: {out.safety}</Text>
          {out.decision_source === "therapist_rule" ? <View style={{ marginTop: 8 }}><Pill text="Therapist-approved rule applied — AI not needed" fg={C.primary} bg={C.primarySoft} /></View> : null}
        </Card>
      ) : null}

      <SectionTitle>Safety layer (fail-closed)</SectionTitle>
      <Text style={type.meta}>Unsafe wording is discarded and replaced with the safe fallback.</Text>
      <SafetyRow text="Would it help to use your breathing exercise?" />
      <SafetyRow text="You are completely safe." />
      <SafetyRow text="You are having a panic attack." />
      <SafetyRow text="Take your medication." />
      <Disclaimer />
    </Screen>
  );
}

function SafetyRow({ text }) {
  const [r, setR] = useState(null);
  return (
    <Card onPress={() => setR(makeSafe(text))}>
      <Text style={type.body}>“{text}”</Text>
      {r ? (
        r.blocked ? (
          <View style={{ marginTop: 8 }}>
            <Pill text={`Blocked · ${r.reason}`} fg={C.danger} bg={C.dangerSoft} icon="close-circle" />
            <Text style={[type.sub, { marginTop: 6 }]}>Message blocked by safety layer → safe fallback used:</Text>
            <Text style={[type.body, { marginTop: 2 }]}>“{r.safe}”</Text>
          </View>
        ) : <View style={{ marginTop: 8 }}><Pill text="Passed" fg={C.success} bg={C.successSoft} icon="checkmark-circle" /></View>
      ) : <Text style={[type.meta, { marginTop: 6 }]}>Tap to check</Text>}
    </Card>
  );
}

export function FullPipeline({ navigation }) {
  const stages = [
    ["Wearable", "watch", "HR · EDA · TEMP · ACC · IBI/HRV → 30-sec window", C.teal, C.tealSoft],
    ["Risk engine", "pulse", "30-sec → 16 features → Random Forest → 0.62 (elevated)", C.primary, C.primarySoft],
    ["Therapist engine", "shield-checkmark", "Rules first · AI only if unseen", C.lavender, C.lavenderSoft],
    ["Safety layer", "lock-closed", "Blocks diagnosis · medication · false guarantees", C.warning, C.warningSoft],
    ["Mobile experience", "phone-portrait", "Patient: calm action · Therapist: full audit", C.success, C.successSoft],
  ];
  return (
    <Screen>
      <AppHeader title="Full pipeline" subtitle="One moment, end to end" onBack={() => navigation.goBack()} />
      {stages.map(([t, ic, s, fg, bg], i) => (
        <View key={t}>
          <Card><Row icon={ic} iconFg={fg} iconBg={bg} title={`${i + 1}. ${t}`} subtitle={s} /></Card>
          {i < stages.length - 1 ? <View style={{ alignItems: "center", paddingVertical: 2 }}><Ionicons name="arrow-down" size={18} color={C.textMuted} /></View> : null}
        </View>
      ))}
      <Card accent={C.primary} style={{ marginTop: spacing.lg }}>
        <Text style={type.title}>Designed to feel simple — built to be explainable</Text>
        <Text style={[type.sub, { marginTop: 6 }]}>The patient sees a calm action. The therapist sees the risk, signals, rule, action, source, confidence and audit.</Text>
      </Card>
      <Disclaimer />
    </Screen>
  );
}

export function PrivacyScreen({ navigation }) {
  return (
    <Screen>
      <AppHeader title="Data privacy" subtitle="Identity separated from clinical data" onBack={() => navigation.goBack()} />
      <Card accent={C.primary}><Row icon="finger-print" title="Identity store" subtitle="name · email · Cognito id · role" />
        <Text style={[type.body, { marginTop: 8 }]}>Alex Johnson · alex@example.com</Text></Card>
      <View style={{ alignItems: "center", paddingVertical: 6 }}><Ionicons name="arrow-down" size={18} color={C.textMuted} /><Pill text="P-001" fg={C.primary} bg={C.primarySoft} /></View>
      <Card accent={C.teal}><Row icon="medkit" iconFg={C.teal} iconBg={C.tealSoft} title="Clinical store" subtitle="triggers · interventions · baseline · rules" />
        <Text style={[type.body, { marginTop: 8 }]}>P-001 · crowds · loud bangs · calm mode</Text>
        <Text style={[type.meta, { marginTop: 6 }]}>No name. No email. Only the codename P-001.</Text></Card>
      <Disclaimer />
    </Screen>
  );
}

const StepCard = ({ n, title, children }) => (
  <Card>
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.primary, alignItems: "center", justifyContent: "center", marginRight: 8 }}>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 12 }}>{n}</Text>
      </View>
      <Text style={type.title}>{title}</Text>
    </View>
    {children}
  </Card>
);
const KV = ({ k, v }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
    <Text style={type.sub}>{k}</Text><Text style={{ fontWeight: "700", color: C.textPrimary, maxWidth: "58%", textAlign: "right" }}>{v}</Text>
  </View>
);
