// Detects a loud-noise trigger from measured sound level, not from the camera.
import VOCAB from "../data/trigger_vocabulary.json";

// A camera cannot see a bang. Matching "loud noise" against Rekognition labels
// only fires when something noisy is visible -- an ambulance in frame -- and
// misses the case that actually matters: a door slamming behind someone.
//
// The Apple Watch measures environmental sound in decibels, so the trigger is
// evaluated against that instead. Two independent conditions, because a startle
// response has two causes:
//
//   the jump   a sudden rise above the recent quiet floor. This is the one that
//              matters clinically -- a bang in a quiet street is startling at a
//              level that would be unremarkable on a motorway.
//   the level  a sustained absolute level loud enough to be distressing on its
//              own. Apple's own Noise app warns from 80 dB.
export const ACOUSTIC_CONCEPT = "loud noise";

export const SOUND = {
  JUMP_DB: 20,        // rise over the recent floor that reads as sudden
  ABSOLUTE_DB: 85,    // loud regardless of what came before
  STALE_MINUTES: 10,  // older than this describes a different moment
};

export function isAcousticConcept(concept) {
  const c = String(concept || "").toLowerCase().trim();
  return c === ACOUSTIC_CONCEPT || (VOCAB.acoustic_concepts || []).includes(c);
}

// Returns null when there is no usable reading, so a missing measurement is
// never mistaken for a quiet room.
export function detectLoudNoise(vitals) {
  const db = vitals?.ambientDb;
  if (db == null || !Number.isFinite(db)) return null;

  const age = vitals.ambientAgeMinutes;
  if (age != null && age > SOUND.STALE_MINUTES) {
    return { detected: false, db, reason: `last sound reading is ${age} minutes old` };
  }

  const jump = vitals.ambientJumpDb;
  const baseline = vitals.ambientBaselineDb;

  if (jump != null && jump >= SOUND.JUMP_DB) {
    return {
      detected: true,
      db,
      baseline_db: baseline,
      jump_db: jump,
      basis: "sudden_rise",
      reason: `${db} dB, up ${jump} dB from a ${baseline} dB background`,
    };
  }

  if (db >= SOUND.ABSOLUTE_DB) {
    return {
      detected: true,
      db,
      baseline_db: baseline,
      jump_db: jump,
      basis: "absolute_level",
      reason: `${db} dB sustained`,
    };
  }

  return {
    detected: false,
    db,
    baseline_db: baseline,
    jump_db: jump,
    reason: `${db} dB is within this person's usual range`,
  };
}

// Only reports the trigger if the therapist actually logged it for this patient.
// Identical to the visual path: a measurement is evidence, not authority.
export function acousticTriggerMatch(vitals, knownTriggers = []) {
  const known = (knownTriggers || []).map((t) => String(t).toLowerCase().trim());
  if (!known.some(isAcousticConcept)) return null;

  const sound = detectLoudNoise(vitals);
  if (!sound || !sound.detected) return null;

  return {
    trigger: ACOUSTIC_CONCEPT,
    concept: ACOUSTIC_CONCEPT,
    modality: "sound",
    confidence: sound.basis === "sudden_rise" ? 0.9 : 0.8,
    source: "watch_sound_level",
    ...sound,
  };
}

export function describeSound(vitals) {
  const s = detectLoudNoise(vitals);
  if (!s) return "No sound level recorded — the Watch reports this only periodically.";
  return s.reason;
}
