// Reads Apple Health: vitals, sleep, activity, and sample freshness.
import { NativeModules, Platform } from "react-native";

let AppleHealthKit = null;
let HKConstants = null;

try {
  const mod = require("react-native-health");
  const wrapper = mod?.HealthKit || mod?.default?.HealthKit || mod?.default || mod || null;
  const native = NativeModules?.AppleHealthKit || null;

  AppleHealthKit =
    (native && typeof native.initHealthKit === "function") ? native
    : (wrapper && typeof wrapper.initHealthKit === "function") ? wrapper
    : null;

  HKConstants = wrapper?.Constants || mod?.Constants || null;
} catch (e) {
  AppleHealthKit = null;
  HKConstants = null;
}

export const healthDebug = (() => {
  try {
    const raw = NativeModules?.AppleHealthKit;
    const mod = require("react-native-health");
    return {
      nativeExists: !!raw,
      nativeKeys: raw ? Object.keys(raw).length : 0,
      nativeHasInit: !!(raw && typeof raw.initHealthKit === "function"),
      wrapperKeys: AppleHealthKit ? Object.keys(AppleHealthKit).length : 0,
      wrapperHasInit: !!(AppleHealthKit && typeof AppleHealthKit.initHealthKit === "function"),
      moduleShape: mod ? Object.keys(mod).slice(0, 6).join(",") : "none",
      hasConstants: !!HKConstants,
    };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
})();

export const isHealthAvailable =
  Platform.OS === "ios" &&
  !!AppleHealthKit &&
  typeof AppleHealthKit.initHealthKit === "function" &&
  !!HKConstants?.Permissions;

const PERMS = isHealthAvailable
  ? {
      permissions: {
        read: [
          HKConstants.Permissions.HeartRate,
          HKConstants.Permissions.HeartRateVariability,
          HKConstants.Permissions.RestingHeartRate,
          HKConstants.Permissions.Steps,
          HKConstants.Permissions.ActiveEnergyBurned,
          HKConstants.Permissions.SleepAnalysis,
          HKConstants.Permissions.Workout,
          HKConstants.Permissions.Caffeine,
          // Read by readVitals: without the matching permission HealthKit
          // returns nothing and the metric shows as unavailable forever.
          HKConstants.Permissions.WalkingHeartRateAverage,
          HKConstants.Permissions.RespiratoryRate,
          HKConstants.Permissions.OxygenSaturation,
          // The Watch's Noise app measures ambient sound in dB. This is the
          // only passive sound source available: metering the microphone would
          // mean holding it open continuously, which the privacy model forbids.
          HKConstants.Permissions.EnvironmentalAudioExposure,
          HKConstants.Permissions.HeadphoneAudioExposure,
        ],
        write: [],
      },
    }
  : null;

const HEALTH_AUTH_TIMEOUT_MS = 12000;

export function requestHealthAuth() {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve({ ok: false, reason: "unavailable" });

    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), HEALTH_AUTH_TIMEOUT_MS);

    try {
      AppleHealthKit.initHealthKit(PERMS, (err) => {
        clearTimeout(timer);
        finish({ ok: !err, reason: err ? String(err) : null });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, reason: String(e) });
    }
  });
}

export const FRESHNESS = {
  LIVE: "live",
  RECENT: "recent",
  STALE: "stale",
};

const HR_LIVE_MIN = 10, HR_RECENT_MIN = 60;
const HRV_LIVE_MIN = 6 * 60, HRV_RECENT_MIN = 24 * 60;

export function freshnessOf(ageMinutes, liveMin, recentMin) {
  if (ageMinutes == null) return FRESHNESS.STALE;
  if (ageMinutes <= liveMin) return FRESHNESS.LIVE;
  if (ageMinutes <= recentMin) return FRESHNESS.RECENT;
  return FRESHNESS.STALE;
}

function latestSample(method, opts, pick) {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve({ value: null, at: null, ageMinutes: null });
    AppleHealthKit[method](opts, (err, results) => {
      if (err || !results) return resolve({ value: null, at: null, ageMinutes: null });
      const arr = Array.isArray(results) ? results : [results];
      const last = arr[arr.length - 1];
      if (!last) return resolve({ value: null, at: null, ageMinutes: null });
      const stamp = last.endDate || last.end || last.startDate || last.start || null;
      const at = stamp ? new Date(stamp).getTime() : null;
      const ageMinutes = at ? Math.max(0, Math.round((Date.now() - at) / 60000)) : null;
      resolve({ value: pick(last), at, ageMinutes });
    });
  });
}

function latest(method, opts, pick) {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    AppleHealthKit[method](opts, (err, results) => {
      if (err || !results) return resolve(null);
      const arr = Array.isArray(results) ? results : [results];
      const last = arr[arr.length - 1];
      resolve(last ? pick(last) : null);
    });
  });
}

const since = (mins) => ({ startDate: new Date(Date.now() - mins * 60000).toISOString(), ascending: true });

export const getHeartRate = () => latest("getHeartRateSamples", since(60 * 12), (s) => Math.round(s.value));
export const getHRV = () => latest("getHeartRateVariabilitySamples", since(60 * 24 * 7), (s) => Math.round(s.value * 1000));
export const getRestingHR = () => latest("getRestingHeartRateSamples", since(60 * 24 * 7), (s) => Math.round(s.value));

export const getHeartRateSample = () => latestSample("getHeartRateSamples", since(60 * 12), (s) => Math.round(s.value));
export const getHRVSample = () => latestSample("getHeartRateVariabilitySamples", since(60 * 24 * 7), (s) => Math.round(s.value * 1000));
export const getRestingHRSample = () => latestSample("getRestingHeartRateSamples", since(60 * 24 * 7), (s) => Math.round(s.value));

export function getStepsToday() {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    AppleHealthKit.getStepCount({ date: new Date().toISOString() }, (err, r) => {
      if (!err && r?.value != null) return resolve(Math.round(r.value));
      AppleHealthKit.getSamples({ startDate: startOfDay.toISOString(), type: "StepCount" }, (e2, rows) => {
        if (e2 || !Array.isArray(rows) || rows.length === 0) return resolve(null);
        resolve(Math.round(rows.reduce((sum, x) => sum + (Number(x.value) || 0), 0)));
      });
    });
  });
}

export function getActiveEnergy() {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const opts = { startDate: startOfDay.toISOString(), endDate: new Date().toISOString() };
    const sum = (rows) => Math.round(rows.reduce((t, x) => t + (Number(x.value) || 0), 0));
    if (typeof AppleHealthKit.getActiveEnergyBurned === "function") {
      AppleHealthKit.getActiveEnergyBurned(opts, (err, rows) => {
        if (!err && Array.isArray(rows) && rows.length) return resolve(sum(rows));
        AppleHealthKit.getSamples({ ...opts, type: "ActiveEnergyBurned" }, (e2, rs) => {
          if (e2 || !Array.isArray(rs) || !rs.length) return resolve(null);
          resolve(sum(rs));
        });
      });
      return;
    }
    resolve(null);
  });
}
export const getWalkingHeartRate = () => latest("getWalkingHeartRateAverage", since(60 * 24 * 7), (s) => Math.round(s.value));
export const getRespiratoryRate = () => latest("getRespiratoryRateSamples", since(60 * 24 * 7), (s) => Math.round(s.value));
export const getOxygenSaturation = () => latest("getOxygenSaturationSamples", since(60 * 24 * 7), (s) => Math.round(s.value * 100));

const ASLEEP_VALUES = new Set(["ASLEEP", "ASLEEPCORE", "ASLEEPDEEP", "ASLEEPREM", "CORE", "DEEP", "REM"]);

export function getSleepDetail() {
  return new Promise((resolve) => {
    const none = { hours: null, fromNightsAgo: null };
    if (!isHealthAvailable) return resolve(none);

    const totalFor = (rows) => {
      const ms = (rows || [])
        .filter((s) => ASLEEP_VALUES.has(String(s.value || "").toUpperCase()))
        .reduce((sum, s) => sum + (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()), 0);
      const hours = ms / 3600000;
      return hours > 0 ? +hours.toFixed(1) : null;
    };

    AppleHealthKit.getSleepSamples(
      { startDate: new Date(Date.now() - 20 * 60 * 60000).toISOString(), ascending: true },
      (err, results) => {
        const lastNight = err ? null : totalFor(results);
        if (lastNight != null) return resolve({ hours: lastNight, fromNightsAgo: 0 });

        AppleHealthKit.getSleepSamples(
          { startDate: new Date(Date.now() - 7 * 24 * 60 * 60000).toISOString(), ascending: true },
          (e2, week) => {
            if (e2 || !Array.isArray(week) || !week.length) return resolve(none);
            const asleep = week.filter((s) => ASLEEP_VALUES.has(String(s.value || "").toUpperCase()));
            if (!asleep.length) return resolve(none);

            const byNight = new Map();
            for (const sample of asleep) {
              const key = new Date(sample.endDate).toDateString();
              if (!byNight.has(key)) byNight.set(key, []);
              byNight.get(key).push(sample);
            }
            const [nightKey, rows] = [...byNight.entries()]
              .sort((a, b) => new Date(b[0]) - new Date(a[0]))[0];

            const hours = totalFor(rows);
            if (hours == null) return resolve(none);

            const today = new Date(); today.setHours(0, 0, 0, 0);
            const night = new Date(nightKey); night.setHours(0, 0, 0, 0);
            const nightsAgo = Math.max(1, Math.round((today - night) / (24 * 60 * 60000)));
            resolve({ hours, fromNightsAgo: nightsAgo });
          },
        );
      },
    );
  });
}

export async function getSleepLastNight() {
  return (await getSleepDetail()).hours;
}

export const POOR_SLEEP_THRESHOLD_HOURS = 6;
export const isPoorSleep = (hours) => hours != null && hours < POOR_SLEEP_THRESHOLD_HOURS;

export function getRecentWorkout(withinMinutes = 120) {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const options = { startDate: new Date(Date.now() - withinMinutes * 60000).toISOString(), type: "Workout" };
    AppleHealthKit.getSamples(options, (err, results) => {
      if (err || !Array.isArray(results) || results.length === 0) return resolve(null);
      const latestEnd = results.reduce((max, s) => Math.max(max, new Date(s.end || s.endDate).getTime()), 0);
      resolve(latestEnd > 0 ? { endedAt: new Date(latestEnd).toISOString(), minutesAgo: Math.round((Date.now() - latestEnd) / 60000) } : null);
    });
  });
}

const ACTIVE_NOW_STEP_THRESHOLD = 40;

export function getRecentSteps(withinMinutes = 5) {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const options = { startDate: new Date(Date.now() - withinMinutes * 60000).toISOString(), type: "StepCount" };
    AppleHealthKit.getSamples(options, (err, results) => {
      if (err || !Array.isArray(results)) return resolve(null);
      resolve(results.reduce((sum, s) => sum + (Number(s.value) || 0), 0));
    });
  });
}

export async function activityDetail() {
  const [steps, workout, energyNow] = await Promise.all([
    getRecentSteps(5).catch(() => null),
    getRecentWorkout(10).catch(() => null),
    recentActiveEnergy(10).catch(() => null),
  ]);

  const stepping = steps != null && steps >= ACTIVE_NOW_STEP_THRESHOLD;
  const working_out = !!workout && workout.minutesAgo != null && workout.minutesAgo <= 10;
  const burning = energyNow != null && energyNow >= 10;

  const reasons = [];
  if (stepping) reasons.push(`${steps} steps in the last 5 minutes`);
  if (working_out) reasons.push(workout.minutesAgo <= 1 ? "workout in progress" : `workout ${workout.minutesAgo}m ago`);
  if (burning) reasons.push(`${energyNow} kcal burned in the last 10 minutes`);

  return { active: stepping || working_out || burning, reasons, steps, workout, energyNow };
}

export async function isLikelyActiveNow() {
  return (await activityDetail()).active;
}

export function recentActiveEnergy(withinMinutes = 10) {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const opts = {
      startDate: new Date(Date.now() - withinMinutes * 60000).toISOString(),
      endDate: new Date().toISOString(),
    };
    const sum = (rows) => Math.round((rows || []).reduce((t, x) => t + (Number(x.value) || 0), 0));
    if (typeof AppleHealthKit.getActiveEnergyBurned !== "function") return resolve(null);
    AppleHealthKit.getActiveEnergyBurned(opts, (err, rows) => {
      if (err || !Array.isArray(rows)) return resolve(null);
      resolve(sum(rows));
    });
  });
}

export function getHourlySteps() {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve([]);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    AppleHealthKit.getSamples({ startDate: startOfDay.toISOString(), type: "StepCount" }, (err, results) => {
      if (err || !Array.isArray(results) || results.length === 0) return resolve([]);
      const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0 }));
      results.forEach((s) => {
        const h = new Date(s.startDate || s.start).getHours();
        if (h >= 0 && h < 24) buckets[h].value += Number(s.value) || 0;
      });
      resolve(buckets.map((b) => ({ ...b, value: Math.round(b.value) })));
    });
  });
}

export function getCaffeineToday() {
  return new Promise((resolve) => {
    if (!isHealthAvailable) return resolve(null);
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const options = { startDate: startOfDay.toISOString(), type: "Caffeine" };
    try {
      AppleHealthKit.getSamples(options, (err, results) => {
        if (err || !Array.isArray(results) || results.length === 0) return resolve(null);
        const totalMg = results.reduce((sum, s) => sum + (Number(s.value) || 0), 0);
        resolve(totalMg > 0 ? Math.round(totalMg) : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function getAmbientSound() {
  return new Promise((resolve) => {
    const empty = { db: null, ageMinutes: null, baselineDb: null, jumpDb: null };
    if (!isHealthAvailable || typeof AppleHealthKit.getEnvironmentalAudioExposure !== "function") {
      return resolve(empty);
    }
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    try {
      AppleHealthKit.getEnvironmentalAudioExposure({ startDate: since }, (err, results) => {
        if (err || !Array.isArray(results) || results.length === 0) return resolve(empty);
        const vals = results
          .map((r) => ({ v: Number(r.value), at: new Date(r.endDate || r.startDate).getTime() }))
          .filter((r) => Number.isFinite(r.v) && Number.isFinite(r.at))
          .sort((x, y) => x.at - y.at);
        if (!vals.length) return resolve(empty);

        const last = vals[vals.length - 1];
        // The startle response is driven by the change, not the absolute level:
        // a door slamming in a quiet room is worse than a constant loud street.
        // The floor is the quieter half of the recent window, so a long noisy
        // stretch does not hide a spike inside it.
        const prior = vals.slice(0, -1).map((r) => r.v).sort((a, b) => a - b);
        const baselineDb = prior.length
          ? prior[Math.floor(prior.length * 0.25)]
          : null;
        resolve({
          db: Math.round(last.v),
          ageMinutes: Math.max(0, Math.round((Date.now() - last.at) / 60000)),
          baselineDb: baselineDb == null ? null : Math.round(baselineDb),
          jumpDb: baselineDb == null ? null : Math.round(last.v - baselineDb),
        });
      });
    } catch {
      resolve(empty);
    }
  });
}

// HealthKit records headphone audio exposure only while audio is playing
// through headphones, so a very recent sample is evidence a pair is in use.
// It is a proxy, not a route query: iOS exposes no audio-route API to
// JavaScript, and these samples are written periodically rather than instantly.
// Treated as a hint that suppresses speaking out loud, never as proof.
const HEADPHONE_HINT_MINUTES = 15;

function getHeadphoneHint() {
  return new Promise((resolve) => {
    if (!isHealthAvailable || typeof AppleHealthKit.getHeadphoneAudioExposure !== "function") {
      return resolve({ likely: false, ageMinutes: null, known: false });
    }
    const startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    try {
      AppleHealthKit.getHeadphoneAudioExposure({ startDate }, (err, results) => {
        if (err || !Array.isArray(results) || results.length === 0) {
          return resolve({ likely: false, ageMinutes: null, known: true });
        }
        const times = results
          .map((r) => new Date(r.endDate || r.startDate).getTime())
          .filter(Number.isFinite);
        if (!times.length) return resolve({ likely: false, ageMinutes: null, known: true });
        const age = Math.round((Date.now() - Math.max(...times)) / 60000);
        resolve({ likely: age <= HEADPHONE_HINT_MINUTES, ageMinutes: age, known: true });
      });
    } catch {
      resolve({ likely: false, ageMinutes: null, known: false });
    }
  });
}

export async function readVitals() {
  const [hrS, hrvS, restingS, steps, sleepDetail, recentWorkout, caffeineMgToday, activity, hourlySteps] = await Promise.all([
    getHeartRateSample(), getHRVSample(), getRestingHRSample(), getStepsToday(), getSleepDetail(), getRecentWorkout(), getCaffeineToday(), activityDetail(), getHourlySteps(),
  ]);
  const hr = hrS.value, hrv = hrvS.value, resting = restingS.value;
  const sleepHoursLastNight = sleepDetail?.hours ?? null;
  const sleepFromNightsAgo = sleepDetail?.fromNightsAgo ?? null;
  const hrFreshness = freshnessOf(hrS.ageMinutes, HR_LIVE_MIN, HR_RECENT_MIN);
  const hrvFreshness = freshnessOf(hrvS.ageMinutes, HRV_LIVE_MIN, HRV_RECENT_MIN);
  const [activeEnergy, walkingHr, respiratoryRate, oxygen, sound, headphones] = await Promise.all([
    getActiveEnergy(), getWalkingHeartRate(), getRespiratoryRate(), getOxygenSaturation(),
    getAmbientSound(), getHeadphoneHint(),
  ]);
  return {
    hr, hrv, resting, steps, sleepHoursLastNight,
    hrAt: hrS.at ?? null,
    hrAgeMinutes: hrS.ageMinutes, hrvAgeMinutes: hrvS.ageMinutes,
    sleepFromNightsAgo,
    restingAgeMinutes: restingS.ageMinutes,
    hrFreshness, hrvFreshness,
    poorSleep: isPoorSleep(sleepHoursLastNight),
    recentWorkout, caffeineMgToday,
    activeNow: activity?.active ?? false,
    activityReasons: activity?.reasons || [],
    hourlySteps,
    activeEnergy, walkingHr, respiratoryRate, oxygen,
    ambientDb: sound.db,
    ambientBaselineDb: sound.baselineDb,
    ambientJumpDb: sound.jumpDb,
    ambientAgeMinutes: sound.ageMinutes,
    headphonesLikely: headphones.likely,
    headphonesAgeMinutes: headphones.ageMinutes,
    source: isHealthAvailable ? "apple_health" : "unavailable",
  };
}

export function computeLiveDistress(hr, hrv, baselineHr, confounds = {}) {
  if (hr == null) return { score: null, level: "unknown", hr, hrv };

  if (confounds.hrFreshness === FRESHNESS.STALE) {
    return {
      score: null, level: "unknown", hr, hrv, stale: true,
      explanation: confounds.hrAgeMinutes != null
        ? `Most recent heart rate is ${confounds.hrAgeMinutes} minutes old — too old to read as current.`
        : "No recent heart-rate reading.",
    };
  }

  const hrvUsable = confounds.hrvFreshness !== FRESHNESS.STALE;
  const base = baselineHr || 70;
  const delta = (hr - base) / base;
  let score = Math.max(0, delta) / 0.5;
  if (hrvUsable && hrv != null && hrv < 30) score += 0.15;
  score = Math.max(0, Math.min(1, score));

  const explanations = [];
  if (confounds.activeNow) {
    explanations.push("appears to be active/moving right now");
    score *= 0.25;
  }
  if (confounds.recentWorkout) {
    explanations.push(`workout ended ${confounds.recentWorkout.minutesAgo}m ago`);
    score *= 0.4;
  }
  if (confounds.declaredContext && confounds.declaredContext.expires_at > Date.now()) {
    const labels = confounds.declaredContext.labels || [];
    explanations.push(labels.length ? `patient said: ${labels.join(", ")}` : "patient gave context");
    score *= 0.45;
  }
  if (confounds.caffeineMgToday) {
    explanations.push(`${confounds.caffeineMgToday}mg caffeine today`);
    score *= 0.85;
  }
  if (confounds.poorSleep) {
    explanations.push("slept poorly last night");
    score *= 0.9;
  }
  score = +score.toFixed(2);

  const level = score >= 0.5 ? "high" : score >= 0.175 ? "elevated" : "baseline";
  return {
    score, level, hr, hrv, base,
    confounded: explanations.length > 0,
    confoundReasons: explanations,
    activeNow: !!confounds.activeNow,
  };
}
