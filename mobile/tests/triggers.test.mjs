// Turning camera labels into a patient's known triggers. A false positive
// here tells someone they saw the thing that hurt them, so the weak-alias
// rules matter as much as the matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VOCAB = require("../src/data/trigger_vocabulary.json");

const T = await load("src/services/triggers.js", {
  "../data/trigger_vocabulary.json": VOCAB,
});
const { matchTrigger, normalizeLabels, isWeakAlias } = T;

const label = (name, confidence = 95) => ({ name, confidence });

test("a specific alias identifies the therapist's trigger", () => {
  const r = matchTrigger([label("garbage")], ["trash bag"]);
  assert.equal(r.candidate_trigger, "trash bag");
  assert.equal(r.known_trigger, true);
});

test("an everyday word alone cannot fire a trigger", () => {
  const r = matchTrigger([label("bag")], ["trash bag"]);
  assert.equal(r.known_trigger, false, "a handbag must never be reported as a trash bag");
  assert.equal(r.weak_match_only, true);
});

test("a weak match is scored but held below the threshold", () => {
  const r = matchTrigger([label("bag")], ["trash bag"]);
  assert.ok(r.trigger_match_score > 0);
  assert.ok(r.trigger_match_score < 0.5);
});

test("a specific alias alongside a weak one still fires", () => {
  const r = matchTrigger([label("bag"), label("garbage")], ["trash bag"]);
  assert.equal(r.known_trigger, true);
  assert.equal(r.weak_match_only, false);
});

test("generic labels are discarded before matching", () => {
  const r = normalizeLabels([label("person"), label("clothing"), label("garbage")]);
  const concepts = r.map((x) => x.concept);
  assert.ok(!concepts.includes("person"));
  assert.ok(concepts.includes("trash bag"));
});

test("low-confidence labels are ignored", () => {
  const r = normalizeLabels([label("garbage", 20)]);
  assert.equal(r.length, 0);
});

test("the confidence floor is applied at the documented threshold", () => {
  assert.equal(normalizeLabels([label("garbage", 54)]).length, 0);
  assert.equal(normalizeLabels([label("garbage", 56)]).length, 1);
});

test("plurals resolve to the same concept", () => {
  const r = matchTrigger([label("fireworks")], ["fireworks"]);
  assert.equal(r.known_trigger, true);
});

test("nothing matching a trigger list returns no candidate", () => {
  const r = matchTrigger([label("tree"), label("sky")], ["trash bag"]);
  assert.equal(r.candidate_trigger, null);
  assert.equal(r.known_trigger, false);
});

test("an empty trigger list can never produce a match", () => {
  const r = matchTrigger([label("garbage")], []);
  assert.equal(r.known_trigger, false);
});

test("no labels at all produces no match", () => {
  const r = matchTrigger([], ["trash bag"]);
  assert.equal(r.known_trigger, false);
  assert.deepEqual(r.normalized_concepts, []);
});

test("the strongest of several candidate triggers wins", () => {
  const r = matchTrigger([label("garbage", 99), label("vehicle", 60)], ["trash bag", "truck"]);
  assert.equal(r.candidate_trigger, "trash bag");
});

test("weak aliases are declared as weak", () => {
  assert.equal(isWeakAlias("bag"), true);
  assert.equal(isWeakAlias("garbage"), false);
});

test("Rekognition's capitalised field names are accepted", () => {
  const r = matchTrigger([{ Name: "Garbage", Confidence: 92 }], ["trash bag"]);
  assert.equal(r.known_trigger, true);
});

test("the normalized concepts are reported for the clinical record", () => {
  const r = matchTrigger([label("garbage")], ["trash bag"]);
  assert.ok(r.normalized_concepts.includes("trash bag"));
});

test("a stricter threshold can withhold a borderline match", () => {
  const weak = matchTrigger([label("garbage", 60)], ["trash bag"], 0.9);
  assert.equal(weak.known_trigger, false);
});
