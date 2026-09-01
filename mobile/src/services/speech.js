// The one place Companio speaks, honouring the patient's voice setting.
import * as Speech from "expo-speech";

let speaking = false;

export const SPEECH_PRIORITY = {
  ROUTINE: "routine",
  SUPPORT: "support",
  URGENT: "urgent",
};

export function maySpeak(prefs, priority = SPEECH_PRIORITY.ROUTINE, vitals = null) {
  const mode = prefs?.voiceMode || "AUTO";

  if (mode === "SILENT") {
    return { allowed: false, reason: "Voice is set to Silent." };
  }

  // A HealthKit headphone-exposure sample in the last few minutes is evidence
  // audio was recently playing through headphones. It is a proxy and it lags,
  // so it may only suppress the speaker -- it can never enable it.
  if (vitals?.headphonesLikely && !prefs?.allowSpeaker) {
    return {
      allowed: false,
      reason: "Headphones look like they're in use, so this was sent as a notification instead of spoken aloud.",
    };
  }

  if (mode === "HEADPHONES_ONLY") {
    // iOS exposes the current audio route through AVAudioSession, but
    // expo-audio does not surface it to JavaScript -- its native module reads
    // currentRoute only for inputs and exports no accessor. Detecting
    // headphones therefore needs a native module and a rebuild.
    //
    // Rather than fail silent (which made this setting useless) or guess (which
    // could play a private message through a speaker), the patient decides:
    // "allow speaker" is off by default under this mode, and the message is
    // always delivered as a notification regardless.
    if (prefs?.allowSpeaker) return { allowed: true, reason: null };
    return {
      allowed: false,
      reason: "Headphones-only is on and the speaker is not allowed, so this was sent as a notification instead.",
    };
  }

  if (mode === "ALWAYS") return { allowed: true, reason: null };

  if (priority === SPEECH_PRIORITY.ROUTINE) {
    return { allowed: false, reason: "Voice is set to Smart, which stays quiet for routine messages." };
  }
  return { allowed: true, reason: null };
}

export function speak(text, prefs, priority = SPEECH_PRIORITY.SUPPORT, options = {}) {
  const vitals = options.vitals || null;
  if (!text) return { spoken: false, reason: "Nothing to say." };
  const { allowed, reason } = maySpeak(prefs, priority, vitals);
  if (!allowed) return { spoken: false, reason };
  try {
    Speech.stop();
    speaking = true;
    const userDone = options.onDone;
    const userStopped = options.onStopped;
    Speech.speak(String(text), {
      rate: 0.92, pitch: 1.0, ...options,
      // Chain rather than overwrite: callers use these to drive UI state from
      // actual speech completion instead of guessing from text length.
      onDone: () => { speaking = false; try { userDone?.(); } catch {} },
      onStopped: () => { speaking = false; try { userStopped?.(); } catch {} },
      onError: () => { speaking = false; try { userDone?.(); } catch {} },
    });
    return { spoken: true, reason: null };
  } catch (e) {
    return { spoken: false, reason: String(e?.message || e) };
  }
}

export function stopSpeaking() {
  speaking = false;
  try { Speech.stop(); } catch {}
}

export function isSpeaking() {
  return speaking;
}

export function interruptForListening(prefs) {
  if (prefs?.allowBargeIn === false) return { interrupted: false, reason: "barge-in is turned off" };
  const wasSpeaking = speaking;
  stopSpeaking();
  return { interrupted: wasSpeaking, reason: null };
}


// Say it AND send it.
//
// A spoken message the patient cannot hear -- headphones out, phone in a bag,
// a noisy street, voice set to silent -- is a message that never arrived. And a
// notification alone loses the point of speaking to someone who cannot look at
// a screen. Doing both means the message lands whichever way is available.
//
// Returns what actually happened so a screen can show the text when it was not
// spoken, rather than leaving the patient wondering.
export async function speakAndNotify(text, prefs, priority, notify, opts = {}) {
  if (!text) return { spoken: false, notified: false };

  const said = speak(text, prefs, priority, opts.speechOptions);

  let notified = false;
  if (typeof notify === "function") {
    // Keep the banner short; the full text is on screen and in the record.
    const body = text.length > 140 ? `${text.slice(0, 137)}…` : text;
    notified = !!(await notify(opts.title || "Companio", body, 0, opts.data || {}));
  }

  return { spoken: said.spoken, notified, reason: said.reason };
}
