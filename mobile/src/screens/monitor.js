// Live physiological monitoring.
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, RiskBadge, Disclaimer, ConfoundBanner, DecisionSourceBadge, EngineTrace } from "../components/ui";
import { RiskGauge } from "../components/charts";
import { isHealthAvailable, readVitals, computeLiveDistress } from "../services/health";
import { saveSession } from "../services/engine";
import { assessRisk, RISK_SOURCE } from "../services/risk";
import { CATEGORY } from "../services/notify_actions";
import { useApp } from "../state/AppContext";
import { startEpisode, closeEpisode } from "../services/episode";
import { newEpisode, step as machineStep, endEpisode, EpisodeState } from "../services/episode_machine";
import { offeredActions, consumeInterventionOutcome, consumePatientResponse, getEpisodeId } from "../services/episode";
import { acousticTriggerMatch } from "../services/acoustic";
import { ResourceList, resourcesFor } from "../components/resource_player";
import { reportSyncFailure } from "../services/errors";
import { speak as speakSafely, speakAndNotify, SPEECH_PRIORITY } from "../services/speech";
import { saveDailySnapshot } from "../services/alerts";
import { notifyNow } from "../services/notify";
import * as Speech from "expo-speech";
import { decideMoment } from "../services/decide";

const POLL_MS = 15000;

export function LiveMonitor({ navigation }) {
  const { devices, currentPatientId, addTriggerEvent, setVitals, vitals, prefs, isMonitoringPaused, patient, refreshMyProfile } = useApp();
  const me = patient ? patient(currentPatientId) : null;
  useEffect(() => { refreshMyProfile?.(); }, []);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState(null);
  const [response, setResponse] = useState(null);
  const [lastAlert, setLastAlert] = useState(0);
  const [bannerAnswer, setBannerAnswer] = useState(null);
  const [askedAt, setAskedAt] = useState(null);
  const [nudged, setNudged] = useState(false);
  const timer = useRef(null);
  const seenPromptRef = useRef(false);
  const monitoringPausedTick = isMonitoringPaused ? isMonitoringPaused() : false;

  const NUDGE_MS = 60000;
  const CONCERN_MS = 180000;

  async function fireAlert(r, extra) {
    startEpisode(currentPatientId, "physiological_rise", {
      risk_level: r?.level, risk_score: r?.score,
      hr: r?.hr, hrv: r?.hrv, hrFreshness: r?.hrFreshness,
      confounds: r?.explanation || null,
    });

    setLastAlert(Date.now());
    if (!currentPatientId) return;

    let out = null;
    try {
      out = await decideMoment({
        patient_id: currentPatientId,
        risk_level: r.level,
        risk_score: r.score,
        observed_triggers: [],
        transcript: r.confounded ? `(Physiological signal only. Context: ${r.confoundReasons.join(", ")}.)` : "",
        sleep_hours_last_night: vitals?.sleepHoursLastNight ?? null,
        poor_sleep: !!vitals?.poorSleep,
      });
      setResponse(out);
      const spoken = out?.spoken_message || out?.message;
      if (spoken) {
        // Speak and notify together: whichever reaches the patient, the message
        // lands. Previously a patient with headphones out, the phone in a bag,
        // or voice set to silent simply never received it.
        if (prefs?.allowAutoSpeech !== false) {
          speakAndNotify(spoken, prefs, SPEECH_PRIORITY.SUPPORT, notifyNow, {
            title: "Companio is here",
            data: { categoryIdentifier: CATEGORY.SUPPORT, patient_id: currentPatientId },
          });
        } else {
          notifyNow("Companio is here", spoken.slice(0, 120), 0,
            { categoryIdentifier: CATEGORY.SUPPORT, patient_id: currentPatientId });
        }
      }

      const chosen = String(out?.selected_action || spoken || "").toLowerCase();
      if (/5-?4-?3-?2-?1|grounding/.test(chosen)) {
        setTimeout(() => { try { navigation.navigate("Support", { auto: true }); } catch {} }, 4500);
      }

      if (r.level === "high" && !seenPromptRef.current) {
        seenPromptRef.current = true;
        notifyNow(
          "Want Companio to look around?",
          "Your body is showing signs of stress. Open Companio and it will check your surroundings for anything on your trigger list.",
        );
      }
    } catch {
      setResponse({ spoken_message: null, engine_error: true });
    }

    addTriggerEvent(currentPatientId, {
      trigger: "physiological distress (HR)",
      message: extra || out?.spoken_message || "Elevated heart rate detected.",
      source: "watch",
      risk_source: r.risk_source || null,
      risk_model: r.model || null,
      model_score: r.model_score ?? null,
      hr_age_minutes: r.hrAgeMinutes ?? null,
      confoundReasons: r.confoundReasons,
      decisionSource: out?.decision_source || null,
    });
  }

  const snapshotDone = useRef(0);
  const episodeRef = useRef(null);
  const acousticNotedRef = useRef(null);
  const [episodeState, setEpisodeState] = useState(null);

  async function tick() {
    const v = await readVitals();
    setVitals(v);

    const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
    const dueForSnapshot = Date.now() - (snapshotDone.current || 0) > SNAPSHOT_EVERY_MS;
    if (dueForSnapshot && currentPatientId && (v.hr != null || v.sleepHoursLastNight != null)) {
      snapshotDone.current = Date.now();
      saveDailySnapshot(currentPatientId, v).catch((e) =>
      reportSyncFailure("daily_snapshot", e, { critical: true }));
    }
    // Acoustic trigger check runs on the same tick as physiology, so a bang
    // and the heart-rate response to it land in the same episode.
    const acoustic = acousticTriggerMatch(v, me?.treatmentPlan?.knownTriggers || []);
    if (acoustic && !acousticNotedRef.current) {
      acousticNotedRef.current = Date.now();
      saveSession({
        patient_id: currentPatientId,
        type: "trigger_event",
        modality: "sound",
        known_trigger: true,
        matched_trigger: acoustic.trigger,
        sound_db: acoustic.db ?? null,
        sound_basis: acoustic.basis ?? null,
        episode_id: getEpisodeId() || null,
        message: `Loud-noise trigger detected from measured sound: ${acoustic.reason}`,
      }).catch(() => {});
    }
    if (acousticNotedRef.current && Date.now() - acousticNotedRef.current > 5 * 60 * 1000) {
      acousticNotedRef.current = null;
    }

    const r = await assessRisk(v, devices.baselineHr, {
      recentWorkout: v.recentWorkout, caffeineMgToday: v.caffeineMgToday, poorSleep: v.poorSleep, activeNow: v.activeNow, hrFreshness: v.hrFreshness, hrvFreshness: v.hrvFreshness, hrAgeMinutes: v.hrAgeMinutes, declaredContext: prefs?.declaredContext,
    }, devices.baselineProfile);
    setReading(r);

    if (!episodeRef.current) {
      episodeRef.current = newEpisode(currentPatientId);
      // The therapist must see the physiology of THIS moment, not whichever
      // 10-minute snapshot happened to precede it.
      saveSession({
        patient_id: currentPatientId,
        episode_id: episodeRef.current.episode_id,
        kind: "episode_snapshot",
        hr: v.hr ?? null, hrv: v.hrv ?? null, resting_hr: v.resting ?? null,
        steps: v.steps ?? null, sleep_hours_last_night: v.sleepHoursLastNight ?? null,
        risk_level: r.level, risk_score: r.score ?? null, risk_source: r.source ?? null,
        baseline_hr: devices.baselineHr ?? null,
        captured_at: new Date().toISOString(),
      }).catch((e) => reportSyncFailure("episode_snapshot", e, { critical: true }));
    }
    // The machine decides when enough interventions have failed, so it must see
    // the same offer list the decision path records.
    episodeRef.current.interventions = offeredActions();
    const { episode, actions } = machineStep(episodeRef.current, {
      risk: r,
      patientResponse: bannerAnswer || consumePatientResponse(),
      interventionHelped: consumeInterventionOutcome(),
      permissions: {
        autoCapture: prefs?.autoCapture !== false,
        audio: prefs?.voiceRecording !== false,
        therapistAlerts: prefs?.therapistAlerts !== false,
        caregiverEscalation: prefs?.caregiverEscalation === true,
      },
      monitoringPaused: isMonitoringPaused?.() || prefs?.physiologicalMonitoring === false,
    });
    episodeRef.current = episode;
    setEpisodeState(episode.state);

    for (const a of actions) {
      if (a.type === "OPEN_SUPPORT" || a.type === "TRY_ANOTHER_INTERVENTION") {
        await fireAlert(r, a.source === "patient_request" ? "Patient asked for support." : null);
      } else if (a.type === "CAPTURE_CONTEXT") {
        navigation.navigate("Glasses", { auto: true, episode_id: episode.episode_id });
      } else if (a.type === "OFFER_ESCALATION") {
        notifyNow("Let's bring in your therapist",
          "Tap and Companio will let them know you need them right now.", 0,
          { categoryIdentifier: CATEGORY.CHECK_IN, patient_id: currentPatientId });
      } else if (a.type === "CONFIRM_RECOVERY") {
        notifyNow("Checking in", "How are you feeling now?", 0,
          { categoryIdentifier: CATEGORY.CHECK_IN, patient_id: currentPatientId });
      } else if (a.type === "CLOSE_EPISODE") {
        const summary = endEpisode(episodeRef.current);
        saveSession({ patient_id: currentPatientId, ...summary })
          .catch((e) => reportSyncFailure("episode_summary", e, { critical: true }));
        episodeRef.current = null;
        setEpisodeState(null);
      }
    }

    if (r.level === "low" || r.level === "baseline") {
      setBannerAnswer(null); setAskedAt(null); setNudged(false);
      seenPromptRef.current = false;
      return;
    }

    if (prefs?.autoCheckIns !== false && !bannerAnswer && r.confounded && !askedAt) {
      setAskedAt(Date.now());
    }

    if (askedAt && !bannerAnswer) {
      const waited = Date.now() - askedAt;

      if (!nudged && waited > NUDGE_MS) {
        setNudged(true);
        notifyNow("Checking in", "Your heart rate is still up. Tap when you get a moment — no rush.");
      }

      // The state machine owns escalation timing now: an unanswered check-in
      // advances WATCHING -> CHECK_IN -> CONTEXT_CAPTURE -> SUPPORT on its own
      // clock. A second, independent alert path here produced double decisions.
    }
  }

  function start() { setRunning(true); setBannerAnswer(null); tick(); timer.current = setInterval(tick, POLL_MS); }
  function stop() { setRunning(false); if (timer.current) clearInterval(timer.current); }
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    try { Speech.stop(); } catch {}
  }, []);

  useEffect(() => {
    if (isMonitoringPaused?.() || !prefs?.physiologicalMonitoring) {
      if (running) stop();
      return;
    }
    if (isHealthAvailable && devices.watch && devices.calibrated && !running) start();
  }, [isHealthAvailable, devices.watch, devices.calibrated, prefs?.physiologicalMonitoring, monitoringPausedTick]);

  const showBanner = prefs?.autoCheckIns !== false && running && reading && reading.level !== "low" && reading.level !== "baseline" && reading.level !== "unknown" && !reading.activeNow && !reading.confounded && !bannerAnswer;

  const levelColor = reading?.level === "high" ? C.danger : reading?.level === "elevated" ? C.warning : C.success;

  return (
    <Screen>
      <AppHeader title="Live monitoring" subtitle="Real-time signal from your watch" onBack={() => navigation.goBack()} />

      {!isHealthAvailable ? (
        <Card accent={C.warning}>
          <Row icon="information-circle" iconFg={C.warning} iconBg={C.warningSoft} title="Needs the development build" subtitle="Live Health data can't be read inside Expo Go" />
          <Text style={[type.sub, { marginTop: 8 }]}>Run Companio as a dev build on your iPhone, then this screen reads your heart rate live and reacts in real time.</Text>
        </Card>
      ) : !devices.calibrated ? (
        <Card accent={C.teal}>
          <Row icon="body" iconFg={C.teal} iconBg={C.tealSoft} title="Calibrate first" subtitle="The monitor compares to your calm resting baseline" />
          <View style={{ marginTop: spacing.md }}><Btn label="Go to calibration" color={C.teal} icon="body" onPress={() => navigation.navigate("ConnectWatch")} /></View>
        </Card>
      ) : (
        <>
          <ConfoundBanner
            visible={showBanner}
            onAnswer={(label) => setBannerAnswer(label === "Just worked out" ? "workout" : label === "Had caffeine" ? "caffeine" : "dismissed")}
            onDismiss={() => setBannerAnswer("dismissed")}
          />

          <Card accent={levelColor}>
            <View style={{ alignItems: "center", paddingVertical: spacing.sm }}>
              <Ionicons name="heart" size={26} color={C.danger} />
              <Text style={{ fontSize: 48, fontWeight: "800", color: C.textPrimary, letterSpacing: -1 }}>{reading?.hr ?? "—"}</Text>
              <Text style={type.meta}>bpm · resting baseline {devices.baselineHr ?? "—"}</Text>
              {reading ? <View style={{ marginTop: 8 }}><RiskBadge level={reading.level} /></View> : null}
            </View>
            {reading?.score != null ? (
              <>
                <RiskGauge score={reading.score} thresholds={[0.175, 0.5]} />
                <Text style={[type.meta, { textAlign: "center", marginTop: 4 }]}>live distress {reading.score.toFixed(2)} · HRV {reading.hrv ?? "—"} ms</Text>
              </>
            ) : null}
          </Card>

          {reading?.level === "high" && reading?.activeNow ? (
            <Card accent={C.teal}>
              <Row icon="walk" iconFg={C.teal} iconBg={C.tealSoft} title="Likely explained by activity" subtitle="Recent steps suggest you're moving right now — no alert was sent automatically." />
              <View style={{ marginTop: spacing.md }}><Btn label="This isn't from activity — check on me anyway" variant="outline" color={C.danger} icon="alert-circle" onPress={() => fireAlert(reading, "Elevated heart rate — patient indicated this was NOT from activity despite recent movement.")} /></View>
            </Card>
          ) : reading?.level === "high" ? (
            <Card accent={C.danger}>
              <Row icon="alert-circle" iconFg={C.danger} iconBg={C.dangerSoft} title="Your heart rate is elevated" subtitle="Let's bring it down together" />
              <View style={{ marginTop: spacing.md }}>
                <Btn label="Start grounding now" color={C.teal} icon="leaf" onPress={() => navigation.navigate("Support")} />
                <Btn label="Let Companio look around" icon="camera" variant="outline"
                  onPress={() => navigation.navigate("Glasses")} />
              </View>
              {reading.confounded ? <Text style={[type.meta, { marginTop: 8 }]}>Also noted: {reading.confoundReasons.join(", ")}.</Text> : null}
            </Card>
          ) : null}

          {response ? (
            <Card accent={C.primary}>
              <Text style={type.meta}>COMPANIO RESPONDED</Text>
              {response.engine_error ? (
                <Text style={[type.sub, { marginTop: 6, color: C.danger }]}>
                  Couldn't reach the decision engine, so nothing was said aloud. The reading is still recorded for your therapist.
                </Text>
              ) : (
                <>
                  <Text style={[type.body, { marginTop: 6, fontSize: 16 }]}>{response.spoken_message}</Text>
                  {response.selected_action || response.action ? (
                    <ResourceList patientId={currentPatientId} prefs={prefs} vitals={vitals}
                      autoPlay
                      resources={resourcesFor(
                        me?.treatmentPlan?.interventionResources,
                        response.selected_action || response.action)} />
                  ) : null}
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
                    {response.decision_source ? <DecisionSourceBadge source={response.decision_source} /> : null}
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity onPress={() => { const m = response.spoken_message; if (m) speakSafely(m, prefs, SPEECH_PRIORITY.URGENT); }} hitSlop={10}>
                      <Ionicons name="volume-high" size={22} color={C.primary} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Card>
          ) : null}
          {response?.trace ? <EngineTrace trace={response.trace} source={response.decision_source} /> : null}

          <View style={{ marginTop: spacing.md }}>
            {running
              ? <Btn label="Stop monitoring" variant="outline" color={C.danger} icon="stop" onPress={stop} />
              : <Btn label="Start live monitoring" icon="pulse" onPress={start} />}
          </View>
          {vitals?.activeNow && (vitals.activityReasons || []).length ? (
            <Text style={[type.meta, { marginTop: 8, color: C.success }]}>
              {`Movement detected — ${vitals.activityReasons.join(" · ")}`}
            </Text>
          ) : null}
          {prefs?.declaredContext && prefs.declaredContext.expires_at > Date.now() ? (
            <Text style={[type.meta, { marginTop: 6, color: C.success }]}>
              {`You told Companio: ${prefs.declaredContext.labels?.join(", ")}`}
            </Text>
          ) : null}
          {devices?.baselineHr ? (
            <Text style={[type.meta, { marginTop: 8 }]}>
              {`Compared against your resting baseline of ${devices.baselineHr} bpm`}
              {reading?.hr != null ? ` · now ${reading.hr} bpm` : ""}
              {devices.baselineHr > 85 ? " · that baseline looks high — recalibrate while sitting still" : ""}
            </Text>
          ) : (
            <Text style={[type.meta, { marginTop: 8 }]}>
              No resting baseline recorded yet — Companio is comparing against a general average, which is far less accurate for you. Calibrate in Devices.
            </Text>
          )}
          <Text style={[type.meta, { marginTop: 10 }]}>
            {reading?.risk_source === RISK_SOURCE.TRAINED
              ? `Checks every 15s · scored by the trained model (${reading.model}). Trained on Apple Watch-available signals only — the full 16-feature WESAD model needs EDA and skin temperature, which this hardware cannot provide.`
              : `Checks every 15s · trained model unavailable, using the heart-rate/HRV comparison against your baseline instead.${reading?.fallback_reason ? ` (${reading.fallback_reason})` : ""}`}
          </Text>
        </>
      )}
      <Disclaimer />
    </Screen>
  );
}
