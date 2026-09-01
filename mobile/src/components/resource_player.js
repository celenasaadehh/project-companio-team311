// Plays or opens whatever the therapist attached to an intervention.
import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Image, Linking, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { RESOURCE_KIND } from "./resource_editor";
import { getMediaViewUrl } from "../services/engine";
import { speak, stopSpeaking, SPEECH_PRIORITY } from "../services/speech";
import { notifyNow } from "../services/notify";

const META = {
  [RESOURCE_KIND.VOICE]: { icon: "mic", verb: "Play", tint: "#3B78C4",
                           fallback: "A message from your therapist" },
  [RESOURCE_KIND.AUDIO]: { icon: "musical-notes", verb: "Play", tint: "#1E7A54",
                           fallback: "Audio" },
  [RESOURCE_KIND.LINK]:  { icon: "play-circle", verb: "Open", tint: "#A32B2B",
                           fallback: "Watch this" },
  [RESOURCE_KIND.IMAGE]: { icon: "image", verb: "View", tint: "#6B5CA5",
                           fallback: "A picture" },
  [RESOURCE_KIND.PHONE]: { icon: "call", verb: "Call", tint: "#1E7A54",
                           fallback: "Call" },
  [RESOURCE_KIND.NOTE]:  { icon: "document-text", verb: null, tint: "#5A6E8C",
                           fallback: "From your therapist" },
  [RESOURCE_KIND.STEPS]: { icon: "list", verb: "Read again", tint: "#3B78C4",
                           fallback: "What to do" },
};

// A plan may hold one resource per intervention (the original shape), or a
// list. Both are read, so plans written before the list existed still work.
export function asResourceList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [v];
}

// Word-set for tolerant matching: lowercase, punctuation to spaces.
function nameTokens(s) {
  return new Set(
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean)
  );
}

// Lookup of the attachments for an offered intervention. Tolerant on purpose:
// the decision layer may phrase the action differently from the key the
// therapist typed ("5-4-3-2-1 grounding" vs "grounding 5-4-3-2-1", "sister
// voice" vs "listen to sister voice message"). A missed match here means the
// app ANNOUNCES a resource and delivers nothing, so word order and extra
// words must not break it.
export function resourcesFor(all, action) {
  if (!all || !action) return null;
  if (all[action]) return all[action];
  const want = String(action).toLowerCase().trim();
  let key = Object.keys(all).find((k) => k.toLowerCase().trim() === want);
  if (key) return all[key];
  const wantSet = nameTokens(action);
  if (!wantSet.size) return null;
  key = Object.keys(all).find((k) => {
    const ks = nameTokens(k);
    if (!ks.size) return false;
    const [small, big] = ks.size <= wantSet.size ? [ks, wantSet] : [wantSet, ks];
    for (const t of small) if (!big.has(t)) return false;
    return true;
  });
  return key ? all[key] : null;
}

export function ResourceList({ resources, patientId, autoPlay, prefs, vitals, actionKey }) {
  const list = asResourceList(resources);
  if (!list.length) return null;
  // Everything auto-delivers, in a deliberate order: a recorded human voice
  // beats spoken steps, which beat opening a link, which beats raising the
  // dial prompt. Only ONE fires automatically -- firing two at once (a call
  // prompt over her voice) would bury the more human of the pair.
  const rank = (r) =>
    r.kind === RESOURCE_KIND.VOICE || r.kind === RESOURCE_KIND.AUDIO ? 0
    : r.kind === RESOURCE_KIND.STEPS ? 1
    : r.kind === RESOURCE_KIND.LINK || (!r.kind && r.url) ? 2
    : r.kind === RESOURCE_KIND.PHONE ? 3
    : 9;
  let firstPlayable = -1, best = 9;
  list.forEach((r, i) => { const k = rank(r); if (k < best) { best = k; firstPlayable = i; } });
  if (best === 9) firstPlayable = -1;
  // The key carries the intervention name: each offered intervention gets a
  // fresh player, so its one-shot auto-play guard belongs to this offer and
  // cannot suppress the next one's recording.
  return list.map((r, i) => (
    <ResourcePlayer key={`${actionKey || ""}_${r.kind || "link"}_${i}`} resource={r}
      patientId={patientId}
      prefs={prefs} vitals={vitals} autoPlay={autoPlay && i === firstPlayable} />
  ));
}

export function ResourcePlayer({ resource, patientId, autoPlay, prefs, vitals }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const autoPlayedRef = useRef(false);
  const wantPlayRef = useRef(false);
  const player = useAudioPlayer(signedUrl ? { uri: signedUrl } : null);

  // play() before the player has loaded the URL is a silent no-op: the source
  // arrives via a state update, so playback must wait for the re-render that
  // carries it. This is the difference between "the app played her voice" and
  // "the app said it would".
  useEffect(() => {
    if (!signedUrl || !wantPlayRef.current) return;
    wantPlayRef.current = false;
    (async () => {
      try {
        // Audible even with the mute switch on -- a grounding recording that
        // silently "plays" during an episode helps nobody.
        await setAudioModeAsync({ playsInSilentMode: true });
      } catch {}
      // Her voice, not the robot's: cut any text-to-speech mid-sentence.
      try { stopSpeaking(); } catch {}
      try { player.play(); } catch {}
    })();
  }, [signedUrl]);

  const playable = resource && (resource.kind === RESOURCE_KIND.VOICE
    || resource.kind === RESOURCE_KIND.AUDIO || resource.kind === RESOURCE_KIND.STEPS
    || resource.kind === RESOURCE_KIND.LINK || (!resource.kind && resource.url)
    || resource.kind === RESOURCE_KIND.PHONE);

  // Spoken and sent at the same moment, not one or the other: if the phone is
  // face down or in a pocket the speech is missed, and if it is in the hand the
  // notification is redundant -- neither is knowable, so both happen.
  function deliverSteps() {
    const steps = resource.steps || [];
    if (!steps.length) return;
    const spoken = steps.map((t, i) => `${i + 1}. ${t}`).join(". ");
    speak(spoken, prefs, SPEECH_PRIORITY.SUPPORT, { vitals });
    notifyNow(resource.label || "What to do now", steps.join("\n"), 0,
      { kind: "intervention_steps" }).catch(() => {});
  }

  useEffect(() => {
    if (!autoPlay || !playable || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    open();
  }, [autoPlay, playable]);

  if (!resource) return null;

  // Older plans stored a bare url with no kind. Treat those as links rather
  // than dropping them.
  const kind = resource.kind || (resource.url ? RESOURCE_KIND.LINK : null);
  if (!kind) return null;
  const meta = META[kind] || META[RESOURCE_KIND.NOTE];
  const title = resource.label || meta.fallback;

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === RESOURCE_KIND.LINK) {
        const ok = await Linking.canOpenURL(resource.url);
        if (!ok) throw new Error("This device can't open that link.");
        // Announce before the app switch: being yanked into another app
        // mid-episode with no warning is disorienting -- the opposite of
        // grounding. Say what is happening, let the words land, then open.
        try { speak(`Opening ${title} now.`, prefs, SPEECH_PRIORITY.SUPPORT, { vitals }); } catch {}
        notifyNow(`Opening: ${title}`, "Companio is opening this intervention now.", 0)
          .catch(() => {});
        await new Promise((r) => setTimeout(r, 1400));
        await Linking.openURL(resource.url);
      } else if (kind === RESOURCE_KIND.PHONE) {
        try { speak(`Calling ${title} now.`, prefs, SPEECH_PRIORITY.SUPPORT, { vitals }); } catch {}
        await new Promise((r) => setTimeout(r, 900));
        await Linking.openURL(`tel:${String(resource.phone).replace(/[^\d+]/g, "")}`);
      } else if (kind === RESOURCE_KIND.VOICE || kind === RESOURCE_KIND.AUDIO) {
        // Media lives in an encrypted bucket, so playback needs a short-lived
        // signed URL fetched at the moment it is played.
        if (signedUrl) {
          try { await setAudioModeAsync({ playsInSilentMode: true }); } catch {}
          try { stopSpeaking(); } catch {}
          player.play();
        } else {
          const url = (await getMediaViewUrl(resource.s3_key, patientId))?.url;
          if (!url) throw new Error("That recording could not be loaded.");
          wantPlayRef.current = true;
          setSignedUrl(url);   // the effect above plays once the source lands
        }
      } else if (kind === RESOURCE_KIND.STEPS) {
        deliverSteps();
      } else if (kind === RESOURCE_KIND.IMAGE) {
        const url = signedUrl || ((await getMediaViewUrl(resource.s3_key, patientId))?.url);
        if (!url) throw new Error("That image could not be loaded.");
        setSignedUrl(url);
      }
    } catch (e) {
      Alert.alert("Couldn't open that", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (kind === RESOURCE_KIND.STEPS) {
    const steps = resource.steps || [];
    return (
      <View style={{ marginTop: 8, padding: 13, borderRadius: radius.md,
                     backgroundColor: C.primarySoft }}>
        <Text style={[type.meta, { marginBottom: 7 }]}>
          {(resource.label || "WHAT TO DO NOW").toUpperCase()}
        </Text>
        {steps.map((t, i) => (
          <View key={i} style={{ flexDirection: "row", marginBottom: 5 }}>
            <Text style={{ width: 18, fontWeight: "800", color: C.primary, fontSize: 14.5 }}>
              {i + 1}
            </Text>
            <Text style={[type.body, { flex: 1, color: C.textPrimary }]}>{t}</Text>
          </View>
        ))}
        <TouchableOpacity onPress={deliverSteps} activeOpacity={0.8}
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
          <Ionicons name="volume-high" size={16} color={C.primary} />
          <Text style={{ marginLeft: 7, fontWeight: "700", fontSize: 13, color: C.primary }}>
            Read them to me again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (kind === RESOURCE_KIND.NOTE) {
    return (
      <View style={{ marginTop: 8, padding: 12, borderRadius: radius.md,
                     backgroundColor: C.primarySoft }}>
        <Text style={[type.meta, { marginBottom: 4 }]}>{title.toUpperCase()}</Text>
        <Text style={[type.body, { color: C.textPrimary }]}>{resource.text}</Text>
      </View>
    );
  }

  if (kind === RESOURCE_KIND.IMAGE && signedUrl) {
    return (
      <Image source={{ uri: signedUrl }} resizeMode="cover"
        style={{ marginTop: 8, width: "100%", height: 200, borderRadius: radius.md }} />
    );
  }

  return (
    <TouchableOpacity onPress={open} activeOpacity={0.82} disabled={busy}
      style={{ flexDirection: "row", alignItems: "center", marginTop: 8, padding: 13,
               borderRadius: radius.md, backgroundColor: C.surfaceStrong }}>
      <Ionicons name={meta.icon} size={21} color={meta.tint} />
      <View style={{ flex: 1, marginLeft: 11 }}>
        <Text style={{ fontWeight: "700", fontSize: 14.5, color: C.textPrimary }}>{title}</Text>
        {resource.seconds ? (
          <Text style={[type.sub, { marginTop: 1 }]}>{resource.seconds} seconds</Text>
        ) : kind === RESOURCE_KIND.VOICE ? (
          <Text style={[type.sub, { marginTop: 1 }]}>Recorded by your therapist</Text>
        ) : null}
      </View>
      <Text style={{ fontWeight: "700", fontSize: 13, color: meta.tint }}>
        {busy ? "…" : meta.verb}
      </Text>
    </TouchableOpacity>
  );
}
