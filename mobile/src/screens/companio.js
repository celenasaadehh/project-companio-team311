// The patient's AI space: talk, chat and history.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, EmptyState,
         Disclaimer, DecisionSourceBadge, SupportOrb } from "../components/ui";
import { EscalationCard } from "../components/escalation_card";
import { ResourceList, resourcesFor } from "../components/resource_player";
import { NeedMore } from "../components/need_more";
import { useWakeWord } from "../services/wakeword";
import { useApp } from "../state/AppContext";
import { decideMoment } from "../services/decide";
import { getSessions, getDecisions, deleteMedia, saveDecision } from "../services/engine";
import { speak, stopSpeaking, maySpeak, SPEECH_PRIORITY } from "../services/speech";
import { startEpisode, recordOfferedAction, recordInterventionOutcome } from "../services/episode";
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from "expo-audio";
import { uploadAudio } from "../services/media";
import { assessRisk } from "../services/risk";
import { startTranscription, getTranscription, saveSession } from "../services/engine";
import { interruptForListening } from "../services/speech";

const MODES = ["Talk", "Chat", "History"];

function ModeSwitch({ mode, setMode }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: C.surfaceStrong,
                   borderRadius: radius.pill, padding: 4, marginBottom: spacing.md }}>
      {MODES.map((m) => (
        <TouchableOpacity key={m} onPress={() => setMode(m)} activeOpacity={0.8}
          style={{ flex: 1, paddingVertical: 9, borderRadius: radius.pill,
                   backgroundColor: mode === m ? C.surface : "transparent", alignItems: "center" }}>
          <Text style={{ fontWeight: "700", fontSize: 14,
                         color: mode === m ? C.textPrimary : C.textSecondary }}>{m}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function CompanioTab({ navigation, route }) {
  const [mode, setMode] = useState("Talk");
  const { prefs } = useApp();
  const autoListen = !!route?.params?.autoListen;

  return (
    <Screen>
      <AppHeader eyebrow="COMPANIO" title="Here with you"
        subtitle={`Voice: ${{
          AUTO: "Smart", ALWAYS: "Always speaks",
          HEADPHONES_ONLY: "Headphones only", SILENT: "Silent",
        }[prefs?.voiceMode || "AUTO"]}`} />
      <ModeSwitch mode={mode} setMode={setMode} />
      {mode === "Talk" ? <TalkMode navigation={navigation} autoListen={autoListen} />
        : mode === "Chat" ? <ChatMode />
        : <HistoryMode navigation={navigation} />}
      <Disclaimer />
    </Screen>
  );
}



function TalkMode({ navigation, autoListen }) {
  const { currentPatientId, vitals, devices, prefs, patient, authUser, refreshMyProfile } = useApp();

  // The therapist may have attached resources since sign-in; a stale cached
  // profile here means a recording that exists but never plays.
  useEffect(() => { refreshMyProfile?.(); }, []);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const [state, setState] = useState("idle");
  const [transcript, setTranscript] = useState(null);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const [escalated, setEscalated] = useState(false);
  const [offeredAction, setOfferedAction] = useState(null);
  const [typed, setTyped] = useState("");
  const [helpBusy, setHelpBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  // An explicit request. No transcript, no speech -- the patient asked, and
  // that on its own is the signal.
  async function askDirectly() {
    if (asking) return;
    setAsking(true);
    setError(null);
    try {
      const live = vitals?.hr && devices?.baselineHr
        ? await assessRisk(vitals, devices.baselineHr, {
            recentWorkout: vitals.recentWorkout, caffeineMgToday: vitals.caffeineMgToday,
            poorSleep: vitals.poorSleep, activeNow: vitals.activeNow,
            hrFreshness: vitals.hrFreshness, hrvFreshness: vitals.hrvFreshness,
            hrAgeMinutes: vitals.hrAgeMinutes,
          }).catch(() => null)
        : null;
      const out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: live?.level || "elevated",
        risk_score: live?.score ?? 0.5,
        transcript: null,
        explicit_request: true,
        observed_triggers: [],
      });
      const said = out?.spoken_message || out?.message;
      setReply(said || null);
      setOfferedAction(out?.selected_action || null);
      setEscalated(!!out?.escalation_required);
      // An explicit ask has no transcript, but the exchange still belongs in
      // the history: what Companio answered is half the clinical record.
      saveSession({
        patient_id: currentPatientId,
        type: "voice_transcription",
        explicit_request: true,
        companio_said: said || null,
        decision_source: out?.decision_source || null,
      }).catch(() => {});
      if (said) speak(said, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
    } catch (e) {
      setError(e?.message || "Companio couldn't reach the engine.");
    } finally {
      setAsking(false);
    }
  }
  const pollRef = useRef(0);
  const MAX_POLLS = 40;

  const wake = useWakeWord({
    enabled: !!prefs?.wakeWord && state === "idle",
    onWake: () => { if (state === "idle") start(); },
  });

  useEffect(() => {
    if (!autoListen) return undefined;
    const t = setTimeout(() => { if (state === "idle") start(); }, 450);
    return () => clearTimeout(t);
  }, [autoListen]);

  useEffect(() => () => {
    stopSpeaking();
    try { if (recorderState.isRecording) recorder.stop(); } catch {}
  }, []);

  async function start() {
    setError(null); setTranscript(null); setReply(null);

    if (prefs?.voiceRecording === false) {
      setError("Voice recording is turned off in Monitoring & privacy.");
      return;
    }
    interruptForListening(prefs);

    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setError("Microphone access is needed to talk to Companio."); return; }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState("listening");
    startEpisode(currentPatientId, "voice_checkin");
  }

  async function stop() {
    if (!recorderState.isRecording) return;
    await recorder.stop();
    const uri = recorder.uri;

    try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch {}

    if (!uri) { setState("idle"); setError("No audio was captured."); return; }
    setState("thinking");

    try {
      const { s3_key } = await uploadAudio(currentPatientId, uri, "audio/m4a");
      const { job_name } = await startTranscription(s3_key, currentPatientId, "en-US");

      pollRef.current = 0;
      let text = null;
      while (pollRef.current < MAX_POLLS) {
        pollRef.current += 1;
        const r = await getTranscription(job_name);
        if (r?.status === "COMPLETED") { text = r.transcript || ""; break; }
        if (r?.status === "FAILED") throw new Error("Transcription failed.");
        await new Promise((res) => setTimeout(res, 1500));
      }
      // Exhausting the polls is a timeout, not silence: proceeding with an
      // empty transcript would hand the engine a fabricated "said nothing".
      if (text === null) throw new Error("Transcription timed out. Please try again.");
      setTranscript(text || "(no speech detected)");

      const live = vitals?.hr && devices?.baselineHr
        ? await assessRisk(vitals, devices.baselineHr, {
            recentWorkout: vitals.recentWorkout, caffeineMgToday: vitals.caffeineMgToday,
            poorSleep: vitals.poorSleep, activeNow: vitals.activeNow,
            hrFreshness: vitals.hrFreshness, hrvFreshness: vitals.hrvFreshness,
            hrAgeMinutes: vitals.hrAgeMinutes,
          }, devices.baselineProfile)
        : null;

      const out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: live?.level || "baseline",
        risk_score: live?.score ?? 0,
        transcript: text,
        observed_triggers: [],
        sleep_hours_last_night: vitals?.sleepHoursLastNight ?? null,
        poor_sleep: !!vitals?.poorSleep,
      });

      const said = out?.spoken_message || out?.message;
      setReply(said || null);
      setOfferedAction(out?.selected_action || null);
      // Running out of approved options is not a message, it is a handover.
      setEscalated(!!out?.escalation_required);

      if (!prefs?.saveAudio && s3_key) {
        deleteMedia(s3_key, currentPatientId).catch(() => {});
      }
      saveSession({
        patient_id: currentPatientId,
        type: "voice_transcription",
        audio_s3_key: prefs?.saveAudio ? s3_key : null,
        audio_retained: !!prefs?.saveAudio,
        transcript: prefs?.saveTranscripts !== false ? text : null,
        transcript_retained: prefs?.saveTranscripts !== false,
        patient_said: prefs?.saveTranscripts !== false ? text : null,
        companio_said: said || null,
        decision_source: out?.decision_source || null,
      }).catch(() => {});

      if (said) {
        setState("speaking");
        const res = speak(said, prefs, SPEECH_PRIORITY.SUPPORT, {
          vitals, onDone: () => setState("idle"), onStopped: () => setState("idle"),
        });
        // If the gate kept it silent (headphones, silent mode), don't hang in
        // "speaking" waiting for a callback that will never come.
        if (!res?.spoken) setState("idle");
      } else {
        setState("idle");
      }
    } catch (e) {
      setState("idle");
      setError(e?.message || "Something went wrong. Your therapist can still be reached from Care.");
    }
  }

  // Typing goes through the exact same decision path as speaking: same engine,
  // same logging, same resource delivery. Mid-episode, some people cannot talk.
  async function sendTyped() {
    const t = typed.trim();
    if (!t || state !== "idle") return;
    setTyped("");
    setTranscript(t);
    setError(null);
    setState("thinking");
    startEpisode(currentPatientId, "typed_checkin");
    try {
      const out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: vitals?.riskLevel || "baseline",
        risk_score: vitals?.riskScore ?? 0,
        transcript: t,
        observed_triggers: [],
      });
      const said = out?.spoken_message || out?.message;
      setReply(said || null);
      setOfferedAction(out?.selected_action || null);
      setEscalated(!!out?.escalation_required);
      saveSession({
        patient_id: currentPatientId,
        type: "voice_transcription",
        typed: true,
        transcript: prefs?.saveTranscripts !== false ? t : null,
        transcript_retained: prefs?.saveTranscripts !== false,
        patient_said: prefs?.saveTranscripts !== false ? t : null,
        companio_said: said || null,
        decision_source: out?.decision_source || null,
      }).catch(() => {});
      if (said) speak(said, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
    } catch (e) {
      setError(e?.message || "Something went wrong. Your therapist can still be reached from Care.");
    } finally {
      setState("idle");
    }
  }

  function saidHelped() {
    recordInterventionOutcome(true);
    saveDecision({
      patient_id: currentPatientId,
      selected_action: offeredAction || null,
      outcome: "helped",
      patient_reported_helped: true,
    }).catch(() => {});
    const thanks = "I'm glad that helped. I'm staying right here with you.";
    setOfferedAction(null);
    setReply(thanks);
    speak(thanks, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
  }

  async function saidNotHelped() {
    if (helpBusy) return;
    setHelpBusy(true);
    try {
      // Record the failure BEFORE asking again, so the engine cannot offer
      // the same intervention back.
      if (offeredAction) recordOfferedAction(offeredAction);
      recordInterventionOutcome(false);
      const out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: vitals?.riskLevel || "elevated",
        risk_score: vitals?.riskScore ?? 0,
        transcript: "that did not help",
        patient_reported_helped: false,
        observed_triggers: [],
      });
      saveDecision({
        patient_id: currentPatientId,
        selected_action: offeredAction || null,
        outcome: "did_not_help",
        patient_reported_helped: false,
        patient_response: "no",
      }).catch(() => {});
      const said = out?.spoken_message || out?.message;
      if (out?.escalation_required) setEscalated(true);
      setReply(said || null);
      setOfferedAction(out?.selected_action || null);
      if (said) speak(said, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
    } catch {
      setError("Companio couldn't reach the engine. Your therapist can still be reached from Care.");
    } finally {
      setHelpBusy(false);
    }
  }

  const label = {
    idle: "Tap to speak",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking",
  }[state];

  return (
    <>
      <Card>
        <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
          <SupportOrb mode={state === "idle" ? "idle" : state} onPress={state === "idle" ? start : stop} />
          <Text style={[type.title, { marginTop: spacing.md }]}>{label}</Text>
          {state === "idle" ? (
            <Text style={[type.sub, { marginTop: 4, textAlign: "center" }]}>
              Tell me what you're noticing.
            </Text>
          ) : null}
        </View>

        {state === "idle" ? (
          <Btn label="Talk to Companio" icon="mic" onPress={start} />
        ) : state === "listening" ? (
          <Btn label="Stop" icon="stop" color={C.danger} onPress={stop} />
        ) : (
          <ActivityIndicator color={C.primary} style={{ marginTop: 6 }} />
        )}

        {state === "idle" ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
            <TextInput value={typed} onChangeText={setTyped}
              placeholder="Or type it instead…" placeholderTextColor={C.textMuted}
              returnKeyType="send" onSubmitEditing={sendTyped}
              style={{ flex: 1, backgroundColor: C.surfaceAlt, borderRadius: radius.md,
                       padding: 12, color: C.textPrimary }} />
            <TouchableOpacity onPress={sendTyped} disabled={!typed.trim()}
              accessibilityLabel="Send typed message"
              style={{ marginLeft: 8, width: 44, height: 44, borderRadius: 22,
                       alignItems: "center", justifyContent: "center",
                       backgroundColor: typed.trim() ? C.primary : C.surfaceStrong }}>
              <Ionicons name="send" size={19} color={typed.trim() ? "#fff" : C.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>

      {error ? (
        <Card accent={C.danger}>
          <Text style={[type.sub, { color: C.textPrimary }]}>{error}</Text>
        </Card>
      ) : null}

      {transcript ? (
        <Card>
          <Text style={type.meta}>YOU SAID</Text>
          <Text style={[type.body, { marginTop: 4, fontSize: 15.5 }]}>{`"${transcript}"`}</Text>
        </Card>
      ) : null}

      {!reply && state === "idle" ? (
        <Card accent={C.primary}>
          <Row icon="hand-right" iconFg={C.primary} iconBg={C.primarySoft}
            title="Ask for help directly"
            subtitle="No need to explain anything — Companio offers something your therapist approved." />
          <Btn label="I need help now" icon="help-buoy" disabled={asking}
            onPress={askDirectly} />
        </Card>
      ) : null}

      {prefs?.wakeWord ? (
        <Card>
          <Row icon={wake.listening ? "ear" : "ear-outline"}
            iconFg={wake.listening ? C.success : C.textMuted}
            iconBg={wake.listening ? C.successSoft : C.surfaceStrong}
            title={wake.listening ? "Listening for “Hey Companio”"
              : state !== "idle" ? "Paused while you talk to Companio"
              : "Not listening"}
            subtitle={state !== "idle"
              ? "One microphone: it stops watching for the phrase while recording, and resumes after."
              : wake.error
              ? wake.error
              : !wake.supported
                ? "This build cannot listen for a phrase. Tap the circle instead."
                : "On your device only. Nothing is recorded or sent unless you start a check-in."} />
        </Card>
      ) : null}

      {reply && !escalated ? (
        <NeedMore patientId={currentPatientId} offeredAction={offeredAction}
          riskLevel={vitals?.riskLevel} riskScore={vitals?.riskScore}
          onSpeak={start}
          onEscalate={() => setEscalated(true)}
          onNewAction={(out) => {
            const said = out?.spoken_message || out?.message;
            setReply(said || null);
            setOfferedAction(out?.selected_action || null);
            if (said) speak(said, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
          }} />
      ) : null}

      {escalated ? (
        <EscalationCard profile={patient(currentPatientId)} patientId={currentPatientId}
          therapistName={authUser?.therapistName} />
      ) : null}
      {reply ? (
        <Card accent={C.primary}>
          <Text style={type.meta}>COMPANIO</Text>
          <Text style={[type.body, { marginTop: 4, fontSize: 16 }]}>{reply}</Text>
          {offeredAction ? (
            <ResourceList patientId={currentPatientId} prefs={prefs} vitals={vitals}
              autoPlay={maySpeak(prefs, SPEECH_PRIORITY.SUPPORT, vitals).allowed}
              actionKey={offeredAction}
              resources={resourcesFor(
                patient(currentPatientId)?.treatmentPlan?.interventionResources,
                offeredAction)} />
          ) : null}
          {offeredAction && !escalated ? (
            <View style={{ flexDirection: "row", marginTop: spacing.sm }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Btn label="Yes, it helped" icon="checkmark-circle"
                  disabled={helpBusy} onPress={saidHelped} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn label="No, it didn't" icon="close-circle" variant="outline"
                  disabled={helpBusy} onPress={saidNotHelped} />
              </View>
            </View>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Btn label="Say it again" icon="volume-high" variant="outline"
              onPress={() => speak(reply, prefs, SPEECH_PRIORITY.URGENT)} />
          </View>
        </Card>
      ) : null}

      <Card>
        <Row icon="shield-checkmark" iconFg={C.success} iconBg={C.successSoft}
          title="This is Companio, not your therapist"
          subtitle="Companio only offers what your therapist approved. To reach a person, use Care." />
      </Card>
    </>
  );
}

function ChatMode() {
  const { currentPatientId, messagesFor, sendMessage, loadMessages, vitals, devices, prefs } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  useEffect(() => { loadMessages?.(currentPatientId); }, [currentPatientId, loadMessages]);

  const all = messagesFor ? messagesFor(currentPatientId) : [];
  const msgs = all.filter((m) => (m.channel || "therapist") === "companio");

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setBusy(true);
    sendMessage(currentPatientId, "patient", t, "companio");
    startEpisode(currentPatientId, "typed_checkin");
    try {
      const out = await decideMoment({
        patient_id: currentPatientId,
        transcript: t,
        risk_level: "baseline",
        risk_score: 0,
        observed_triggers: [],
      });
      const reply = out?.spoken_message || out?.message;
      if (reply) {
        sendMessage(currentPatientId, "companio", reply, "companio");
        speak(reply, prefs, SPEECH_PRIORITY.SUPPORT);
      }
    } catch (e) {
      sendMessage(currentPatientId, "companio",
        "I couldn't reach my support engine just now. If you need someone, use Care to contact your therapist.",
        "companio");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <ScrollView ref={scroller} style={{ maxHeight: 380 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
          {msgs.length === 0 ? (
            <EmptyState icon="chatbubble-ellipses" title="Nothing yet"
              sub="Type anything — how you're feeling, what you're noticing." />
          ) : msgs.map((m, i) => {
            const mine = m.from === "patient";
            return (
              <View key={i} style={{ flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                {!mine ? (
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.primarySoft,
                                 alignItems: "center", justifyContent: "center", marginRight: 7, marginTop: 2 }}>
                    <Ionicons name="sparkles" size={13} color={C.primary} />
                  </View>
                ) : null}
                <View style={{ maxWidth: "78%", backgroundColor: mine ? C.primary : C.surfaceStrong,
                               borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 9 }}>
                  {!mine ? <Text style={[type.meta, { marginBottom: 2 }]}>COMPANIO</Text> : null}
                  <Text style={{ color: mine ? "#fff" : C.textPrimary, fontSize: 15 }}>{m.text}</Text>
                </View>
              </View>
            );
          })}
          {busy ? <ActivityIndicator color={C.primary} style={{ marginVertical: 8 }} /> : null}
        </ScrollView>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.sm }}>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={send}
          placeholder="Tell Companio what's happening…" placeholderTextColor={C.textMuted}
          style={{ flex: 1, backgroundColor: C.surface, borderRadius: radius.md,
                   borderWidth: 1, borderColor: C.border, paddingHorizontal: 14,
                   paddingVertical: 12, fontSize: 15, color: C.textPrimary, marginRight: 8 }} />
        <TouchableOpacity onPress={send} disabled={!text.trim() || busy}
          style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center",
                   backgroundColor: text.trim() && !busy ? C.primary : C.surfaceStrong }}>
          <Ionicons name="arrow-up" size={20} color={text.trim() && !busy ? "#fff" : C.textMuted} />
        </TouchableOpacity>
      </View>
    </>
  );
}

function HistoryMode({ navigation }) {
  const { currentPatientId } = useApp();
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      getSessions(currentPatientId).catch(() => null),
      getDecisions(currentPatientId).catch(() => null),
    ]);
    const sessions = (s?.sessions || []).filter((x) =>
      x.type === "voice_transcription" || x.type === "trigger_event");
    const decisions = d?.decisions || [];
    const merged = sessions.map((x) => ({
      ...x,
      decision: decisions.find((dd) => dd.episode_id && dd.episode_id === x.episode_id) || null,
    })).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    setRows(merged);
  }, [currentPatientId]);

  useEffect(() => { load(); }, [load]);

  if (rows === null) return <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />;
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon="time" title="No sessions yet"
          sub="Your conversations with Companio and the moments it helped with will appear here." />
      </Card>
    );
  }

  return (
    <>
      {rows.map((r, i) => {
        const helped = r.decision?.patient_reported_helped;
        return (
          <Card key={r.session_id || i}>
            <Row
              icon={r.type === "voice_transcription" ? "mic" : "camera"}
              iconFg={C.primary} iconBg={C.primarySoft}
              title={r.type === "voice_transcription" ? "Voice support" : "Support episode"}
              subtitle={r.created_at ? new Date(r.created_at).toLocaleString() : ""} />
            {r.patient_said || r.transcript ? (
              <Text style={[type.sub, { marginTop: 8 }]}>{`You said: "${r.patient_said || r.transcript}"`}</Text>
            ) : null}
            {r.companio_said || r.message ? (
              <Text style={[type.sub, { marginTop: 6 }]}>{`Companio: "${r.companio_said || r.message}"`}</Text>
            ) : null}
            {r.normalized_visual_trigger ? (
              <Text style={[type.sub, { marginTop: 6 }]}>{`Recognised: ${r.normalized_visual_trigger}`}</Text>
            ) : null}
            {typeof helped === "boolean" ? (
              <Text style={[type.meta, { marginTop: 8 }]}>
                {helped ? "You said this helped" : "You said this didn't help"}
              </Text>
            ) : null}
            {r.decision_source || r.decision?.decision_source ? (
              <View style={{ marginTop: 8 }}>
                <DecisionSourceBadge source={r.decision_source || r.decision?.decision_source} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
