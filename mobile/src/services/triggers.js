// Matches perception labels to a patient's known triggers.
const GENERIC = new Set(VOCAB.generic);

import VOCAB from "../data/trigger_vocabulary.json";

const SYNONYMS = Object.fromEntries(
  Object.entries(VOCAB.concepts).map(([concept, v]) => [concept, v.specific]),
);
const WEAK_SYNONYMS = Object.fromEntries(
  Object.entries(VOCAB.concepts).map(([concept, v]) => [concept, v.weak || []]),
);
const WEAK_MATCH_FACTOR = VOCAB.weak_match_factor;

const ALIAS_TO_CONCEPT = {};
for (const [concept, aliases] of Object.entries(SYNONYMS)) {
  ALIAS_TO_CONCEPT[concept] = concept;
  for (const a of aliases) ALIAS_TO_CONCEPT[a] = concept;
}
const WEAK_ALIASES = new Set();
for (const [concept, aliases] of Object.entries(WEAK_SYNONYMS)) {
  for (const a of aliases) {
    if (!ALIAS_TO_CONCEPT[a]) ALIAS_TO_CONCEPT[a] = concept;
    WEAK_ALIASES.add(a);
  }
}

export function isWeakAlias(word) {
  return WEAK_ALIASES.has(String(word || "").toLowerCase().trim());
}

const clean = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function singular(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("zes")) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function conceptsOf(phrase) {
  const out = new Set();
  const words = clean(phrase).split(" ").filter(Boolean).map(singular);
  const wholeConcept = ALIAS_TO_CONCEPT[clean(phrase)];
  if (wholeConcept) out.add(wholeConcept);
  for (const w of words) {
    out.add(w);
    if (ALIAS_TO_CONCEPT[w]) out.add(ALIAS_TO_CONCEPT[w]);
  }
  return out;
}

export function normalizeLabels(labels = [], minConfidence = 55) {
  const seen = new Map();
  for (const l of labels) {
    const name = clean(l.name || l.Name);
    const conf = Number(l.confidence ?? l.Confidence ?? 0);
    if (!name || conf < minConfidence || GENERIC.has(name)) continue;
    const s = singular(name);
    const concept = ALIAS_TO_CONCEPT[name] || ALIAS_TO_CONCEPT[s] || s;
    const weak = isWeakAlias(name) || isWeakAlias(s);
    const prev = seen.get(concept);
    if (!prev || prev.confidence < conf) {
      seen.set(concept, { confidence: conf, weak: prev ? (prev.weak && weak) : weak });
    } else if (!weak) {
      seen.set(concept, { ...prev, weak: false });
    }
  }
  return [...seen.entries()].map(([concept, v]) => ({
    concept, confidence: v.confidence, weak: v.weak,
  }));
}

export function matchTrigger(labels = [], therapistTriggers = [], threshold = 0.5) {
  const normalized = normalizeLabels(labels);
  const labelConcepts = new Set(normalized.map((n) => n.concept));
  const confByConcept = Object.fromEntries(normalized.map((n) => [n.concept, n.confidence]));
  const weakByConcept = Object.fromEntries(normalized.map((n) => [n.concept, !!n.weak]));

  let best = null;
  for (const trig of therapistTriggers) {
    const trigConcepts = conceptsOf(trig);
    let matchedConf = 0, matches = 0;
    let sawSpecific = false;
    for (const c of labelConcepts) {
      if (trigConcepts.has(c)) {
        matchedConf = Math.max(matchedConf, confByConcept[c] || 0);
        matches++;
        if (!weakByConcept[c]) sawSpecific = true;
      }
    }
    if (matches > 0) {
      let score = Math.min(1, (matchedConf / 100) * (1 + 0.1 * (matches - 1)));
      if (!sawSpecific) score = score * WEAK_MATCH_FACTOR;
      if (!best || score > best.trigger_match_score) {
        best = {
          candidate_trigger: trig, trigger_match_score: +score.toFixed(2),
          matched_confidence: matchedConf,
          weak_match_only: !sawSpecific,
        };
      }
    }
  }

  const known = !!best && best.trigger_match_score >= threshold;
  return {
    labels,
    normalized_concepts: normalized.map((n) => n.concept),
    candidate_trigger: best?.candidate_trigger || null,
    trigger_match_score: best?.trigger_match_score || 0,
    matched_confidence: best?.matched_confidence || 0,
    weak_match_only: !!best?.weak_match_only,
    known_trigger: known,
  };
}
