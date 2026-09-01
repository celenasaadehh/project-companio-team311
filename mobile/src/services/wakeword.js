// In-app "Hey Companio" listening, on-device, only while the app is open.
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

let SR = null;
try { SR = require("@jamsch/expo-speech-recognition"); } catch { SR = null; }

// Two things a wake word must not be: always-on in the background, and
// cloud-transcribed. iOS forbids the first for a third-party app, and the second
// would send a continuous stream of a PTSD patient's home audio to a server.
//
// So this runs only while the Companio screen is open and foregrounded, uses
// Apple's on-device recogniser so no audio leaves the phone, and matches a
// short phrase list rather than interpreting what it hears. Anything not
// matching the phrase is discarded, never stored, and never uploaded.
export const WAKE_PHRASES = [
  "hey companio",
  "hey campanio",   // the recogniser's usual mishearings of an unusual name
  "hey companion",
  "hey compano",
  "ok companio",
  "companio help",
  "companio i need help",
];

export const wakeWordAvailable = !!(SR?.ExpoSpeechRecognitionModule
  && typeof SR.supportsOnDeviceRecognition === "function");

export function onDeviceRecognitionSupported() {
  try { return wakeWordAvailable && SR.supportsOnDeviceRecognition(); }
  catch { return false; }
}

const normalise = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

export function matchesWakePhrase(text) {
  const t = normalise(text);
  if (!t) return false;
  return WAKE_PHRASES.some((p) => t.includes(p));
}

// Returns { listening, supported, error }. `onWake` fires once per utterance.
export function useWakeWord({ enabled, onWake }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);
  const firedRef = useRef(false);
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    if (!enabled || !wakeWordAvailable) return undefined;

    let alive = true;
    let restartTimer = null;
    const M = SR.ExpoSpeechRecognitionModule;
    const subs = [];

    const start = async () => {
      if (!alive || AppState.currentState !== "active") return;
      try {
        const perm = await M.requestPermissionsAsync();
        if (!perm?.granted) {
          if (alive) setError("Microphone or speech permission was declined.");
          return;
        }
        if (!alive) return;
        M.start({
          lang: "en-US",
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: onDeviceRecognitionSupported(),
          addsPunctuation: false,
        });
        if (alive) { setListening(true); setError(null); }
        console.log("[wakeword] listening started, onDevice:", onDeviceRecognitionSupported());
      } catch (e) {
        console.log("[wakeword] start failed:", e?.message || String(e));
        if (alive) setError(e?.message || "Listening could not start.");
      }
    };

    subs.push(SR.addSpeechRecognitionListener("result", (ev) => {
      const said = ev?.results?.[0]?.transcript;
      if (!said || firedRef.current) return;
      console.log("[wakeword] heard:", JSON.stringify(said));
      if (matchesWakePhrase(said)) {
        firedRef.current = true;
        onWakeRef.current?.(said);
        setTimeout(() => { firedRef.current = false; }, 2500);
      }
    }));

    subs.push(SR.addSpeechRecognitionListener("error", (ev) => {
      console.log("[wakeword] error event:", ev?.error, ev?.message);
      if (alive) setError(ev?.message || String(ev?.error || "Listening stopped."));
    }));

    subs.push(SR.addSpeechRecognitionListener("end", () => {
      // iOS ends the session on its own after a silence. Restart only while
      // still mounted and foregrounded -- restarting during teardown is what
      // leaves a recogniser session open and hangs module invalidation.
      if (!alive || !enabled) return;
      restartTimer = setTimeout(start, 400);
    }));

    // Backgrounding must release the microphone, or the audio session is still
    // held when the app comes back and the recorder cannot claim it.
    const appSub = AppState.addEventListener("change", (next) => {
      if (!alive) return;
      if (next === "active") { start(); }
      else { try { M.abort(); } catch {} setListening(false); }
    });

    start();

    return () => {
      alive = false;
      if (restartTimer) clearTimeout(restartTimer);
      // Listeners come off first so the "end" event fired by teardown cannot
      // schedule another start.
      subs.forEach((x) => { try { x.remove(); } catch {} });
      try { appSub.remove(); } catch {}
      // abort(), not stop(): stop() waits for the recogniser to deliver final
      // results, and waiting is precisely what times out when React Native is
      // invalidating native modules on reload.
      try { M.abort(); } catch {}
      setListening(false);
    };
  }, [enabled]);

  return { listening, supported: wakeWordAvailable, error };
}
