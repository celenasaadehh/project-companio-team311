// Voice check-in: record, transcribe, decide, speak.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { colors as C, spacing, type } from "../theme/theme";
import { Screen, AppHeader, Card, Row, Btn, Pill, Disclaimer, DecisionSourceBadge, SupportOrb, EngineTrace } from "../components/ui";
import { FollowUpCheck } from "../components/followup";
import { uploadAudio } from "../services/media";
import { startEpisode } from "../services/episode";
import { assessRisk } from "../services/risk";
import { speak, stopSpeaking, interruptForListening, SPEECH_PRIORITY } from "../services/speech";
import { startTranscription, getTranscription, saveSession, deleteMedia } from "../services/engine";
import { decideMoment } from "../services/decide";
import { computeLiveDistress } from "../services/health";
import { useApp } from "../state/AppContext";

const POLL_MS = 3000;
const MAX_POLLS = 40;

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceCheckIn({ navigation }) {
  const { currentPatientId, vitals, devices, askFollowupQuestions, prefs } = useApp();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [decision, setDecision] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const pollRef = useRef(0);
  const stoppedUriRef = useRef(null);
  const conversationRef = useRef(`VC-${Date.now().toString(36)}`);
  const turnRef = useRef(0);

  useEffect(() => () => {
    try { if (recorderState.isRecording) recorder.stop(); } catch {}
    try { Speech.stop(); } catch {}
  }, []);

  async function startRecording() {
    setError(null);
    if (prefs?.voiceRecording === false) {
      setError("Voice recording is turned off in Monitoring & privacy. Turn it back on there if you want to talk to Companio.");
      return;
    }
    const barge = interruptForListening(prefs);
    if (!barge.interrupted && barge.reason) {
      setError(null);
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) { setPermissionDenied(true); return; }
    setPermissionDenied(false);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase("recording");
  }

  async function stopRecording() {
    await recorder.stop();
    stoppedUriRef.current = recorder.uri;

    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
    }

    setPhase(recorder.uri ? "stopped" : "failed");
    if (!recorder.uri) setError("No audio was captured.");
  }

  function discard() {
    stoppedUriRef.current = null;
    setTranscript(""); setDecision(null); setError(null);
    setPhase("idle");
  }

  async function send() {
    if (currentPatientId) startEpisode(currentPatientId, "voice_checkin");

    const uri = stoppedUriRef.current;
    if (!uri || !currentPatientId) return;
    setPhase("uploading");
    try {
      const { s3_key } = await uploadAudio(currentPatientId, uri, "audio/m4a");
      setPhase("transcribing");
      const { job_name } = await startTranscription(s3_key, currentPatientId, "en-US");

      pollRef.current = 0;
      const text = await pollTranscript(job_name);
      setTranscript(text);

      const baselineHr = devices?.baselineHr;
      const live = vitals?.hr && baselineHr
        ? await assessRisk(vitals, baselineHr, {
            recentWorkout: vitals.recentWorkout, caffeineMgToday: vitals.caffeineMgToday,
            poorSleep: vitals.poorSleep, activeNow: vitals.activeNow,
            hrFreshness: vitals.hrFreshness, hrvFreshness: vitals.hrvFreshness,
            hrAgeMinutes: vitals.hrAgeMinutes, declaredContext: prefs?.declaredContext,
          }, devices?.baselineProfile)
        : null;
      let out = null;
      try {
        out = await decideMoment({
          patient_id: currentPatientId,
          risk_level: live?.level || "baseline",
          risk_score: live?.score ?? 0,
          transcript: text,
          observed_triggers: [],
          sleep_hours_last_night: vitals?.sleepHoursLastNight ?? null,
          poor_sleep: !!vitals?.poorSleep,
        });
        setDecision(out);
        const spoken = out?.spoken_message || out?.message;
        if (spoken) speak(spoken, prefs, SPEECH_PRIORITY.SUPPORT);
      } catch (decisionErr) {
        console.warn("Decision hierarchy failed for voice check-in:", decisionErr);
      }

      try {
        turnRef.current += 1;
        await saveSession({
          patient_id: currentPatientId,
          type: "voice_transcription",
          audio_s3_key: prefs?.saveAudio ? s3_key : null,
          audio_retained: !!prefs?.saveAudio,
          transcript: prefs?.saveTranscripts !== false ? text : null,
          transcript_retained: prefs?.saveTranscripts !== false,
          patient_said: prefs?.saveTranscripts !== false ? text : null,
          companio_said: out?.spoken_message || out?.message || null,
          decision_source: out?.decision_source || null,
          message: out?.spoken_message || null,
          conversation_id: conversationRef.current,
          turn: turnRef.current,
        });
      } catch (sessionErr) {
        console.warn("Check-in transcribed but AWS session save failed:", sessionErr);
      }
      // Transcribe has finished with the file; without retention consent the
      // object itself is removed, not merely unreferenced.
      if (!prefs?.saveAudio && s3_key) {
        deleteMedia(s3_key, currentPatientId).catch(() => {});
      }

      setPhase("completed");
    } catch (e) {
      setError(e?.message || String(e));
      setPhase("failed");
    }
  }

  async function pollTranscript(jobName) {
    while (pollRef.current < MAX_POLLS) {
      pollRef.current += 1;
      const r = await getTranscription(jobName);
      if (r?.status === "COMPLETED") return r.transcript || "";
      if (r?.status === "FAILED") throw new Error(r.failure_reason || "Transcription failed");
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
    throw new Error("Transcription is taking longer than expected — try again shortly.");
  }

  return (
    <Screen>
      <AppHeader title="Talk to Companio" subtitle="Say how you're feeling out loud — Companio listens and answers" onBack={() => navigation.goBack()} />

      <Card accent={C.primary}>
        <View style={{ alignItems: "center", paddingVertical: spacing.md, minHeight: 210 }}>
          <SupportOrb
            mode={phase === "recording" ? "listening" : (phase === "uploading" || phase === "transcribing") ? "thinking" : phase === "completed" ? "speaking" : "idle"}
            onPress={phase === "idle" ? startRecording : phase === "recording" ? stopRecording : undefined}
          />
          <Text style={[type.title, { marginTop: 6 }]}>
            {{
              idle: "Tap the orb to talk",
              recording: `Recording · ${fmtDuration(recorderState.durationMillis)}`,
              stopped: "Recording ready",
              uploading: "Uploading securely…",
              transcribing: "Transcribing…",
              completed: "Companio answered",
              failed: "Something went wrong",
            }[phase]}
          </Text>
          {permissionDenied ? (
            <Text style={[type.meta, { marginTop: 8, color: C.danger, textAlign: "center" }]}>
              Microphone access was not granted. Enable it in Settings → Privacy → Microphone → Companio.
            </Text>
          ) : null}
        </View>

        {phase === "idle" ? <Btn label="Start recording" icon="mic" onPress={startRecording} /> : null}
        {phase === "recording" ? <Btn label="Stop" color={C.danger} icon="stop" onPress={stopRecording} /> : null}
        {phase === "stopped" ? (
          <>
            <Btn label="Send" icon="arrow-up-circle" onPress={send} />
            <Btn label="Discard & re-record" variant="ghost" color={C.textSecondary} icon="refresh" onPress={discard} />
          </>
        ) : null}
        {(phase === "uploading" || phase === "transcribing") ? <ActivityIndicator color={C.primary} style={{ marginTop: 14 }} /> : null}
        {phase === "failed" ? (
          <>
            {error ? <Text style={[type.meta, { color: C.danger, marginTop: 8, textAlign: "center" }]}>{error}</Text> : null}
            <Btn label="Try again" icon="refresh" onPress={discard} />
          </>
        ) : null}
      </Card>

      {phase === "completed" ? (
        <Card accent={C.success}>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft} title="Transcript" subtitle={transcript || "(no speech detected)"} />
          {decision ? (
            <>
              <Text style={[type.body, { marginTop: 10, fontSize: 16 }]}>{decision.spoken_message}</Text>
              <View style={{ marginTop: 8 }}><DecisionSourceBadge source={decision.decision_source} /></View>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Btn label="Keep talking" icon="mic"
                    onPress={() => { stopSpeaking(); discard(); }} />
                </View>
                <View style={{ width: 56 }}>
                  <Btn label="" icon="volume-high" variant="outline"
                    onPress={() => { const m = decision.spoken_message || decision.message; if (m) speak(m, prefs, SPEECH_PRIORITY.URGENT); }} />
                </View>
              </View>
            </>
          ) : (
            <Pill text="Saved · response unavailable offline" fg={C.textSecondary} bg="#EEF1F6" />
          )}
        </Card>
      ) : null}
      {phase === "completed" && decision?.trace ? (
        <EngineTrace trace={decision.trace} source={decision.decision_source} />
      ) : null}
      {phase === "completed" && decision ? (
        <FollowUpCheck patientId={currentPatientId} baseContext={{ patient_id: currentPatientId, transcript }} autoAsk={askFollowupQuestions}
          previousAction={decision?.selected_action || decision?.action || null}
          previousMessage={decision?.spoken_message || decision?.message || null} />
      ) : null}

      <Text style={[type.meta, { marginTop: 12 }]}>This stays between you and Companio in the moment. Your therapist can see it later so they can support you — it is never used to diagnose.</Text>
      <Disclaimer />
    </Screen>
  );
}
