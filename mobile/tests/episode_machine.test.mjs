// The episode state machine decides when the camera opens, when the patient
// is asked, and when a person is brought in. Every transition here is a
// clinical decision, so each one is pinned by a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load, atTimeOffset } from "./_load.mjs";

const M = await load("src/services/episode_machine.js", {
  "./episode": {
    startEpisode: () => ({ episode_id: "E-test" }),
    closeEpisode: () => {},
  },
});
const { newEpisode, step, EpisodeState: S, TIMING } = M;

const RISK = {
  calm: { level: "baseline", score: 0.1 },
  elevated: { level: "elevated", score: 0.6 },
  high: { level: "high", score: 0.9 },
};
const PERMS = { autoCapture: true, therapistAlerts: true, caregiverEscalation: false };
const act = (actions, type) => actions.find((a) => a.type === type);

function inState(state, extra = {}) {
  const ep = newEpisode("p1");
  ep.state = state;
  ep.since = Date.now();
  return Object.assign(ep, extra);
}

test("a new episode starts at baseline with an identifier", () => {
  const ep = newEpisode("p1");
  assert.equal(ep.state, S.BASELINE);
  assert.equal(ep.episode_id, "E-test");
  assert.equal(ep.patient_id, "p1");
  assert.deepEqual(ep.interventions, []);
});

test("calm physiology never leaves baseline", () => {
  const { episode, actions } = step(newEpisode("p1"), { risk: RISK.calm });
  assert.equal(episode.state, S.BASELINE);
  assert.equal(actions.length, 0);
});

test("elevated physiology opens the watching window", () => {
  const { episode } = step(newEpisode("p1"), { risk: RISK.elevated });
  assert.equal(episode.state, S.WATCHING);
});

test("a rise that settles inside the window ends the episode quietly", () => {
  const ep = inState(S.WATCHING);
  const { episode, actions } = step(ep, { risk: RISK.calm });
  assert.equal(episode.state, S.BASELINE);
  assert.equal(actions.length, 0);
});

test("the check-in is withheld until the change has persisted", () => {
  const ep = inState(S.WATCHING);
  const { episode, actions } = step(ep, { risk: RISK.elevated });
  assert.equal(episode.state, S.WATCHING);
  assert.equal(actions.length, 0);
});

test("sustained elevation asks the patient before anything else happens", () => {
  const ep = inState(S.WATCHING);
  const r = atTimeOffset(TIMING.watchingMs + 1000, () => step(ep, { risk: RISK.elevated }));
  assert.equal(r.episode.state, S.CHECK_IN);
  const checkIn = act(r.actions, "CHECK_IN");
  assert.ok(checkIn, "a check-in must be raised");
  assert.equal(checkIn.title, "Are you okay?");
});

test("the check-in offers both an all-clear and a cause the patient can declare", () => {
  const ep = inState(S.WATCHING);
  const r = atTimeOffset(TIMING.watchingMs + 1000, () => step(ep, { risk: RISK.elevated }));
  const opts = act(r.actions, "CHECK_IN").options.join(" ").toLowerCase();
  assert.ok(opts.includes("okay"));
  assert.ok(opts.includes("exercise"));
  assert.ok(opts.includes("caffeine"));
});

test("a declared cause is recorded and returns to watching", () => {
  const ep = inState(S.CHECK_IN);
  const { episode } = step(ep, { risk: RISK.elevated, patientResponse: "exercise" });
  assert.equal(episode.state, S.WATCHING);
  assert.ok(episode.context.exercise);
});

test("a declared cause stands the escalation down below high risk", () => {
  const ep = inState(S.WATCHING, { context: { exercise: Date.now() } });
  const r = atTimeOffset(TIMING.watchingMs + 1000, () => step(ep, { risk: RISK.elevated }));
  assert.equal(r.episode.state, S.WATCHING);
  assert.equal(r.actions.length, 0);
});

test("a declared cause does not suppress a high-risk episode", () => {
  const ep = inState(S.WATCHING, { context: { exercise: Date.now() } });
  const r = atTimeOffset(TIMING.watchingMs + 1000, () => step(ep, { risk: RISK.high }));
  assert.equal(r.episode.state, S.CHECK_IN);
});

test("answering okay returns to watching without support", () => {
  const ep = inState(S.CHECK_IN);
  const { episode, actions } = step(ep, { risk: RISK.elevated, patientResponse: "okay" });
  assert.equal(episode.state, S.WATCHING);
  assert.equal(actions.length, 0);
});

test("asking for support opens support immediately, at any state", () => {
  const ep = inState(S.WATCHING);
  const { episode, actions } = step(ep, { risk: RISK.calm, patientResponse: "need_support" });
  assert.equal(episode.state, S.SUPPORT);
  assert.equal(act(actions, "OPEN_SUPPORT").source, "patient_request");
});

test("settling while the check-in is unanswered closes the episode", () => {
  const ep = inState(S.CHECK_IN);
  const { episode } = step(ep, { risk: RISK.calm });
  assert.equal(episode.state, S.BASELINE);
});

test("an ignored check-in with no declared cause captures context", () => {
  const ep = inState(S.CHECK_IN);
  const r = atTimeOffset(TIMING.checkInMs + 1000, () =>
    step(ep, { risk: RISK.elevated, permissions: PERMS }));
  assert.equal(r.episode.state, S.CONTEXT_CAPTURE);
  assert.ok(act(r.actions, "CAPTURE_CONTEXT"));
});

test("context capture never runs when the patient disabled it", () => {
  const ep = inState(S.CHECK_IN);
  const r = atTimeOffset(TIMING.checkInMs + 1000, () =>
    step(ep, { risk: RISK.elevated, permissions: { ...PERMS, autoCapture: false } }));
  assert.equal(r.episode.state, S.SUPPORT);
  assert.equal(act(r.actions, "CAPTURE_CONTEXT"), undefined);
});

test("context capture never runs when the patient explained the rise", () => {
  const ep = inState(S.CHECK_IN, { context: { caffeine: Date.now() } });
  const r = atTimeOffset(TIMING.checkInMs + 1000, () =>
    step(ep, { risk: RISK.elevated, permissions: PERMS }));
  assert.equal(act(r.actions, "CAPTURE_CONTEXT"), undefined);
  assert.equal(r.episode.state, S.SUPPORT);
});

test("context is captured at most once per episode", () => {
  const ep = inState(S.CHECK_IN, { captureRequested: true });
  const r = atTimeOffset(TIMING.checkInMs + 1000, () =>
    step(ep, { risk: RISK.elevated, permissions: PERMS }));
  assert.equal(act(r.actions, "CAPTURE_CONTEXT"), undefined);
});

test("capture is followed by support on the next step", () => {
  const ep = inState(S.CONTEXT_CAPTURE);
  const { episode, actions } = step(ep, { risk: RISK.elevated, permissions: PERMS });
  assert.equal(episode.state, S.SUPPORT);
  assert.equal(act(actions, "OPEN_SUPPORT").source, "automatic_detection");
});

test("an intervention that helped moves the episode to recovery", () => {
  const ep = inState(S.SUPPORT);
  const { episode } = step(ep, { risk: RISK.elevated, interventionHelped: true });
  assert.equal(episode.state, S.RECOVERY);
});

test("an intervention that failed is excluded from the next offer", () => {
  const ep = inState(S.SUPPORT, { interventions: ["grounding"] });
  const { episode, actions } = step(ep, { risk: RISK.elevated, interventionHelped: false });
  assert.equal(episode.state, S.SUPPORT);
  assert.deepEqual(act(actions, "TRY_ANOTHER_INTERVENTION").exclude, ["grounding"]);
});

test("a person is offered once the approved options are exhausted", () => {
  const ep = inState(S.SUPPORT, { interventions: ["a", "b", "c"] });
  const { episode, actions } = step(ep, {
    risk: RISK.elevated, interventionHelped: false, permissions: PERMS,
  });
  assert.equal(episode.state, S.ESCALATION);
  const esc = act(actions, "OFFER_ESCALATION");
  assert.equal(esc.therapist, true);
  assert.equal(esc.caregiver, false);
});

test("escalation respects the caregiver permission", () => {
  const ep = inState(S.SUPPORT, { interventions: ["a", "b", "c"] });
  const { actions } = step(ep, {
    risk: RISK.elevated, interventionHelped: false,
    permissions: { ...PERMS, caregiverEscalation: true },
  });
  assert.equal(act(actions, "OFFER_ESCALATION").caregiver, true);
});

test("risk rising again during recovery reopens support", () => {
  const ep = inState(S.RECOVERY);
  const { episode } = step(ep, { risk: RISK.high });
  assert.equal(episode.state, S.SUPPORT);
});

test("a settled recovery window closes the episode with a summary", () => {
  const ep = inState(S.RECOVERY, { started: Date.now() });
  const r = atTimeOffset(TIMING.recoveryMs + 1000, () => step(ep, { risk: RISK.calm }));
  assert.equal(r.episode.state, S.BASELINE);
  assert.ok(act(r.actions, "CONFIRM_RECOVERY"));
  assert.ok(act(r.actions, "CLOSE_EPISODE").episode);
});

test("pausing monitoring switches the machine off from any state", () => {
  const ep = inState(S.SUPPORT);
  const { episode } = step(ep, { risk: RISK.high, monitoringPaused: true });
  assert.equal(episode.state, S.OFF);
});

test("resuming monitoring returns to baseline rather than mid-episode", () => {
  const ep = inState(S.OFF);
  const { episode } = step(ep, { risk: RISK.elevated });
  assert.equal(episode.state, S.BASELINE);
});

test("every risk reading is retained as a trail for the therapist", () => {
  let ep = newEpisode("p1");
  ep = step(ep, { risk: RISK.calm }).episode;
  ep = step(ep, { risk: RISK.elevated }).episode;
  assert.equal(ep.riskTrail.length, 2);
  assert.equal(ep.riskTrail[1].level, "elevated");
});

test("the risk trail is bounded so a long episode cannot grow without limit", () => {
  let ep = newEpisode("p1");
  for (let i = 0; i < 260; i++) ep = step(ep, { risk: RISK.elevated }).episode;
  assert.ok(ep.riskTrail.length <= 200);
});

test("every transition records the reason it happened", () => {
  const { episode } = step(newEpisode("p1"), { risk: RISK.elevated });
  const last = episode.timeline.at(-1);
  assert.equal(last.to, S.WATCHING);
  assert.ok(last.reason && last.reason.length > 0);
});
