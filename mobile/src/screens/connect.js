// Device pairing and baseline calibration.
import React, { useState, useEffect } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCameraPermissions } from "expo-camera";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, MetricCard, Disclaimer } from "../components/ui";
import { useApp } from "../state/AppContext";
import { reportSyncFailure } from "../services/errors";

const LIVE_REFRESH_MS = 15000;
import { isHealthAvailable, requestHealthAuth, readVitals, healthDebug } from "../services/health";
import { createCameraProvider, CameraProviderType } from "../services/cameraProvider";
import { THERAPIST_ENGINE_URL } from "../config";
import { saveDailySnapshot } from "../services/alerts";

export function ConnectDevices({ navigation }) {
  const { devices } = useApp();
  return (
    <Screen>
      <AppHeader title="Devices" subtitle="Connect your wearables to Companio" onBack={() => navigation.goBack()} />
      <Card onPress={() => navigation.navigate("ConnectWatch")}>
        <Row icon="watch" iconFg={C.primary} iconBg={C.primarySoft} title="Smart watch" subtitle="Heart rate · HRV · steps via Apple Health"
          right={<Pill text={devices.watch ? "Connected" : "Set up"} fg={devices.watch ? C.success : C.textSecondary} bg={devices.watch ? C.successSoft : "#EEF1F6"} />} />
      </Card>
      <Card onPress={() => navigation.navigate("ConnectGlasses")}>
        <Row icon="glasses" iconFg={C.teal} iconBg={C.tealSoft} title="Companio Glasses" subtitle="Camera + mic trigger awareness"
          right={<Pill text={devices.glasses ? "Connected" : "Set up"} fg={devices.glasses ? C.success : C.textSecondary} bg={devices.glasses ? C.successSoft : "#EEF1F6"} />} />
      </Card>
      <Disclaimer />
    </Screen>
  );
}

export function ConnectWatch({ navigation }) {
  const { vitals, setVitals, devices, setDevices, currentPatientId } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calWindows, setCalWindows] = useState(0);
  const [calErr, setCalErr] = useState(null);
  const [rawErr, setRawErr] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const calibrated = devices.calibrated;

  const CAL_SAMPLES = 6;
  const CAL_INTERVAL_MS = 5000;

  function runCalibration() {
    setCalErr(null);
    setCalibrating(true); setCalWindows(0);
    let n = 0;
    const readings = [];
    let lastSampleAt = null;
    const liveHr = [];
    const liveHrv = [];
    let usedLiveHr = false;
    const t = setInterval(async () => {
      n += 1;
      try {
        const v = await readVitals();
        // Polling every few seconds re-reads whatever HealthKit's latest
        // sample is. Six reads of ONE sample are one reading, not six --
        // only a sample with a new timestamp counts toward the baseline.
        const isNewSample = v.hrAt == null || v.hrAt !== lastSampleAt;
        if (v.hrAt != null) lastSampleAt = v.hrAt;
        const restingValue = v.resting ?? null;
        const usable = restingValue ?? (v.activeNow ? null : v.hr ?? null);
        if (restingValue == null && usable != null) usedLiveHr = true;
        if (usable != null && isNewSample) readings.push(Number(usable));
        if (v.hr != null && isNewSample) liveHr.push(Number(v.hr));
        if (v.hrv != null && isNewSample) liveHrv.push(Number(v.hrv));
      } catch {
      }
      setCalWindows(n);

      if (n >= CAL_SAMPLES) {
        clearInterval(t); setCalibrating(false);
        if (readings.length === 0) {
          setCalErr(usedLiveHr === false && liveHr.length
            ? "You appear to be moving, so none of those readings could be used as a resting baseline. Sit still for a minute and try again."
            : "No heart-rate data was available, so no baseline could be recorded. Connect your watch and make sure it has synced recent heart-rate readings into Apple Health, then try again.");
          return;
        }
        const baselineHr = Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
        if (baselineHr > 90) {
          setCalErr(`Those readings averaged ${baselineHr} bpm, which is too high to be a resting baseline — Companio would then treat an elevated heart rate as normal. Sit still for a few minutes and try again.`);
          return;
        }
        const distinct = new Set(readings).size;
        // Reading HealthKit every 5 s can return the SAME latest sample six
        // times: six copies of one number is one measurement, not a baseline.
        if (distinct < 2 && readings.length >= 3) {
          setCalErr("Every reading came back identical, which usually means the watch has not synced fresh samples yet. Open the Watch's Heart Rate app for a few seconds, then try again.");
          return;
        }
        const stats = (arr) => {
          if (!arr.length) return { mean: null, std: null };
          const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
          if (arr.length < 2) return { mean, std: null };
          const varr = arr.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (arr.length - 1);
          const std = Math.sqrt(varr);
          return { mean, std: std > 0 ? std : null };
        };
        const hrStats = stats(liveHr);
        const hrvStats = stats(liveHrv);
        const ibiArr = liveHr.filter((x) => x > 0).map((x) => 60 / x);
        const ibiStats = stats(ibiArr);

        setDevices((d) => ({
          ...d, calibrated: true, baselineHr,
          baselineProfile: {
            hr_mean: hrStats.mean, hr_std: hrStats.std,
            hrv_mean: hrvStats.mean, hrv_std: hrvStats.std,
            ibi_mean: ibiStats.mean, ibi_std: ibiStats.std,
            samples: liveHr.length,
            built_at: new Date().toISOString(),
          },
          baselineSamples: readings.length,
          baselineDistinct: distinct,
        }));
      }
    }, CAL_INTERVAL_MS);
  }

  useEffect(() => {
    try {
      const q = new URLSearchParams({
        healthdebug: "1",
        native: String(healthDebug.nativeExists),
        keys: String(healthDebug.nativeKeys),
        nativeInit: String(healthDebug.nativeHasInit),
        wrapperKeys: String(healthDebug.wrapperKeys),
        wrapperInit: String(healthDebug.wrapperHasInit),
        shape: String(healthDebug.moduleShape || ""),
        err: String(healthDebug.error || ""),
        available: String(isHealthAvailable),
      }).toString();
      fetch(`${THERAPIST_ENGINE_URL}/?${q}`).catch(() => {});
    } catch {}
  }, []);

  async function connect() {
    setBusy(true); setErr(null);
    const auth = await requestHealthAuth();
    if (!auth.ok) {
      setErr(auth.reason === "unavailable" ? "unavailable" : auth.reason === "timeout" ? "timeout" : "denied");
      setRawErr(auth.reason ? String(auth.reason) : "no reason returned");
      setBusy(false);
      return;
    }
    setRawErr(null);
    const v = await readVitals();
    setVitals(v);
    const gotRealData = v.hr != null || v.resting != null || v.steps != null || v.sleepHoursLastNight != null;
    setDevices((d) => ({ ...d, watch: true }));
    if (gotRealData && currentPatientId) saveDailySnapshot(currentPatientId, v).catch((e) =>
      reportSyncFailure("daily_snapshot", e, { critical: true }));
    if (!gotRealData) setErr("nodata");
    setBusy(false);
  }
  async function refresh() {
    setBusy(true);
    setVitals(await readVitals());
    setLastRefresh(new Date());
    setBusy(false);
  }

  useEffect(() => {
    if (!isHealthAvailable || !devices.watch) return;
    let cancelled = false;
    const tick = async () => {
      const v = await readVitals();
      if (!cancelled) { setVitals(v); setLastRefresh(new Date()); }
    };
    tick();
    const id = setInterval(tick, LIVE_REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isHealthAvailable, devices.watch]);

  return (
    <Screen>
      <AppHeader title="Smart watch" subtitle="Live vitals via Apple Health" onBack={() => navigation.goBack()} />

      <Card accent={C.teal}>
        <Row icon="body" iconFg={C.teal} iconBg={C.tealSoft}
          title={calibrated ? "Calm baseline saved" : "Personal calibration"}
          subtitle="The engine compares your live physiology to your OWN calm baseline"
          right={calibrated ? <Pill text="Calibrated" fg={C.success} bg={C.successSoft} icon="checkmark" /> : null} />
        {!calibrated ? (
          <View style={{ marginTop: spacing.md }}>
            {calibrating
              ? <><ActivityIndicator color={C.teal} /><Text style={[type.meta, { textAlign: "center", marginTop: 6 }]}>Recording calm readings… {calWindows}/{CAL_SAMPLES}</Text></>
              : <Btn label="Start calm calibration" color={C.teal} icon="body" onPress={runCalibration}
                  disabled={!isHealthAvailable || !devices.watch} />}
            {!isHealthAvailable ? (
              <Text style={[type.meta, { marginTop: 8, textAlign: "center" }]}>Needs the development build on a real iPhone — calibration reads live Health data.</Text>
            ) : !devices.watch ? (
              <Text style={[type.meta, { marginTop: 8, textAlign: "center" }]}>Connect your watch below first — there's nothing to measure a baseline from yet.</Text>
            ) : null}
            {calErr ? <Text style={[type.meta, { marginTop: 8, color: C.danger, textAlign: "center" }]}>{calErr}</Text> : null}
          </View>
        ) : null}
        <Text style={[type.meta, { marginTop: 8 }]}>
          Takes {CAL_SAMPLES} real heart-rate readings from Apple Health over about 30 seconds and averages them into your personal resting baseline, stored on this device.
        </Text>
        <Text style={[type.meta, { marginTop: 6 }]}>
          This calibrates your baseline — not a machine-learning model. Live monitoring compares your heart rate and HRV against this number.
        </Text>
      </Card>

      {!isHealthAvailable ? (
        <Card accent={C.warning}>
          <Row icon="information-circle" iconFg={C.warning} iconBg={C.warningSoft}
            title="Apple Health isn't reachable"
            subtitle="The HealthKit module isn't responding on this device" />
          <Text style={[type.body, { marginTop: 10 }]}>
            Companio reads vitals from Apple Health, which most watches (Apple Watch, and many Zepp / Fitbit / Garmin setups) sync into. That needs the native HealthKit module, and it isn't answering right now.
          </Text>
          <Text style={[type.sub, { marginTop: 8, lineHeight: 22 }]}>
            This is expected in two cases: the iOS Simulator, which has no Health data at all, and Expo Go. On a real device in a development build it means the native module didn't load — the diagnostic below says which.
          </Text>
          <Text style={[type.meta, { marginTop: 10 }]}>No fake numbers are shown here. Once the dev build runs, this screen fills with your real heart rate, HRV and steps.</Text>
          <Text selectable style={[type.meta, { marginTop: 10, letterSpacing: 0, color: C.textSecondary }]}>
            Diagnostic: native={String(healthDebug.nativeExists)} keys={String(healthDebug.nativeKeys)} nativeInit={String(healthDebug.nativeHasInit)} wrapperKeys={String(healthDebug.wrapperKeys)} wrapperInit={String(healthDebug.wrapperHasInit)} shape=[{String(healthDebug.moduleShape)}]{healthDebug.error ? ` err=${healthDebug.error}` : ""}
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <Row icon="watch" iconFg={C.primary} iconBg={C.primarySoft} title={devices.watch ? "Watch connected" : "Connect your watch"} subtitle="Reads Heart Rate, HRV, Resting HR, Steps" />
            <View style={{ marginTop: spacing.md }}>
              {busy ? <ActivityIndicator color={C.primary} /> :
                <Btn label={devices.watch ? "Refresh vitals" : "Grant Health access"} icon={devices.watch ? "refresh" : "heart"} onPress={devices.watch ? refresh : connect} />}
            </View>
            {devices.watch && !busy ? (
              <TouchableOpacity accessibilityLabel="Disconnect watch" activeOpacity={0.8}
                onPress={() => setDevices((d) => ({ ...d, watch: false, calibrated: null }))}
                style={{ marginTop: 12, alignItems: "center" }}>
                <Text style={{ color: C.danger, fontWeight: "700", fontSize: 13.5 }}>
                  Disconnect watch
                </Text>
                <Text style={[type.meta, { marginTop: 3, textAlign: "center" }]}>
                  Clears the pairing and your saved calm baseline so you can set up again.
                </Text>
              </TouchableOpacity>
            ) : null}
            {err === "denied" ? <Text style={[type.meta, { marginTop: 8, color: C.danger }]}>Health access was not granted. Enable it in Settings → Privacy → Health → Companio.</Text> : null}
            {err === "timeout" ? <Text style={[type.meta, { marginTop: 8, color: C.danger }]}>Apple Health didn't respond. Open Settings → Privacy &amp; Security → Health → Companio and allow access, then try again.</Text> : null}
            {rawErr ? (
              <Text selectable style={[type.meta, { marginTop: 8, color: C.textSecondary, letterSpacing: 0 }]}>
                Technical detail (for debugging): {rawErr}
              </Text>
            ) : null}
            {err === "nodata" ? <Text style={[type.meta, { marginTop: 8, color: C.warning }]}>Connected, but Apple Health has no readings yet. If you use a Zepp/Amazfit, Garmin or Fitbit watch, open its own app and turn ON syncing to Apple Health (heart rate, steps, sleep) — Companio can only read what's actually in Health.</Text> : null}
          </Card>

          {vitals ? (
            <>
              <SectionTitle>Live from your watch</SectionTitle>
              <View style={{ flexDirection: "row" }}>
                <MetricCard icon="heart" label="Heart rate" value={vitals.hr ?? "—"} fg={C.danger} bg={C.dangerSoft} />
                <MetricCard icon="pulse" label="HRV (ms)" value={vitals.hrv ?? "—"} fg={C.teal} bg={C.tealSoft} />
              </View>
              <View style={{ flexDirection: "row" }}>
                <MetricCard icon="bed" label="Resting HR" value={vitals.resting ?? "—"} fg={C.lavender} bg={C.lavenderSoft} />
                <MetricCard icon="walk" label="Steps today" value={vitals.steps ?? "—"} fg={C.primary} bg={C.primarySoft} />
              </View>
              <View style={{ flexDirection: "row" }}>
                <MetricCard icon="moon" label="Sleep last night" value={vitals.sleepHoursLastNight != null ? `${vitals.sleepHoursLastNight}h` : "—"}
                  sub={vitals.poorSleep ? "Below your usual — may affect today" : undefined}
                  fg={vitals.poorSleep ? C.warning : C.teal} bg={vitals.poorSleep ? C.warningSoft : C.tealSoft} />
                <MetricCard icon="flame" label="Active energy" value={vitals.activeEnergy ?? "—"} sub="kcal today" fg={C.warning} bg={C.warningSoft} />
              </View>
              <View style={{ flexDirection: "row" }}>
                <MetricCard icon="walk" label="Walking HR" value={vitals.walkingHr ?? "—"} sub="bpm avg" fg={C.accentBlue} bg={C.accentBlueSoft} />
                <MetricCard icon="cloud" label="Respiratory" value={vitals.respiratoryRate ?? "—"} sub="breaths/min" fg={C.teal} bg={C.tealSoft} />
              </View>
              <View style={{ flexDirection: "row" }}>
                <MetricCard icon="water" label="Blood oxygen" value={vitals.oxygen ? `${vitals.oxygen}%` : "—"} fg={C.danger} bg={C.dangerSoft} />
                <MetricCard icon="cafe" label="Caffeine" value={vitals.caffeineMgToday ?? "—"} sub="mg today" fg={C.lavender} bg={C.lavenderSoft} />
              </View>
              <Text style={[type.meta, { marginTop: 6 }]}>A dash means Apple Health has no reading yet — HRV and resting heart rate are only recorded a few times a day.</Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.success, marginRight: 7 }} />
                <Text style={[type.meta, { letterSpacing: 0 }]}>
                  Live · updates every {Math.round(LIVE_REFRESH_MS / 1000)}s
                  {lastRefresh ? ` · last ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
                </Text>
              </View>
              <Text style={[type.meta, { marginTop: 4 }]}>Source: Apple Health · real values synced from your watch.</Text>
            </>
          ) : null}
        </>
      )}
      <Disclaimer />
    </Screen>
  );
}

export function ConnectGlasses({ navigation }) {
  const { devices, setDevices } = useApp();
  const [busy, setBusy] = useState(false);
  const [hardwareAvailable, setHardwareAvailable] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const glassesProvider = createCameraProvider(CameraProviderType.SMART_GLASSES);
    glassesProvider.isAvailable().then(setHardwareAvailable);
  }, []);

  async function enablePhoneCamera() {
    setBusy(true);
    setDenied(false);
    try {
      const provider = createCameraProvider(CameraProviderType.PHONE);
      const available = await provider.isAvailable();
      let granted = permission?.granted;
      if (!granted && permission?.canAskAgain !== false) {
        const res = await requestPermission();
        granted = res?.granted;
      }
      setDevices((d) => ({ ...d, glasses: !!(available && granted) }));
      if (!granted) setDenied(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <AppHeader title="Companio Glasses" subtitle="Trigger awareness in your surroundings" onBack={() => navigation.goBack()} />
      <Card accent={C.teal}>
        <View style={{ alignItems: "center", paddingVertical: spacing.md }}>
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: C.tealSoft, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="glasses" size={40} color={C.teal} />
          </View>
          <Text style={[type.title, { marginTop: 12 }]}>{devices.glasses ? "Phone camera enabled" : "Companio Glasses"}</Text>
          <Text style={[type.sub, { textAlign: "center", marginTop: 4 }]}>
            {devices.glasses ? "Your phone's camera is active and stands in for glasses hardware." : "No smart-glasses hardware is linked in this build — your phone acts as the glasses camera."}
          </Text>
        </View>
        <View style={{ marginTop: spacing.sm }}>
          {busy ? <ActivityIndicator color={C.teal} /> :
            devices.glasses
              ? <Btn label="Open glasses view" color={C.teal} icon="scan" onPress={() => navigation.navigate("Glasses")} />
              : <Btn label="Enable phone camera" color={C.teal} icon="link" onPress={enablePhoneCamera} />}
        </View>
        {denied ? <Text style={[type.meta, { color: C.danger, marginTop: 10, textAlign: "center" }]}>Camera access was denied. Enable it in Settings → Privacy → Camera → Companio, then try again.</Text> : null}
        {!hardwareAvailable ? <Pill text="No hardware SDK linked" fg={C.textSecondary} bg="#EEF1F6" icon="information-circle" /> : null}
      </Card>
      <Text style={[type.meta, { marginTop: 12 }]}>When a trigger is seen, Companio offers a calming, therapist-approved response — never a diagnosis.</Text>
      <Disclaimer />
    </Screen>
  );
}
