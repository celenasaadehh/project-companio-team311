// Camera capture, triggered by physiological change.
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Speech from "expo-speech";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, Chip, Disclaimer, DecisionSourceBadge, EngineTrace, CrisisContacts } from "../components/ui";
import { apiCall, recognizeImage, saveSession } from "../services/engine";
import { uploadImage } from "../services/media";
import { speak as speakSafely, SPEECH_PRIORITY } from "../services/speech";
import { matchTrigger } from "../services/triggers";
import { createCameraProvider, CameraProviderType } from "../services/cameraProvider";
import { decideMoment } from "../services/decide";
import { FollowUpCheck } from "../components/followup";
import { assessRisk } from "../services/risk";
import { getEpisodeId } from "../services/episode";
import { deleteMedia } from "../services/engine";
import { ResourceList, resourcesFor } from "../components/resource_player";
import { reportSyncFailure } from "../services/errors";
import { notifyNow } from "../services/notify";
import { useApp } from "../state/AppContext";
import { startEpisode } from "../services/episode";

const SCAN_MS_CALM = 45000;
const SCAN_MS_ELEVATED = 12000;

function orientationLine(trigger, labels) {
  const top = (labels || [])
    .filter((l) => (l.confidence ?? l.Confidence ?? 0) >= 70)
    .map((l) => (l.name || l.Name || "").toLowerCase())
    .filter(Boolean)
    .slice(0, 2);

  const seen = top.length ? top.join(" and ") : null;

  if (trigger && seen) {
    return `${trigger} is on your trigger list, and I can see why this caught you. What the camera is picking up is ${seen}. I know it can look like something else. I'm here with you.`;
  }
  if (trigger) {
    return `${trigger} is on your trigger list. I know it can feel like more than it is. I'm here with you.`;
  }
  if (seen) {
    return `What I can see around you is ${seen}. I'm here with you.`;
  }
  return null;
}

export function PatientGlasses({ navigation, route }) {
  const { currentPatientId, addTriggerEvent, patient, vitals, devices, askFollowupQuestions, prefs, refreshMyProfile  } = useApp();
  const me = patient ? patient(currentPatientId) : null;
  const knownTriggers = me?.treatmentPlan?.knownTriggers || [];
  useEffect(() => { refreshMyProfile?.(); }, []);

  // Arriving from the state machine's CAPTURE_CONTEXT means physiology has
  // already justified one frame: capture immediately rather than waiting for
  // this screen's own polling loop to come around.
  useEffect(() => {
    if (!route?.params?.auto) return undefined;
    const t = setTimeout(() => { try { scan(); } catch {} }, 800);
    return () => clearTimeout(t);
  }, [route?.params?.auto]);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const cameraProvider = useRef(createCameraProvider(CameraProviderType.PHONE)).current;
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [result, setResult] = useState(null);
  const [autoScan, setAutoScan] = useState(true);
  const scanningRef = useRef(false);
  const lastRiskRef = useRef(null);
  const [autoReason, setAutoReason] = useState(null);

  useEffect(() => { if (permission && !permission.granted && permission.canAskAgain) requestPermission(); }, [permission?.granted]);

  useEffect(() => {
    if (!prefs?.autoCapture) return;
    if (!autoScan || !permission?.granted) return;
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled || scanningRef.current) { schedule(); return; }

      const live = vitals?.hr && devices?.baselineHr
        ? await assessRisk(vitals, devices.baselineHr, {
            recentWorkout: vitals.recentWorkout,
            caffeineMgToday: vitals.caffeineMgToday,
            poorSleep: vitals.poorSleep,
            activeNow: vitals.activeNow,
            hrFreshness: vitals.hrFreshness,
            hrvFreshness: vitals.hrvFreshness,
            hrAgeMinutes: vitals.hrAgeMinutes, declaredContext: prefs?.declaredContext
          }, devices?.baselineProfile)
        : null;

      const elevated = live && ["elevated", "high"].includes(live.level);
      const confounded = live?.confounded || live?.activeNow;

      if (elevated && !confounded) {
        setAutoReason(live.level === "high"
          ? "Your heart rate is well above your baseline."
          : "Your heart rate is above your baseline.");
        await scan();
      } else {
        setAutoReason(null);
      }
      if (!cancelled) schedule();
    };

    const schedule = () => {
      const elevated = ["elevated", "high"].includes(lastRiskRef.current);
      timer = setTimeout(tick, elevated ? SCAN_MS_ELEVATED : SCAN_MS_CALM);
    };

    timer = setTimeout(tick, 2500);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [autoScan, permission?.granted, prefs?.autoCapture,
      vitals?.hr, vitals?.hrv, devices?.baselineHr]);

  const goGround = () => { try { navigation.navigate("Support"); } catch {} };

  const speak = (msg) => speakSafely(msg, prefs, SPEECH_PRIORITY.SUPPORT);

  async function scan() {
    if (currentPatientId) startEpisode(currentPatientId, "camera_scan");

    if (scanningRef.current) return;
    scanningRef.current = true;
    setLoading(true);
    let result = null;
    try {
      const pic = await cameraProvider.captureImage(cameraRef, { quality: 0.5 });
      const { s3_key } = await uploadImage(currentPatientId, pic.uri, "image/jpeg");
      const rek = await recognizeImage(s3_key, currentPatientId);
      const labels = rek?.labels || [];
      const m = matchTrigger(labels, knownTriggers);
      const topLabel = labels[0]?.name || m.normalized_concepts[0] || "your surroundings";

      const liveNow = vitals?.hr && devices?.baselineHr
        ? await assessRisk(vitals, devices.baselineHr, {
            recentWorkout: vitals.recentWorkout, caffeineMgToday: vitals.caffeineMgToday,
            poorSleep: vitals.poorSleep, activeNow: vitals.activeNow,
            hrFreshness: vitals.hrFreshness, hrvFreshness: vitals.hrvFreshness,
            hrAgeMinutes: vitals.hrAgeMinutes, declaredContext: prefs?.declaredContext
          }, devices?.baselineProfile)
        : null;
      // null = no live reading. Only a real elevated reading corroborates;
      // "we couldn't measure" must never be presented as "the body reacted".
      const bodyAgrees = liveNow
        ? (liveNow.level === "elevated" || liveNow.level === "high" || liveNow.level === "critical")
        : null;
      const corroborated = m.known_trigger && bodyAgrees === true;
      result = {
        detected: m.known_trigger ? m.candidate_trigger : topLabel,
        is_trigger: corroborated,
        seen_but_calm: m.known_trigger && bodyAgrees === false,
        why: corroborated
          ? "matches a trigger your therapist recorded, and your body reacted"
          : m.known_trigger && bodyAgrees === false
            ? "matches a recorded trigger, but your body stayed calm"
            : m.known_trigger
              ? "matches a recorded trigger; no live physiological reading was available"
              : "",
        risk_level: liveNow?.level || null,
        message: null,
        labels, normalized: m.normalized_concepts, s3_key,
        trigger_match_score: m.trigger_match_score,
        source: "aws_rekognition",
      };

      if (currentPatientId) {
        try {
          const baselineHr = devices?.baselineHr;
          const live = vitals?.hr && baselineHr ? await assessRisk(vitals, baselineHr, { recentWorkout: vitals.recentWorkout, caffeineMgToday: vitals.caffeineMgToday, poorSleep: vitals.poorSleep, activeNow: vitals.activeNow, hrFreshness: vitals.hrFreshness, hrvFreshness: vitals.hrvFreshness, hrAgeMinutes: vitals.hrAgeMinutes, declaredContext: prefs?.declaredContext
          }, devices?.baselineProfile) : null;
          const decision = await decideMoment({
            patient_id: currentPatientId,
            risk_level: m.known_trigger ? (live?.level || "elevated") : (live?.level || "baseline"),
            risk_score: m.known_trigger ? (live?.score ?? 0.6) : (live?.score ?? 0.25),
            visual_labels: labels,
            normalized_visual_trigger: m.candidate_trigger || null,
            // Confirmed evidence only. Raw scene concepts (road, tree, truck
            // when unmatched) go in visual_labels as context -- putting them
            // here made the unseen engine treat ordinary scenery as distress
            // corroboration and skip the abstention gate.
            observed_triggers: m.known_trigger && m.candidate_trigger
              ? [m.candidate_trigger]
              : [],
            sleep_hours_last_night: vitals?.sleepHoursLastNight ?? null,
            poor_sleep: !!vitals?.poorSleep,
          });
          result.message = decision.spoken_message || decision.message || null;
          result.decision_source = decision.decision_source;
          result.selected_action = decision.selected_action || decision.action || null;
          result.trace = decision.trace || null;
        } catch (decisionErr) {
          console.warn("Decision hierarchy unreachable:", decisionErr);
          result.engine_error = decisionErr?.message || "Could not reach the decision engine.";
        }
        try {
          await saveSession({
            patient_id: currentPatientId,
            type: "trigger_event",
            camera_source: "phone_camera",
            image_s3_key: prefs?.saveImages ? s3_key : null,
            image_retained: !!prefs?.saveImages,
            visual_labels: labels,
            normalized_visual_trigger: m.candidate_trigger,
            known_trigger: !!m.known_trigger,
            matched_trigger: m.known_trigger ? m.candidate_trigger : null,
            physiology_present: !!liveNow,
            corroborated: corroborated,
            risk_level: liveNow?.level ?? null,
            risk_score: liveNow?.score ?? null,
            hr: vitals?.hr ?? null,
            episode_id: route?.params?.episode_id || getEpisodeId() || null,
            trigger_match_score: m.trigger_match_score,
            decision_source: result.decision_source || null,
            message: result.message,
          });
        } catch (sessionErr) {
          console.warn("Trigger detected but AWS session save failed:", sessionErr);
        }
        // Retention off means the object itself goes, not just its reference.
        // Rekognition has already read it; keeping the bytes would make the
        // privacy switch a promise the app cannot keep.
        if (!prefs?.saveImages && s3_key) {
          deleteMedia(s3_key, currentPatientId).catch((e) =>
            reportSyncFailure("media_delete_image", e, { critical: true }));
        }
      }
    } catch (e) {
      result = { error: e?.message || "Scan couldn't complete. Check your connection and try again.", source: "error" };
    }
    setResult(result); setLive(result?.source === "aws_rekognition"); setLoading(false);
    lastRiskRef.current = result?.risk_level || null;
    scanningRef.current = false;
    if (result?.is_trigger || result?.seen_but_calm) {
      notifyNow(
        "Did that affect you?",
        `Companio noticed ${result.detected}. Tap to tell it whether that was a hard moment — it learns from your answer.`,
      );
    }

    if (result?.message && (result.is_trigger || result.decision_source === "ai_reasoning")) {
      const orient = result.is_trigger
        ? orientationLine(result.detected, result.labels)
        : null;
      result.orientation = orient;
      speak(orient ? `${orient} ${result.message}` : result.message);

      const action = String(result.selected_action || result.message || "").toLowerCase();
      if (/5-?4-?3-?2-?1|grounding/.test(action)) {
        setTimeout(() => { try { navigation.navigate("Support", { auto: true }); } catch {} }, 4500);
      }
      if (currentPatientId) addTriggerEvent(currentPatientId, {
        trigger: result.detected, message: result.message,
        source: result.camera_source || "phone_camera",
        labels: result.labels, s3_key: result.s3_key, normalized: result.normalized, score: result.trigger_match_score,
        decisionSource: result.decision_source,
      });
    }
  }

  return (
    <Screen>
      <AppHeader title="Companio glasses" subtitle="Your phone is the glasses — camera watches, speaker talks you down" onBack={() => navigation.goBack()} />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {permission && permission.granted ? (
          <CameraView ref={cameraRef} style={{ height: 230 }} facing="back" />
        ) : (
          <View style={{ height: 230, alignItems: "center", justifyContent: "center", backgroundColor: "#0d1526" }}>
            <Ionicons name="videocam-off" size={30} color="#9db4ff" />
            <Text style={{ color: "#c8d4f0", marginTop: 8 }}>Camera off</Text>
            <View style={{ marginTop: 12, width: 180 }}><Btn label="Enable camera" onPress={requestPermission} icon="camera" /></View>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: permission?.granted ? C.success : C.textMuted, marginRight: 8 }} />
          <Text style={type.sub}>{permission?.granted ? "Camera active · watching for your therapist-recorded triggers" : "Camera access needed to scan your surroundings"}</Text>
        </View>
      </Card>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.md, marginBottom: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={type.title}>Watching automatically</Text>
          <Text style={[type.sub, { marginTop: 2 }]}>
            {autoScan
              ? "The camera stays off while your body is at its baseline. It looks only when your heart rate rises — so a photo always has a reason behind it."
              : "Automatic watching is off. Tap Scan to look once."}
          </Text>
        </View>
        <Switch value={autoScan} onValueChange={setAutoScan} />
      </View>
      {autoScan && autoReason ? (
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.warningSoft,
                       borderRadius: radius.md, padding: 12, marginBottom: spacing.sm }}>
          <Ionicons name="pulse" size={18} color={C.warning} />
          <Text style={[type.sub, { flex: 1, marginLeft: 10, color: C.textPrimary }]}>
            {`Looking now — ${autoReason}`}
          </Text>
        </View>
      ) : null}
      <View><Btn label={loading ? "Looking…" : "Scan now"} onPress={scan} icon="scan"
        variant={autoScan ? "outline" : "solid"} disabled={!permission?.granted || loading} /></View>
      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 14 }} /> : null}

      {result?.error ? (
        <Card accent={C.danger} style={{ marginTop: spacing.md }}>
          <Row icon="cloud-offline" iconFg={C.danger} iconBg={C.dangerSoft} title="Scan couldn't complete" subtitle={result.error} />
          <View style={{ marginTop: spacing.md }}><Btn label="Try again" icon="refresh" variant="outline" onPress={scan} /></View>
        </Card>
      ) : null}

      {result && result.is_trigger ? (
        <Card accent={C.warning} style={{ marginTop: spacing.md }}>
          <Row icon="alert-circle" iconFg={C.warning} iconBg={C.warningSoft} title={`Detected: ${result.detected}`} subtitle={result.why} />
          {result.orientation
            ? <Text style={[type.body, { marginTop: 10, fontSize: 16 }]}>{result.orientation}</Text>
            : null}
          {result.message
            ? <Text style={[type.body, { marginTop: 10, fontSize: 16 }]}>{result.message}</Text>
            : <Text style={[type.sub, { marginTop: 10, color: C.danger }]}>{result.engine_error || "The decision engine couldn't be reached, so Companio has nothing to say here yet."}</Text>}
          {result.selected_action ? (
            <ResourceList patientId={currentPatientId} prefs={prefs} vitals={vitals}
              autoPlay
              actionKey={result.selected_action}
              resources={resourcesFor(
                me?.treatmentPlan?.interventionResources, result.selected_action)} />
          ) : null}
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <View style={{ flex: 1, marginRight: 6 }}><Btn label="Start grounding" color={C.teal} icon="leaf" onPress={goGround} /></View>
            <View style={{ width: 52 }}><Btn label="" icon="volume-high" variant="outline" onPress={() => speak(result.message)} /></View>
          </View>
          <Text style={[type.meta, { marginTop: 4 }]}>Sent to your therapist as a trigger event.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
            <View style={{ marginRight: 6, marginBottom: 6 }}><Pill text="AWS Rekognition · live" fg={C.success} bg={C.successSoft} icon="cloud-done" /></View>
            {result.decision_source ? <DecisionSourceBadge source={result.decision_source} /> : null}
          </View>
        </Card>
      ) : null}
      {result && result.is_trigger && result.decision_source ? (
        <View key={result.s3_key || "trigger-followup"}>
        {result?.known_trigger || result?.corroborated ? (
          <CrisisContacts
            therapistName={patient?.(currentPatientId)?.therapistName}
            caregiver={patient?.(currentPatientId)?.caregiver}
            note="This is a trigger your therapist recorded for you. You don't have to handle it alone."
            onContactTherapist={() => navigation.navigate("RequestSupport")}
          />
        ) : null}

          <FollowUpCheck patientId={currentPatientId} baseContext={{ patient_id: currentPatientId, normalized_visual_trigger: result.detected, observed_triggers: [result.detected] }} autoAsk={askFollowupQuestions}
            previousAction={result?.selected_action || null}
            previousMessage={result?.message || null} />
        </View>
      ) : null}
      {result?.seen_but_calm ? (
        <Card accent={C.accentBlue} style={{ marginTop: spacing.md }}>
          <Row icon="eye" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
            title={`Saw ${result.detected}`}
            subtitle="This is on your trigger list, but your body stayed calm — so Companio didn't treat it as an episode." />
          <Text style={[type.meta, { marginTop: 8 }]}>Recorded for your therapist either way.</Text>
        </Card>
      ) : null}

      {result && !result.is_trigger && !result.seen_but_calm && !result.error ? (
        <Card accent={C.success} style={{ marginTop: spacing.md }}>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
            title={result.decision_source ? "Companio looked at this" : "Nothing matching your triggers"}
            subtitle={`Seen: ${result.detected}`} />
          {result.message ? <Text style={[type.body, { marginTop: 10 }]}>{result.message}</Text> : null}
          {result.decision_source ? <View style={{ marginTop: 8 }}><DecisionSourceBadge source={result.decision_source} /></View> : null}
          {result.trace ? <EngineTrace trace={result.trace} source={result.decision_source} /> : null}
          <Pill text="AWS Rekognition · live" fg={C.success} bg={C.successSoft} icon="cloud-done" />
        </Card>
      ) : null}
      <Text style={[type.meta, { marginTop: 12 }]}>
        Companio never claims a diagnosis. It notices a possible physiological trigger and offers a calming, therapist-approved response.
      </Text>
      <Disclaimer />
    </Screen>
  );
}
