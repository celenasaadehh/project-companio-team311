// Produces the physiological risk state: trained model first, heuristic as fallback.
import { apiCall } from "./engine";
import { computeLiveDistress } from "./health";

export const RISK_SOURCE = {
  TRAINED: "trained_model",
  HEURISTIC: "heuristic",
};

function zscore(value, mean, std) {
  if (value == null || mean == null || !std) return null;
  return (value - mean) / std;
}

// The model was trained on WINDOW statistics (mean, spread, range over a
// 30-second stretch), not single readings. A rolling buffer of recent samples
// rebuilds that shape: each monitor tick contributes one sample, and the
// window statistics are computed over the last few minutes. Single-point
// substitutes for window features made the live feature distribution unlike
// anything the model saw in training.
const WINDOW = [];
const WINDOW_MAX = 12;            // ~3 minutes at a 15 s poll
const WINDOW_MAX_AGE_MS = 5 * 60 * 1000;

function pushWindowSample(vitals) {
  const now = Date.now();
  if (vitals?.hr != null) {
    WINDOW.push({ at: now, hr: Number(vitals.hr),
                  hrv: vitals.hrv != null ? Number(vitals.hrv) : null,
                  steps: vitals.hourlySteps?.length
                    ? Number(vitals.hourlySteps[vitals.hourlySteps.length - 1]) : null,
                  active: vitals.activeNow ? 1 : 0 });
  }
  while (WINDOW.length > WINDOW_MAX) WINDOW.shift();
  while (WINDOW.length && now - WINDOW[0].at > WINDOW_MAX_AGE_MS) WINDOW.shift();
}

function stats(arr) {
  const xs = arr.filter((x) => x != null && Number.isFinite(x));
  if (!xs.length) return { mean: null, std: null, range: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (xs.length < 2) return { mean, std: null, range: 0 };
  const varr = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return { mean, std: Math.sqrt(varr), range: Math.max(...xs) - Math.min(...xs) };
}

function watchFeatures(vitals, baseline) {
  const b = baseline || {};
  pushWindowSample(vitals);

  const hrW = stats(WINDOW.map((w) => w.hr));
  const hrvW = stats(WINDOW.map((w) => w.hrv));
  const ibiW = stats(WINDOW.map((w) => (w.hr > 0 ? 60 / w.hr : null)));
  const actW = stats(WINDOW.map((w) => w.active));

  return {
    heart_rate_mean: zscore(hrW.mean ?? vitals.hr, b.hr_mean, b.hr_std),
    // spread and range are already relative quantities; normalise by the
    // baseline spread where one exists so units match training z-space
    heart_rate_std: hrW.std != null && b.hr_std ? hrW.std / b.hr_std : null,
    heart_rate_range: hrW.range != null && b.hr_std ? hrW.range / b.hr_std : null,
    ibi_mean_seconds: zscore(ibiW.mean ?? (vitals.hr ? 60 / vitals.hr : null), b.ibi_mean, b.ibi_std),
    sdnn_ms: zscore(hrvW.mean ?? vitals.hrv, b.hrv_mean, b.hrv_std),
    // successive-difference proxy from the window's HR series
    rmssd_ms: (() => {
      const hrs = WINDOW.map((w) => w.hr).filter((x) => x != null);
      if (hrs.length < 3) return null;
      const diffs = [];
      for (let i = 1; i < hrs.length; i++) diffs.push(((60 / hrs[i]) - (60 / hrs[i - 1])) * 1000);
      const st = stats(diffs.map((d) => d * d));
      return st.mean != null ? Math.sqrt(st.mean) : null;
    })(),
    acc_magnitude_mean: actW.mean ?? (vitals.activeNow ? 1 : 0),
    acc_magnitude_window_std: actW.std,
    acc_magnitude_variability_mean: actW.range,
  };
}

export async function assessRisk(vitals, baselineHr, confounds = {}, baselineProfile = null) {
  const heuristic = computeLiveDistress(vitals?.hr, vitals?.hrv, baselineHr, confounds);

  if (heuristic?.stale || vitals?.hr == null) {
    return { ...heuristic, risk_source: RISK_SOURCE.HEURISTIC, fallback_reason: heuristic?.explanation || "no usable heart-rate sample" };
  }

  const feats = watchFeatures(vitals, baselineProfile);
  const usable = Object.values(feats).filter((v) => v != null && Number.isFinite(v)).length;
  if (!baselineProfile || usable === 0) {
    return {
      ...heuristic,
      risk_source: RISK_SOURCE.HEURISTIC,
      fallback_reason: "personal baseline not calibrated yet — the trained model needs it, so the heart-rate comparison is being used instead",
    };
  }

  try {
    const out = await apiCall("/api/risk/watch", feats, 4000);
    if (out?.risk_level && out?.risk_score != null) {
      const damped = heuristic?.score != null && heuristic.score < out.risk_score
        ? heuristic.score
        : out.risk_score;
      const level = damped === out.risk_score ? out.risk_level : heuristic.level;
      return {
        ...heuristic,
        score: damped,
        level,
        model_score: out.risk_score,
        model_level: out.risk_level,
        risk_source: RISK_SOURCE.TRAINED,
        model: out.model,
        confounded: damped !== out.risk_score,
      };
    }
  } catch (e) {
    return {
      ...heuristic,
      risk_source: RISK_SOURCE.HEURISTIC,
      fallback_reason: `trained model unreachable: ${String(e?.message || e)}`,
    };
  }

  return { ...heuristic, risk_source: RISK_SOURCE.HEURISTIC, fallback_reason: "model returned no usable result" };
}
