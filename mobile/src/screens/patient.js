// Patient home, support, progress, messages and profile.
import React, { useState, useEffect, useMemo } from "react";
import { View, Text, TouchableOpacity, Switch, ActivityIndicator, Image, Alert, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type, gradients } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, IconChip, Btn, Pill, Chip, ProgressBar, EmptyState, Disclaimer, Divider, HeroAction, GradientCard, StatTile, SupportOrb } from "../components/ui";
import { TrendChart, AreaChart, DayChart } from "../components/charts";
import { StabilityCheck } from "../components/stability";
import { Avatar } from "./therapist";
import { useApp } from "../state/AppContext";
import { reportSyncFailure } from "../services/errors";
import { speak as speakSafely, stopSpeaking, SPEECH_PRIORITY } from "../services/speech";
import { techniqueById, matchTechnique, classifyAction, ACTION_KIND } from "../data/grounding";
import { requestAppointment } from "../services/alerts";
import * as Speech from "expo-speech";
import { getSessions, getMediaViewUrl, getDecisions } from "../services/engine";

function useMe() { const { currentPatientId, patient } = useApp(); return patient(currentPatientId); }
function useTherapistName() { const { authUser } = useApp(); return authUser?.therapistName || "your therapist"; }

export function PatientHome({ navigation }) {
  const { devices, vitals, events, currentPatientId, authUser, patient,
          messagesFor, toggleMedicationTaken, prefs, setPref } = useApp();
  // The episode lives outside React state, so closing one has to force a
  // re-render here or the card stays on screen after it is gone.
  const [episodeTick, setEpisodeTick] = useState(0);
  const ctxActive = !!(prefs?.declaredContext && prefs.declaredContext.expires_at > Date.now());
  const ctxHoursLeft = ctxActive
    ? Math.max(1, Math.round((prefs.declaredContext.expires_at - Date.now()) / 3600000)) : 0;
  const firstName = (authUser?.name || "there").split(" ")[0];
  const therapistName = useTherapistName();
  const me = patient ? patient(currentPatientId) : null;

  const today = new Date();
  const dateLine = today.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  const next = events.filter((e) => e.patientId === currentPatientId)[0];

  const meds = me?.medications || [];
  const dueIdx = meds.findIndex((m) => !m.takenToday);
  const medIdx = dueIdx >= 0 ? dueIdx : (meds.length ? 0 : -1);
  const dueMed = medIdx >= 0 ? { ...meds[medIdx], index: medIdx } : null;

  const [recent, setRecent] = useState(null);
  useEffect(() => {
    let alive = true;
    getSessions(currentPatientId)
      .then((r) => {
        if (!alive) return;
        const rows = (r?.sessions || [])
          .filter((x) => ["voice_transcription", "trigger_event", "check_in_response"].includes(x.type))
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        setRecent(rows[0] || null);
      })
      .catch(() => { if (alive) setRecent(null); });
    return () => { alive = false; };
  }, [currentPatientId]);

  const threadMsgs = messagesFor ? messagesFor(currentPatientId) : [];
  const lastTherapistMsg = [...threadMsgs].reverse()
    .find((m) => (m.channel || "therapist") === "therapist" && m.from !== "patient");

  const unread = 0;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.metric, { fontSize: 26 }]}>{`Hello, ${firstName}`}</Text>
          <Text style={[type.sub, { marginTop: 2 }]}>{dateLine}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate("Notifications")}
          accessibilityLabel="Notifications"
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.surfaceStrong,
                   alignItems: "center", justifyContent: "center", marginRight: 8 }}>
          <Ionicons name="notifications-outline" size={20} color={C.textPrimary} />
          {unread > 0 ? (
            <View style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8,
                           borderRadius: 4, backgroundColor: C.danger }} />
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate("Profile")} accessibilityLabel="Your profile">
          <Avatar name={authUser?.name || firstName} size={42}
            s3Key={me?.avatarS3Key} patientId={currentPatientId} />
        </TouchableOpacity>
      </View>

      <GradientCard>
        <Text style={[type.title, { color: C.textOnDark, fontSize: 17 }]}>
          {devices?.watch || vitals?.hr != null ? "Companio is active" : "Companio is here"}
        </Text>
        <Text style={[type.sub, { color: C.textMutedOnDark, marginTop: 6 }]}>
          {devices?.watch ? "Watch connected · monitoring your signals"
            : vitals?.hr != null ? "Reading your signals from Apple Health"
            : "No watch connected — you can still ask for support any time"}
        </Text>
        {recent?.created_at ? (
          <Text style={[type.meta, { color: C.textMutedOnDark, marginTop: 8 }]}>
            {`Last check-in: ${timeAgo(recent.created_at)}`}
          </Text>
        ) : null}
      </GradientCard>

      <Card>
        <Text style={[type.title, { textAlign: "center", fontSize: 18 }]}>How are you feeling?</Text>
        <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
          <SupportOrb mode="idle" onPress={() => navigation.navigate("Companio")} />
        </View>
        <Btn label="Talk to Companio" icon="mic" onPress={() => navigation.navigate("Companio")} />
        <View style={{ flexDirection: "row", marginTop: spacing.sm }}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Btn label="Type instead" icon="create" variant="outline"
              onPress={() => navigation.navigate("Companio")} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn label="Quick support" icon="leaf" variant="outline"
              onPress={() => navigation.navigate("GroundingLibrary")} />
          </View>
        </View>
      </Card>

      <StabilityCheck key={episodeTick} patientId={currentPatientId} onClosed={() => setEpisodeTick((n) => n + 1)} />

      {ctxActive ? (
        <Card accent={C.success}>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
            title="Companio knows what you're doing"
            subtitle={`${prefs.declaredContext.labels?.join(", ")} · ${ctxHoursLeft}h left`} />
          <Btn label="I've finished" icon="close" variant="outline"
            onPress={() => setPref("declaredContext", null)} />
        </Card>
      ) : (
        <Card>
          <Text style={type.title}>Doing something that'll change how your body feels?</Text>
          <Text style={[type.sub, { marginTop: 4 }]}>
            Tell Companio so it doesn't mistake it for distress. It keeps watching either way.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
            {[
              ["exercise", "I've started exercising", "walk", 3],
              ["caffeine", "Just had coffee", "cafe", 5],
              ["horror", "Watching something intense", "film", 3],
            ].map(([id, label, icon, hours]) => (
              <TouchableOpacity key={id} activeOpacity={0.78}
                onPress={() => setPref("declaredContext", {
                  ids: [id], labels: [label], note: null,
                  declared_at: Date.now(),
                  expires_at: Date.now() + hours * 3600000,
                })}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10,
                         paddingHorizontal: 14, borderRadius: radius.pill, marginRight: 8,
                         marginBottom: 8, backgroundColor: C.surfaceStrong }}>
                <Ionicons name={icon} size={16} color={C.primary} />
                <Text style={{ marginLeft: 7, fontWeight: "700", fontSize: 13.5, color: C.textPrimary }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Row icon="ellipsis-horizontal" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
            title="Something else" subtitle="Exam, travel, feeling unwell, barely slept…"
            right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
            onPress={() => navigation.navigate("DeclareContext")} />
        </Card>
      )}

      {vitals?.activeNow && (vitals.activityReasons || []).length ? (
        <Card>
          <Row icon="walk" iconFg={C.success} iconBg={C.successSoft}
            title="Companio can see you're moving"
            subtitle={vitals.activityReasons.join(" · ")} />
        </Card>
      ) : null}

      <SectionTitle>Today</SectionTitle>
      <Card onPress={() => navigation.navigate("Care")}>
        <Row icon="calendar" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
          title={next ? `${next.date} · ${next.time}` : "No session scheduled"}
          subtitle={next ? `${therapistName} · ${next.type}` : `Your therapist: ${therapistName}`}
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>
      {dueMed ? (
        <Card>
          <Row icon="medkit" iconFg={C.danger} iconBg={C.dangerSoft}
            title={`${dueMed.name}${dueMed.dose ? ` · ${dueMed.dose}` : ""}`}
            subtitle={dueMed.takenToday ? "Taken today" : (dueMed.frequency || "Due today")} />
          {!dueMed.takenToday ? (
            <Btn label="Mark taken" icon="checkmark"
              onPress={() => toggleMedicationTaken?.(currentPatientId, dueMed.index)} />
          ) : null}
        </Card>
      ) : null}

      {recent || lastTherapistMsg ? (
        <>
          <SectionTitle>Recent</SectionTitle>
          {recent ? (
            <Card onPress={() => navigation.navigate("Companio")}>
              <Row icon={recent.type === "voice_transcription" ? "mic" : "camera"}
                iconFg={C.primary} iconBg={C.primarySoft}
                title={recent.type === "voice_transcription" ? "Voice session" : "Support session"}
                subtitle={timeAgo(recent.created_at)}
                right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
            </Card>
          ) : null}
          {lastTherapistMsg ? (
            <Card onPress={() => navigation.navigate("Conversation", { patientId: currentPatientId, viewerRole: "patient" })}>
              <Row icon="chatbubbles" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
                title={`${therapistName} replied`}
                subtitle={lastTherapistMsg.text?.slice(0, 60)}
                right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
            </Card>
          ) : null}
        </>
      ) : null}

      <Disclaimer />
    </Screen>
  );
}

function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function MomentImage({ s3Key, patientId }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getMediaViewUrl(s3Key, patientId)
      .then((r) => { if (!cancelled) setUrl(r?.url || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [s3Key, patientId]);
  if (!url) return null;
  return (
    <Image source={{ uri: url }}
      style={{ width: "100%", height: 160, borderRadius: radius.md, marginTop: 10 }}
      resizeMode="cover" />
  );
}

function Vital({ label, value, unit }) { return <View style={{ width: "31%" }}><Text style={type.meta}>{label}</Text><Text style={[type.metric, { fontSize: 27, marginTop: 4 }]}>{value}</Text><Text style={type.sub}>{unit}</Text></View>; }

const STEP_SECONDS = 12;

const STEPS = [
  { n: 5, icon: "eye", title: "5 things you can see", sub: "Look around and name five things." },
  { n: 4, icon: "ear", title: "4 things you can hear", sub: "Listen and name four sounds." },
  { n: 3, icon: "hand-left", title: "3 things you can feel", sub: "Notice three physical sensations." },
  { n: 2, icon: "flower", title: "2 things you can smell", sub: "Take a breath and notice two smells." },
  { n: 1, icon: "cafe", title: "1 thing you can taste", sub: "Notice one taste in your mouth." },
];

export function PatientSupport({ navigation, route }) {
  const therapistName = useTherapistName();
  const me = useMe();
  const resource = useMemo(() => {
    const map = me?.treatmentPlan?.interventionResources || {};
    const key = route?.params?.action || route?.params?.techniqueId;
    if (!key) return null;
    if (map[key]) return map[key];
    const hit = Object.keys(map).find((k) => k.toLowerCase() === String(key).toLowerCase());
    return hit ? map[hit] : null;
  }, [me?.treatmentPlan?.interventionResources, route?.params?.action, route?.params?.techniqueId]);

  const { prefs } = useApp();

  const plan = useMemo(() => {
    if (route?.params?.techniqueId) {
      const t = techniqueById(route.params.techniqueId);
      if (t) return { kind: ACTION_KIND.GUIDED, technique: t, action: t.name, control: null };
    }
    if (route?.params?.action) return classifyAction(route.params.action);
    return { kind: ACTION_KIND.GUIDED, technique: techniqueById("sensory_54321"), action: null, control: null };
  }, [route?.params?.techniqueId, route?.params?.action]);

  const technique = plan.technique;
  const steps = technique?.steps?.length ? technique.steps : STEPS;
  const [step, setStep] = useState(0);
  const current = steps[Math.min(step, steps.length - 1)];
  const [autoGuide, setAutoGuide] = useState(route?.params?.auto !== false);

  useEffect(() => {
    if (!autoGuide) return;
    const line = `${current.title}. ${current.sub}`;
    speakSafely(line, prefs, SPEECH_PRIORITY.SUPPORT, { rate: 0.88 });
  }, [step, autoGuide, prefs]);

  useEffect(() => {
    if (!autoGuide) return;
    const t = setTimeout(() => setStep((n) => (n < steps.length - 1 ? n + 1 : n)), STEP_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [step, autoGuide, steps.length]);

  useEffect(() => () => { stopSpeaking(); }, []);

  useEffect(() => {
    if (plan.kind === ACTION_KIND.GUIDED || !plan.action) return;
    speakSafely(
      `${therapistName || "Your therapist"} suggests: ${plan.action}.`,
      prefs, SPEECH_PRIORITY.SUPPORT,
    );
  }, [plan.kind, plan.action, prefs]);

  if (plan.kind !== ACTION_KIND.GUIDED) {
    const control = plan.control;
    return (
      <Screen>
        <AppHeader eyebrow="FROM YOUR CARE PLAN" title="Something that helps you"
          subtitle={therapistName
            ? `${therapistName} chose this for you.`
            : "This is from your care plan."}
          onBack={() => navigation.goBack()} />
        <Card accent={C.primary}>
          <Text style={[type.metric, { fontSize: 22, lineHeight: 30 }]}>{plan.action}</Text>
          <Text style={[type.sub, { marginTop: 10 }]}>
            Companio doesn't guide this one step by step — it's your therapist's own suggestion, in their words.
          </Text>
        </Card>

        {resource?.url ? (
          <Card accent={C.primary}>
            <Row icon="play-circle" iconFg={C.primary} iconBg={C.primarySoft}
              title="Your therapist attached this"
              subtitle={resource.url} />
            <Btn label="Open it" icon="open-outline"
              onPress={() => Linking.openURL(resource.url).catch(() => {
                Alert.alert("Could not open", "That link could not be opened on this device.");
              })} />
          </Card>
        ) : null}

        {control ? (
          <Card>
            <Row icon={control.icon} iconFg={C.primary} iconBg={C.primarySoft}
              title={control.label} subtitle={control.hint} />
            <Btn label={control.label} icon={control.icon}
              onPress={() => {
                if (control.id === "open_music") Linking.openURL("music://").catch(() => {});
                else if (control.id === "call_therapist") navigation.navigate("RequestSupport");
                else if (control.id === "call_caregiver" || control.id === "make_call") navigation.navigate("Care");
                else if (control.id === "timer") setStep(0);
              }} />
          </Card>
        ) : null}

        <Card>
          <Row icon="leaf" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
            title="Try something else instead"
            subtitle="Other ways to steady yourself, including the ones chosen for you."
            onPress={() => navigation.navigate("GroundingLibrary")} />
        </Card>
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader eyebrow="PRIVATE SUPPORT" title="Let's focus on what's around you" subtitle="One small step at a time." onBack={() => navigation.goBack()} />
      <View style={{ marginTop: 20, minHeight: 330, justifyContent: "center" }}>
        <Text style={[type.meta, { color: C.teal }]}>STEP {step + 1} OF 5</Text>
        <IconChip icon={current.icon} fg={C.teal} bg={C.tealSoft} size={58} />
        <Text style={[type.hero, { fontSize: 34, lineHeight: 39, marginTop: 20 }]}>{current.title}</Text>
        <Text style={[type.body, { color: C.textSecondary, marginTop: 10, maxWidth: 310 }]}>{current.sub}</Text>
        <ProgressBar value={((step + 1) / 5) * 100} color={C.teal} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.sm }}>
        <Ionicons name={autoGuide ? "volume-high" : "volume-mute"} size={18} color={C.teal} />
        <Text style={[type.sub, { flex: 1, marginLeft: 8 }]}>
          {autoGuide ? `Companio is guiding you out loud · ${STEP_SECONDS}s per step` : "Guiding is off — tap Next when you're ready"}
        </Text>
        <Switch value={autoGuide} onValueChange={(v) => { setAutoGuide(v); if (!v) { try { Speech.stop(); } catch {} } }} />
      </View>
      <Btn label={step === 4 ? "I'm okay now" : "Next"} color={C.teal} icon={step === 4 ? "heart" : "arrow-forward"}
        onPress={() => { try { Speech.stop(); } catch {} setStep((s) => s === 4 ? 0 : s + 1); }} />
      {step > 0 ? <Btn label="Previous" color={C.textSecondary} variant="ghost" onPress={() => setStep((s) => Math.max(0, s - 1))} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 22 }}><Ionicons name="lock-closed" size={13} color={C.textMuted} /><Text style={[type.meta, { marginLeft: 5 }]}>Private and discreet</Text></View>
      <Disclaimer />
    </Screen>
  );
}

export function PatientProgress({ navigation }) {
  const { currentPatientId } = useApp();
  const [snaps, setSnaps] = useState(null);
  const [events, setEvents] = useState(null);
  const [decisions, setDecisions] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getSessions(currentPatientId).catch(() => null),
      getDecisions(currentPatientId).catch(() => null),
    ]).then(([s, d]) => {
      if (!alive) return;
      const rows = s?.sessions || [];
      setSnaps(rows.filter((x) => x.type === "daily_snapshot")
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
      setEvents(rows.filter((x) =>
        ["voice_transcription", "trigger_event", "check_in_response", "call_request", "emergency_alert"]
          .includes(x.type))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
      setDecisions(d?.decisions || []);
    });
    return () => { alive = false; };
  }, [currentPatientId]);

  const loading = snaps === null;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const inWeek = (x) => new Date(x.created_at || x.timestamp || 0).getTime() >= weekAgo;

  const checkIns = (events || []).filter((e) =>
    inWeek(e) && ["voice_transcription", "check_in_response", "trigger_event"].includes(e.type)).length;
  const improved = (decisions || []).filter((d) => inWeek(d) && d.patient_reported_helped === true).length;
  const contacts = (events || []).filter((e) =>
    inWeek(e) && ["call_request", "emergency_alert"].includes(e.type)).length;

  const helpfulness = (decisions || []).reduce((acc, d) => {
    if (typeof d.patient_reported_helped !== "boolean" || !d.selected_action) return acc;
    const k = d.selected_action;
    acc[k] = acc[k] || { helped: 0, total: 0 };
    acc[k].total += 1;
    if (d.patient_reported_helped) acc[k].helped += 1;
    return acc;
  }, {});
  const whatHelped = Object.entries(helpfulness)
    .filter(([, v]) => v.helped > 0)
    .sort((a, b) => b[1].helped - a[1].helped)
    .slice(0, 5);

  const sleepSeries = (snaps || []).filter((r) => r.sleep_hours_last_night != null)
    .map((r) => Number(r.sleep_hours_last_night));
  const stepSeries = (snaps || []).filter((r) => r.steps != null).map((r) => Number(r.steps));

  return (
    <Screen>
      <AppHeader eyebrow="MY PROGRESS" title="Your recent support"
        subtitle="A simple summary you can talk through with your therapist." />

      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} /> : null}

      {!loading ? (
        <>
          <SectionTitle>This week</SectionTitle>
          <Card>
            <Row icon="chatbubbles" iconFg={C.primary} iconBg={C.primarySoft}
              title={`${checkIns} support check-in${checkIns === 1 ? "" : "s"}`}
              subtitle={checkIns ? "Times Companio was with you" : "None yet this week"} />
            <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
              title={`${improved} time${improved === 1 ? "" : "s"} you said it helped`}
              subtitle="Based on your own answers" />
            <Row icon="medkit" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
              title={`${contacts} therapist contact${contacts === 1 ? "" : "s"}`}
              subtitle={contacts ? "Requests you made" : "You haven't needed to reach out"} />
          </Card>
        </>
      ) : null}

      {sleepSeries.length > 1 || stepSeries.length > 1 ? (
        <>
          <SectionTitle sub="From your watch and phone. Not a measure of how you're doing.">
            Physiological patterns
          </SectionTitle>
          {sleepSeries.length > 1 ? (
            <Card><TrendChart label="Sleep (hours)" data={sleepSeries} color={C.lavender}
              avg={(sleepSeries.reduce((a, b) => a + b, 0) / sleepSeries.length).toFixed(1)} /></Card>
          ) : null}
          {stepSeries.length > 1 ? (
            <Card><TrendChart label="Steps" data={stepSeries} color={C.primary} /></Card>
          ) : null}
        </>
      ) : !loading ? (
        <Card>
          <EmptyState icon="stats-chart" title="Not enough data yet"
            sub="Patterns appear once Companio has recorded a few days." />
        </Card>
      ) : null}

      {whatHelped.length ? (
        <>
          <SectionTitle sub="Counted from what you told Companio afterwards.">What helped recently</SectionTitle>
          <Card>
            {whatHelped.map(([action, v]) => (
              <Row key={action} icon="leaf" iconFg={C.success} iconBg={C.successSoft}
                title={action}
                subtitle={`Helped ${v.helped} of ${v.total} time${v.total === 1 ? "" : "s"}`} />
            ))}
          </Card>
        </>
      ) : null}

      {(events || []).length ? (
        <>
          <SectionTitle>Recent</SectionTitle>
          {(events || []).slice(0, 6).map((e, i) => {
            const d = (decisions || []).find((x) => x.episode_id && x.episode_id === e.episode_id);
            const helped = d?.patient_reported_helped;
            return (
              <Card key={e.session_id || i}>
                <Row
                  icon={e.type === "voice_transcription" ? "mic"
                    : e.type === "trigger_event" ? "camera" : "help-buoy"}
                  iconFg={C.primary} iconBg={C.primarySoft}
                  title={e.normalized_visual_trigger || (
                    e.type === "voice_transcription" ? "Voice check-in" : "Support")}
                  subtitle={e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                  right={typeof helped === "boolean"
                    ? <Pill text={helped ? "Helped" : "Didn't help"}
                        fg={helped ? C.success : C.textSecondary}
                        bg={helped ? C.successSoft : C.surfaceStrong} />
                    : null} />
              </Card>
            );
          })}
        </>
      ) : null}

      <Disclaimer />
    </Screen>
  );
}

export function PatientMessages({ navigation }) {
  const [tab, setTab] = useState("Messages"); const { messagesFor, currentPatientId, events, sendMessage } = useApp();
  const therapistName = useTherapistName();
  const [apptBusy, setApptBusy] = useState(false);
  const [apptSent, setApptSent] = useState(false);
  const thread = messagesFor(currentPatientId); const last = thread[thread.length - 1]; const appts = events.filter((e) => e.patientId === currentPatientId); const openChat = () => navigation.navigate("Conversation", { patientId: currentPatientId, viewerRole: "patient" });

  async function askForAppointment() {
    setApptBusy(true);
    try {
      await requestAppointment(currentPatientId);
    } catch (e) {
      reportSyncFailure("appointment_request", e, { critical: true });
      Alert.alert("Request not sent",
        `Your appointment request could not be sent.\n\n${String(e?.message || e)}\n\nPlease try again in a moment.`);
      return;
    }
    sendMessage(currentPatientId, "patient", "📅 I asked to book an appointment.");
    setApptSent(true);
    setApptBusy(false);
  }
  return (
    <Screen>
      <AppHeader eyebrow="SECURE" title="Messages" subtitle="Private communication with your care team." />
      <View style={{ flexDirection: "row" }}>{["Messages", "Appointments"].map((t) => <Chip key={t} label={t} active={tab === t} onPress={() => setTab(t)} />)}</View>
      <SectionTitle>{tab}</SectionTitle>
      {tab === "Messages" ? <TouchableOpacity onPress={openChat} activeOpacity={0.72}><View style={{ paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}><Row icon="person-circle" title={therapistName} subtitle={last ? last.text : "Start a conversation"} right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} /></View></TouchableOpacity> : (
        <>
          {appts.length === 0
            ? <Card><EmptyState icon="calendar" title="No appointments" sub="Your therapist hasn't scheduled a session yet." /></Card>
            : appts.map((e) => <Card key={e.id}><Row icon="calendar" iconFg={C.accentBlue} iconBg={C.accentBlueSoft} title={`${e.date} · ${e.time}`} subtitle={`${e.type} · ${e.mode}`} right={<Pill text="Scheduled" fg={C.success} bg={C.successSoft} />} /></Card>)}
          {apptSent
            ? <Card accent={C.success}><Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft} title="Request sent" subtitle={`${therapistName} will see this and get back to you.`} /></Card>
            : <Btn label={apptBusy ? "Sending…" : "Request an appointment"} icon="calendar" onPress={askForAppointment} disabled={apptBusy} />}
        </>
      )}
      {tab === "Messages" ? <Btn label="Message your therapist" icon="create" onPress={openChat} /> : null}
    </Screen>
  );
}

export function PatientProfile({ navigation }) {
  const { signOut, devices, authUser, currentPatientId, prefs, setPref,
          isMonitoringPaused, monitoringPausedUntil } = useApp();
  const therapistName = useTherapistName();
  const me = useMe();
  const firstName = (authUser?.name || "there").split(" ")[0];

  const Toggle = ({ icon, tint, title, sub, value, onChange, disabled }) => (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surfaceStrong,
                     alignItems: "center", justifyContent: "center", marginRight: 11 }}>
        <Ionicons name={icon} size={18} color={tint || C.primary} />
      </View>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={type.title}>{title}</Text>
        {sub ? <Text style={[type.sub, { marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      <Switch value={!!value} onValueChange={onChange} disabled={disabled} />
    </View>
  );

  const paused = isMonitoringPaused ? isMonitoringPaused() : false;

  return (
    <Screen>
      <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate("ProfilePhoto")}>
          <Avatar name={authUser?.name || firstName} size={82}
            s3Key={me?.avatarS3Key} patientId={currentPatientId} />
          <View style={{ position: "absolute", right: -2, bottom: -2, width: 28, height: 28,
                         borderRadius: 14, backgroundColor: C.primary,
                         alignItems: "center", justifyContent: "center",
                         borderWidth: 2, borderColor: C.background }}>
            <Ionicons name="camera" size={14} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={[type.metric, { fontSize: 21, marginTop: 12 }]}>{authUser?.name || firstName}</Text>
        <Text style={type.sub}>{me?.avatarS3Key ? "Tap your photo to change it" : "Tap to add a photo"}</Text>
      </View>

      <SectionTitle>Devices</SectionTitle>
      <Card onPress={() => navigation.navigate("Devices")}>
        <Row icon="watch" iconFg={C.primary} iconBg={C.primarySoft} title="Apple Watch"
          right={<Pill text={devices?.watch ? "Connected" : "Not connected"}
            fg={devices?.watch ? C.success : C.textSecondary}
            bg={devices?.watch ? C.successSoft : C.surfaceStrong} />} />
        <Row icon="camera" iconFg={C.lavender} iconBg={C.lavenderSoft} title="Phone camera"
          right={<Pill text="Available" fg={C.success} bg={C.successSoft} />} />
        <Row icon="glasses" iconFg={C.textMuted} iconBg={C.surfaceStrong} title="Smart glasses"
          subtitle="Hardware support not built yet — the phone camera acts as the glasses"
          right={<Pill text="Unavailable" fg={C.textSecondary} bg={C.surfaceStrong} />} />
        <Row icon="pulse" iconFg={C.teal} iconBg={C.tealSoft} title="Baseline"
          subtitle={devices?.baselineHr ? `Resting ${devices.baselineHr} bpm` : "Not calibrated yet"}
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <SectionTitle sub="One place for everything Companio says out loud.">Companio voice</SectionTitle>
      <Card>
        <Text style={type.meta}>WHEN IT SPEAKS</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8, marginBottom: 4 }}>
          {[["AUTO", "Smart"], ["ALWAYS", "Always"], ["HEADPHONES_ONLY", "Headphones"], ["SILENT", "Silent"]].map(([k, label]) => {
            const on = (prefs?.voiceMode || "AUTO") === k;
            return (
              <TouchableOpacity key={k} activeOpacity={0.8} onPress={() => setPref("voiceMode", k)}
                style={{ paddingVertical: 9, paddingHorizontal: 15, borderRadius: radius.pill,
                         marginRight: 7, marginBottom: 7, borderWidth: 1.4,
                         borderColor: on ? C.primary : C.border,
                         backgroundColor: on ? C.primarySoft : "transparent" }}>
                <Text style={{ fontSize: 13, fontWeight: on ? "700" : "600",
                               color: on ? C.primary : C.textSecondary }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={type.sub}>
          {{
            AUTO: "Speaks when it matters, stays quiet for routine messages.",
            ALWAYS: "Says everything out loud.",
            HEADPHONES_ONLY: "Notification only, unless headphones are in or you allow the speaker.",
            SILENT: "Never speaks. Everything arrives as a notification.",
          }[prefs?.voiceMode || "AUTO"]}
        </Text>
      </Card>
      <Card>
        <Toggle icon="hand-left" title="Let me interrupt"
          sub="Companio stops talking the moment you start speaking."
          value={prefs?.allowBargeIn} onChange={(v) => setPref("allowBargeIn", v)}
          disabled={prefs?.voiceMode === "SILENT"} />
        <Toggle icon="ear" title="Listen for “Hey Companio”"
          sub="While the Companio screen is open, so you can ask without tapping. Recognised on your device — nothing is recorded or sent."
          value={!!prefs?.wakeWord} onChange={(v) => setPref("wakeWord", v)} />
        <Toggle icon="chatbubble-ellipses" title="Speak during an episode"
          sub="Companio may start talking on its own when it detects distress."
          value={prefs?.allowAutoSpeech} onChange={(v) => setPref("allowAutoSpeech", v)}
          disabled={prefs?.voiceMode === "SILENT"} />
      </Card>

      <SectionTitle sub="Each is separate. Turning one off does not affect the others.">Privacy</SectionTitle>
      <Card>
        <Toggle icon="camera" tint={C.warning} title="Automatic context capture"
          sub="One photo when your signals rise. Never continuous video."
          value={prefs?.autoCapture} onChange={(v) => setPref("autoCapture", v)} />
        <Toggle icon="mic" tint={C.warning} title="Voice recording"
          sub="Needed to talk to Companio at all."
          value={prefs?.voiceRecording} onChange={(v) => setPref("voiceRecording", v)} />
        <Toggle icon="image" tint={C.warning} title="Save captured images"
          sub="Keeps photos on your record for your therapist."
          value={prefs?.saveImages} onChange={(v) => setPref("saveImages", v)} />
        <Toggle icon="musical-notes" tint={C.warning} title="Save raw audio"
          sub="More sensitive than a transcript."
          value={prefs?.saveAudio} onChange={(v) => setPref("saveAudio", v)} />
        <Toggle icon="document-text" title="Save transcripts"
          sub="The text of what you and Companio said."
          value={prefs?.saveTranscripts} onChange={(v) => setPref("saveTranscripts", v)} />
      </Card>
      <Card onPress={() => navigation.navigate("MonitoringPrivacy")}>
        <Row icon="shield-checkmark" iconFg={C.primary} iconBg={C.primarySoft}
          title="All monitoring & privacy settings"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <SectionTitle>Support contacts</SectionTitle>
      <Card>
        <Row icon="medkit" iconFg={C.primary} iconBg={C.primarySoft}
          title={therapistName} subtitle="Your therapist" />
        <Row icon="people" iconFg={C.warning} iconBg={C.warningSoft}
          title={me?.caregiver?.name || "No caregiver added"}
          subtitle={me?.caregiver?.phone || "Companio can offer to contact someone you choose"}
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
          onPress={() => navigation.navigate("Care")} />
      </Card>

      <SectionTitle>Monitoring</SectionTitle>
      <Card>
        <Toggle icon="pulse" title="Background monitoring"
          sub="Watches your physical signs for early signs of distress."
          value={prefs?.physiologicalMonitoring}
          onChange={(v) => setPref("physiologicalMonitoring", v)} />
        <Row icon="pause-circle" iconFg={paused ? C.warning : C.textSecondary}
          iconBg={paused ? C.warningSoft : C.surfaceStrong}
          title={paused ? "Monitoring is paused" : "Pause monitoring"}
          subtitle={paused ? "Tap to change" : "Take a break for a set time"}
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
          onPress={() => navigation.navigate("MonitoringPrivacy")} />
      </Card>

      <Card onPress={() => navigation.navigate("Notifications")}>
        <Row icon="notifications" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
          title="Notifications" subtitle="Everything Companio and your therapist have sent"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <Btn label="Sign out" icon="log-out" variant="outline" color={C.danger} onPress={signOut} />
      </View>
      <Disclaimer />
    </Screen>
  );
}
