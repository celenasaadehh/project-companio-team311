// Attaching a resource to an intervention: link, voice, audio, image, phone, note.
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAudioRecorder, useAudioRecorderState, RecordingPresets } from "expo-audio";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Btn } from "./ui";
import { uploadAudio, uploadImage } from "../services/media";

// A link is the weakest thing a clinician can leave someone mid-episode: it
// needs a network, a browser, and enough attention to read. The kinds below
// exist so the therapist can leave what actually lands -- most of all their own
// recorded voice, which a patient recognises when text has stopped working.
export const RESOURCE_KIND = {
  VOICE: "voice",
  LINK: "link",
  AUDIO: "audio",
  IMAGE: "image",
  PHONE: "phone",
  NOTE: "note",
  STEPS: "steps",
};

export const KINDS = [
  { id: RESOURCE_KIND.VOICE, label: "My voice", icon: "mic",
    hint: "Record yourself talking them through it. Played back in your voice." },
  { id: RESOURCE_KIND.LINK,  label: "Link", icon: "link",
    hint: "A YouTube video, a playlist, an article." },
  { id: RESOURCE_KIND.AUDIO, label: "Audio", icon: "musical-notes",
    hint: "A piece of music or a recording from this device." },
  { id: RESOURCE_KIND.IMAGE, label: "Image", icon: "image",
    hint: "A photograph that steadies them." },
  { id: RESOURCE_KIND.PHONE, label: "Phone", icon: "call",
    hint: "A number they can call with one tap." },
  { id: RESOURCE_KIND.NOTE,  label: "Note", icon: "document-text",
    hint: "A few words in your own wording. Shown on screen only." },
  { id: RESOURCE_KIND.STEPS, label: "Spoken steps", icon: "list",
    hint: "You type them; Companio reads them aloud AND sends them as a notification. One per line." },
];

// One step per line. Any numbering the therapist typed is stripped, because
// the speech and the notification add their own and "1. 1. Look around" reads
// badly out loud.
export function splitSteps(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*\u2022])\s*/, "").trim())
    .filter(Boolean);
}

const validUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || "").trim());
const validPhone = (v) => /^[+\d][\d\s()-]{5,}$/.test(String(v || "").trim());

export function ResourceEditor({ patientId, intervention, existing, onSave, onCancel }) {
  const [kind, setKind] = useState(existing?.kind || RESOURCE_KIND.LINK);
  const [draft, setDraft] = useState(existing?.url || existing?.text || "");
  const [label, setLabel] = useState(existing?.label || "");
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const active = KINDS.find((k) => k.id === kind);

  async function startRecording() {
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      Alert.alert("Couldn't start recording", e?.message || "The microphone is unavailable.");
    }
  }

  async function stopRecording() {
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("Nothing was recorded.");
      const { s3_key } = await uploadAudio(patientId, uri, "audio/m4a");
      setRecorded({ s3_key, seconds: Math.round((recorderState.durationMillis || 0) / 1000) });
    } catch (e) {
      Alert.alert("That recording didn't save", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pick(kindWanted) {
    setBusy(true);
    try {
      let uri = null, name = null, mime = null;

      if (kindWanted === RESOURCE_KIND.IMAGE) {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"], quality: 0.8,
        });
        if (res.canceled || !res.assets?.length) return;
        uri = res.assets[0].uri;
        name = res.assets[0].fileName || null;
        mime = res.assets[0].mimeType || "image/jpeg";
      } else {
        // Music and voice memos live in Files and iCloud Drive, not the photo
        // library, so audio is picked with the document browser instead.
        const res = await DocumentPicker.getDocumentAsync({
          type: "audio/*", copyToCacheDirectory: true, multiple: false,
        });
        if (res.canceled || !res.assets?.length) return;
        uri = res.assets[0].uri;
        name = res.assets[0].name || null;
        mime = res.assets[0].mimeType || "audio/m4a";
      }

      const upload = kindWanted === RESOURCE_KIND.IMAGE ? uploadImage : uploadAudio;
      const { s3_key } = await upload(patientId, uri, mime);
      setRecorded({ s3_key, filename: name });
    } catch (e) {
      Alert.alert("That file didn't upload", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function canSave() {
    if (busy) return false;
    if (kind === RESOURCE_KIND.LINK) return validUrl(draft);
    if (kind === RESOURCE_KIND.PHONE) return validPhone(draft);
    if (kind === RESOURCE_KIND.NOTE) return draft.trim().length > 0;
    if (kind === RESOURCE_KIND.STEPS) return splitSteps(draft).length > 0;
    return !!recorded?.s3_key;
  }

  function save() {
    const base = { kind, label: label.trim() || active?.label || null,
                   saved_at: new Date().toISOString() };
    if (kind === RESOURCE_KIND.LINK)  return onSave({ ...base, url: draft.trim() });
    if (kind === RESOURCE_KIND.PHONE) return onSave({ ...base, phone: draft.trim() });
    if (kind === RESOURCE_KIND.NOTE)  return onSave({ ...base, text: draft.trim() });
    if (kind === RESOURCE_KIND.STEPS) return onSave({ ...base, steps: splitSteps(draft) });
    return onSave({ ...base, s3_key: recorded.s3_key, seconds: recorded.seconds || null });
  }

  return (
    <View style={{ marginTop: 8, padding: 12, borderRadius: radius.md,
                   backgroundColor: C.surfaceStrong }}>
      <Text style={[type.meta, { marginBottom: 8 }]}>
        WHAT SHOULD COMPANIO GIVE THEM FOR “{String(intervention).toUpperCase()}”
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 10 }}>
        {KINDS.map((k) => {
          const on = kind === k.id;
          return (
            <TouchableOpacity key={k.id} activeOpacity={0.8}
              onPress={() => { setKind(k.id); setDraft(""); setRecorded(null); }}
              style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8,
                       paddingHorizontal: 12, borderRadius: radius.pill, marginRight: 7,
                       marginBottom: 7, borderWidth: 1.4,
                       borderColor: on ? C.primary : C.border,
                       backgroundColor: on ? C.primarySoft : "transparent" }}>
              <Ionicons name={k.icon} size={14} color={on ? C.primary : C.textMuted} />
              <Text style={{ marginLeft: 6, fontSize: 12.5, fontWeight: on ? "700" : "600",
                             color: on ? C.primary : C.textSecondary }}>{k.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[type.sub, { marginBottom: 9 }]}>{active?.hint}</Text>

      {kind === RESOURCE_KIND.VOICE ? (
        <View>
          {recorded ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 9 }}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={[type.body, { marginLeft: 8, color: C.success }]}>
                Recorded{recorded.seconds ? ` · ${recorded.seconds}s` : ""} and saved encrypted.
              </Text>
            </View>
          ) : null}
          <Btn label={recorderState.isRecording ? "Stop and save" : (recorded ? "Record again" : "Start recording")}
            icon={recorderState.isRecording ? "stop" : "mic"}
            color={recorderState.isRecording ? C.danger : C.primary}
            disabled={busy}
            onPress={recorderState.isRecording ? stopRecording : startRecording} />
          {recorderState.isRecording ? (
            <Text style={[type.meta, { marginTop: 6, color: C.danger }]}>
              Recording · {Math.round((recorderState.durationMillis || 0) / 1000)}s
            </Text>
          ) : null}
        </View>
      ) : kind === RESOURCE_KIND.AUDIO || kind === RESOURCE_KIND.IMAGE ? (
        <View>
          {recorded ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 9 }}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} />
              <Text style={[type.body, { marginLeft: 8, color: C.success }]}>
                Uploaded and saved encrypted.
              </Text>
            </View>
          ) : null}
          <Btn label={busy ? "Uploading…" : `Choose ${kind === RESOURCE_KIND.IMAGE ? "an image" : "a file"}`}
            icon="cloud-upload" disabled={busy} onPress={() => pick(kind)} />
        </View>
      ) : (
        <TextInput value={draft} onChangeText={setDraft}
          placeholder={kind === RESOURCE_KIND.LINK ? "https://…"
            : kind === RESOURCE_KIND.PHONE ? "+961 …"
            : kind === RESOURCE_KIND.STEPS
              ? "Karim, find five things you can see and say them out loud\nThen four things you can touch\nThen three things you can hear"
              : "What you'd say to them"}
          placeholderTextColor={C.textMuted}
          autoCapitalize={kind === RESOURCE_KIND.NOTE ? "sentences" : "none"}
          autoCorrect={kind === RESOURCE_KIND.NOTE}
          keyboardType={kind === RESOURCE_KIND.PHONE ? "phone-pad"
            : kind === RESOURCE_KIND.LINK ? "url" : "default"}
          multiline={kind === RESOURCE_KIND.NOTE || kind === RESOURCE_KIND.STEPS}
          style={{ borderWidth: 1, borderColor: C.border, borderRadius: radius.md,
                   paddingHorizontal: 12, paddingVertical: 10, fontSize: 14.5,
                   color: C.textPrimary, backgroundColor: C.surface,
                   minHeight: kind === RESOURCE_KIND.STEPS ? 104
                     : kind === RESOURCE_KIND.NOTE ? 70 : 44,
                   textAlignVertical: (kind === RESOURCE_KIND.NOTE
                     || kind === RESOURCE_KIND.STEPS) ? "top" : "center" }} />
      )}

      {kind === RESOURCE_KIND.STEPS && splitSteps(draft).length ? (
        <Text style={[type.meta, { marginTop: 7, color: C.primary }]}>
          {`Companio will read ${splitSteps(draft).length} step${splitSteps(draft).length === 1 ? "" : "s"} aloud and send them as a notification.`}
        </Text>
      ) : null}

      <TextInput value={label} onChangeText={setLabel}
        placeholder="What the patient sees this called (optional)"
        placeholderTextColor={C.textMuted}
        style={{ marginTop: 8, borderBottomWidth: 1, borderBottomColor: C.border,
                 paddingVertical: 9, fontSize: 13.5, color: C.textPrimary }} />

      <View style={{ flexDirection: "row", marginTop: 11 }}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <Btn label="Attach" icon="checkmark" disabled={!canSave()} onPress={save} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="Cancel" variant="outline" onPress={onCancel} />
        </View>
      </View>

      {busy ? <ActivityIndicator color={C.primary} style={{ marginTop: 9 }} /> : null}
    </View>
  );
}
