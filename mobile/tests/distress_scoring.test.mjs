// The heuristic distress score: what the app falls back to when the trained
// model is unreachable, and the layer that decides a run is not a panic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const H = await load("src/services/health.js", {
  "react-native": { NativeModules: {}, Platform: { OS: "ios" } },
  "react-native-health": {},
  "expo-secure-store": { getItemAsync: async () => null, setItemAsync: async () => {} },
});
const { computeLiveDistress, FRESHNESS } = H;

const BASE = 60;

test("a heart rate at the patient's baseline is not distress", () => {
  const r = computeLiveDistress(BASE, 60, BASE);
  assert.equal(r.level, "baseline");
  assert.equal(r.score, 0);
});

test("a rate far above the baseline reads as high", () => {
  const r = computeLiveDistress(105, 25, BASE);
  assert.equal(r.level, "high");
  assert.ok(r.score >= 0.5);
});

test("a moderate rise reads as elevated rather than high", () => {
  const r = computeLiveDistress(72, 60, BASE);
  assert.equal(r.level, "elevated");
});

test("the score is measured against this patient's own baseline", () => {
  const athlete = computeLiveDistress(90, 60, 45);
  const higherBaseline = computeLiveDistress(90, 60, 80);
  assert.ok(athlete.score > higherBaseline.score);
});

test("suppressed heart-rate variability raises the score", () => {
  const low = computeLiveDistress(80, 20, BASE);
  const normal = computeLiveDistress(80, 60, BASE);
  assert.ok(low.score > normal.score);
});

test("a stale reading is refused rather than scored", () => {
  const r = computeLiveDistress(120, 20, BASE, {
    hrFreshness: FRESHNESS.STALE, hrAgeMinutes: 42,
  });
  assert.equal(r.score, null);
  assert.equal(r.level, "unknown");
  assert.equal(r.stale, true);
  assert.match(r.explanation, /42 minutes old/);
});

test("a missing reading is never invented", () => {
  const r = computeLiveDistress(null, null, BASE);
  assert.equal(r.score, null);
  assert.equal(r.level, "unknown");
});

test("movement dampens the score so exercise is not read as distress", () => {
  const still = computeLiveDistress(105, 25, BASE);
  const moving = computeLiveDistress(105, 25, BASE, { activeNow: true });
  assert.ok(moving.score < still.score);
  assert.equal(moving.confounded, true);
  assert.match(moving.confoundReasons.join(" "), /active/);
});

test("a recent workout dampens the score and says so", () => {
  const r = computeLiveDistress(105, 25, BASE, { recentWorkout: { minutesAgo: 12 } });
  assert.ok(r.score < computeLiveDistress(105, 25, BASE).score);
  assert.match(r.confoundReasons.join(" "), /workout ended 12m ago/);
});

test("the patient's own declared context dampens the score", () => {
  const r = computeLiveDistress(105, 25, BASE, {
    declaredContext: { expires_at: Date.now() + 60000, labels: ["just had coffee"] },
  });
  assert.ok(r.score < computeLiveDistress(105, 25, BASE).score);
  assert.match(r.confoundReasons.join(" "), /just had coffee/);
});

test("an expired declaration stops dampening", () => {
  const expired = computeLiveDistress(105, 25, BASE, {
    declaredContext: { expires_at: Date.now() - 60000, labels: ["coffee"] },
  });
  assert.equal(expired.score, computeLiveDistress(105, 25, BASE).score);
});

test("caffeine and poor sleep both dampen and are both reported", () => {
  const r = computeLiveDistress(105, 25, BASE, { caffeineMgToday: 300, poorSleep: true });
  const reasons = r.confoundReasons.join(" ");
  assert.match(reasons, /300mg caffeine/);
  assert.match(reasons, /slept poorly/);
});

test("an unexplained reading is never marked confounded", () => {
  const r = computeLiveDistress(105, 25, BASE);
  assert.equal(r.confounded, false);
  assert.deepEqual(r.confoundReasons, []);
});

test("the score stays inside its documented range", () => {
  for (const hr of [30, 60, 90, 140, 220]) {
    const r = computeLiveDistress(hr, 20, BASE);
    assert.ok(r.score >= 0 && r.score <= 1, `hr ${hr} produced ${r.score}`);
  }
});

test("a rate below the baseline never produces a positive score", () => {
  assert.equal(computeLiveDistress(45, 60, BASE).score, 0);
});

test("stale variability does not block a fresh heart-rate score", () => {
  const r = computeLiveDistress(105, 20, BASE, { hrvFreshness: FRESHNESS.STALE });
  assert.ok(r.score > 0);
  assert.notEqual(r.level, "unknown");
});

test("the reading reports the baseline it was scored against", () => {
  assert.equal(computeLiveDistress(80, 60, BASE).base, BASE);
});
