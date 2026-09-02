// The therapist writes intervention names in free text. These map that text
// onto a guided technique, an actionable control, or plain instructions --
// without ever inventing a technique the therapist did not name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const G = await load("src/data/grounding.js", {});
const { matchTechnique, techniqueById, classifyAction, ACTION_KIND, GROUNDING_TECHNIQUES } = G;

test("the library ships ten techniques, each with steps", () => {
  assert.equal(GROUNDING_TECHNIQUES.length, 10);
  for (const t of GROUNDING_TECHNIQUES) {
    assert.ok(t.id && t.name, "every technique needs an id and a name");
    assert.ok(Array.isArray(t.steps) && t.steps.length > 0, `${t.id} needs steps`);
  }
});

test("the therapist's own wording finds the technique", () => {
  assert.equal(matchTechnique("grounding 5-4-3-2-1").id, "sensory_54321");
  assert.equal(matchTechnique("5-4-3-2-1 grounding").id, "sensory_54321");
});

test("word order does not change which technique is found", () => {
  assert.equal(
    matchTechnique("counting backwards from ten").id,
    matchTechnique("from ten, counting backwards").id,
  );
});

test("breathing phrasings resolve to the paced exhale", () => {
  for (const phrase of ["slow breathing", "long exhale", "paced breath"]) {
    assert.equal(matchTechnique(phrase).id, "slow_exhale", phrase);
  }
});

test("sensory phrasings resolve to their techniques", () => {
  assert.equal(matchTechnique("hold something cold").id, "temperature");
  assert.equal(matchTechnique("feel your feet on the floor").id, "feet_floor");
  assert.equal(matchTechnique("orient to the room").id, "orient_room");
});

test("an unrecognised instruction is never forced onto a technique", () => {
  assert.equal(matchTechnique("call your sister"), null);
  assert.equal(matchTechnique("listen to the voice message"), null);
});

test("a keyword inside another word never matches", () => {
  // "voice" contains "ice"; a recorded voice message is not the cold-object
  // technique, and matching it as one would play the wrong walkthrough.
  assert.equal(matchTechnique("sister voice"), null);
  assert.equal(matchTechnique("listen to her voice note"), null);
  assert.equal(matchTechnique("practice this later"), null);
  assert.equal(matchTechnique("hold something cold").id, "temperature");
});

test("empty or missing text matches nothing", () => {
  assert.equal(matchTechnique(""), null);
  assert.equal(matchTechnique(null), null);
  assert.equal(matchTechnique(undefined), null);
});

test("a guided technique is classified as guided", () => {
  const c = classifyAction("grounding 5-4-3-2-1");
  assert.equal(c.kind, ACTION_KIND.GUIDED);
  assert.equal(c.technique.id, "sensory_54321");
});

test("free-text guidance stays plain instruction", () => {
  const c = classifyAction("sit down somewhere quiet and wait with me");
  assert.equal(c.kind, ACTION_KIND.INSTRUCTION);
  assert.equal(c.technique, null);
});

test("empty guidance classifies without throwing", () => {
  const c = classifyAction("");
  assert.equal(c.kind, ACTION_KIND.INSTRUCTION);
  assert.equal(c.action, "");
});

test("technique lookup by id returns the same object the matcher does", () => {
  assert.equal(techniqueById("sensory_54321"), matchTechnique("5-4-3-2-1"));
  assert.equal(techniqueById("no_such_technique"), null);
});

test("every technique is reachable from its own name", () => {
  for (const t of GROUNDING_TECHNIQUES) {
    assert.ok(matchTechnique(t.id), `${t.id} must be findable by id`);
  }
});
