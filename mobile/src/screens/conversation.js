// Patient–therapist messaging and new patient intake.
import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { AppHeader, Screen, Card, SectionTitle, Btn, Chip, Row, EmptyState } from "../components/ui";
import { useApp } from "../state/AppContext";
import { SignaturePad } from "../components/signature";
import { saveIdentity, saveClinicalProfile, saveAssignment, findPatientByUsername, updateClinicalProfile } from "../services/engine";
import { requestCall, raiseEmergencyAlert, requestAppointment } from "../services/alerts";
import { getSessions } from "../services/engine";

export function Conversation({ route, navigation }) {
  const { patientId, viewerRole = "therapist" } = route.params || {};
  const { messagesFor, sendMessage, patient, authUser, loadMessages } = useApp();
  const messages = messagesFor(patientId);
  const [text, setText] = useState("");
  const [urgentBusy, setUrgentBusy] = useState(false);
  const [ack, setAck] = useState(null);
  const scroller = useRef(null);

  useEffect(() => {
    if (viewerRole !== "patient" || !patientId) return;
    let alive = true;
    const check = async () => {
      try {
        const r = await getSessions(patientId);
        const rows = r?.sessions || r?.items || [];
        const latest = rows
          .filter((x) => x.type === "acknowledgement")
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
        if (alive && latest) setAck(latest);
      } catch {
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [patientId, viewerRole]);

  const p = patient(patientId);
  const otherName = viewerRole === "therapist" ? (p?.name || "Patient") : (authUser?.therapistName || "Your therapist");

  useEffect(() => { const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120); return () => clearTimeout(t); }, [messages.length]);

  useEffect(() => { loadMessages?.(patientId); }, [patientId, loadMessages]);

  function send() {
    if (!text.trim()) return;
    sendMessage(patientId, viewerRole, text);
    setText("");
  }

  async function sendUrgent(kind) {
    setUrgentBusy(true);
    const label =
      kind === "call_request" ? "📞 I asked for a call back."
      : kind === "appointment_request" ? "📅 I asked to book an appointment."
      : "🚨 I marked this as urgent.";
    let ok = false;
    let failure = null;
    try {
      if (kind === "call_request") await requestCall(patientId);
      else if (kind === "appointment_request") await requestAppointment(patientId);
      else await raiseEmergencyAlert(patientId);
      ok = true;
    } catch (e) {
      failure = String(e?.message || e);
    } finally {
      sendMessage(patientId, "patient", ok ? label : `${label} (not sent — see below)`);
      if (!ok) {
        sendMessage(patientId, "system",
          "This did NOT reach your therapist. Please try again when you have a connection." +
          (kind === "emergency_alert"
            ? " If you are in immediate danger, call 911 or 988 now — do not wait for this app."
            : ""));
        Alert.alert(
          "Not sent",
          `Your request could not be sent.\n\n${failure || "No connection."}\n\n` +
          (kind === "emergency_alert"
            ? "If you are in immediate danger, call 911 or 988 now."
            : "Please try again in a moment."),
        );
      }
      setUrgentBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top"]}>
      <AppHeader title={otherName} subtitle={viewerRole === "therapist" ? (p?.displayId || "") : "Your therapist"} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.md }}>
          {ack && viewerRole === "patient" ? (
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.successSoft,
                           borderRadius: radius.md, padding: 12, marginBottom: spacing.md }}>
              <Ionicons name="checkmark-circle" size={20} color={C.success} />
              <Text style={[type.sub, { flex: 1, marginLeft: 10, color: C.textPrimary }]}>
                {`${ack.acknowledged_by || "Your therapist"} has seen your request.`}
              </Text>
            </View>
          ) : null}
          {messages.length === 0 ? (
            <Text style={[type.sub, { textAlign: "center", marginTop: 40 }]}>No messages yet. Say hello.</Text>
          ) : messages.map((m, i) => {
            const mine = m.from === viewerRole;
            return (
              <View key={i} style={{ alignItems: mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
                <View style={{ maxWidth: "80%", backgroundColor: mine ? C.primary : C.surface, borderRadius: 20, borderBottomRightRadius: mine ? 6 : 20, borderBottomLeftRadius: mine ? 20 : 6, paddingVertical: 10, paddingHorizontal: 14, borderWidth: mine ? 0 : 1, borderColor: C.border }}>
                  <Text style={{ color: mine ? "#fff" : C.textPrimary, fontSize: 15, lineHeight: 20 }}>{m.text}</Text>
                </View>
                <Text style={[type.meta, { marginTop: 3, marginHorizontal: 4 }]}>{m.time}</Text>
              </View>
            );
          })}
        </ScrollView>
        {viewerRole === "patient" ? (
          <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border }}>
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <TouchableOpacity onPress={() => !urgentBusy && sendUrgent("call_request")} activeOpacity={0.78}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: C.border }}>
                  <Ionicons name="call" size={16} color={C.primary} style={{ marginRight: 6 }} />
                  <Text style={{ color: C.primary, fontWeight: "700", fontSize: 13 }}>Request a call</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <TouchableOpacity onPress={() => !urgentBusy && sendUrgent("emergency_alert")} activeOpacity={0.78}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: C.dangerSoft }}>
                  <Ionicons name="alert-circle" size={16} color={C.danger} style={{ marginRight: 6 }} />
                  <Text style={{ color: C.danger, fontWeight: "700", fontSize: 13 }}>Alert now</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={{ fontSize: 10.5, color: C.textMuted, textAlign: "center", marginTop: 6 }}>
              Not monitored 24/7. In immediate danger, call 911 or the 988 Suicide & Crisis Lifeline.
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "flex-end", padding: spacing.md, backgroundColor: C.surface, borderTopWidth: viewerRole === "patient" ? 0 : 1, borderTopColor: C.border }}>
          <TextInput value={text} onChangeText={setText} placeholder="Message…" placeholderTextColor={C.textMuted} multiline
            style={{ flex: 1, maxHeight: 110, backgroundColor: C.background, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: C.textPrimary }} />
          <TouchableOpacity onPress={send} disabled={!text.trim()}
            style={{ marginLeft: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? C.primary : C.border, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AddPatient({ navigation }) {
  const { addPatient } = useApp();
  const [name, setName] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("F");
  const [level, setLevel] = useState("low");
  const [concern, setConcern] = useState("");
  const [subtype, setSubtype] = useState("");
  const [interventions, setInterventions] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [forbidden, setForbidden] = useState([]);
  const [meds, setMeds] = useState([]);
  const [mName, setMName] = useState(""); const [mDose, setMDose] = useState(""); const [mFreq, setMFreq] = useState("");
  const [consent, setConsent] = useState(false);
  const [signedP, setSignedP] = useState(false);
  const [signedT, setSignedT] = useState(false);

  const addMed = () => { if (!mName.trim()) return; setMeds((m) => [...m, { name: mName.trim(), dose: mDose.trim(), frequency: mFreq.trim() }]); setMName(""); setMDose(""); setMFreq(""); };

  const ready = name.trim() && loginUsername.trim() && consent && signedT && interventions.length > 0;

  async function save() {
    if (!ready) return;

    // If this username already belongs to an account, CONNECT to that record.
    // Creating a fresh one beside it makes a ghost: the therapist manages the
    // blank clone while the patient's own app stays linked to the original.
    let existing = null;
    try { existing = await findPatientByUsername(loginUsername.trim()); } catch {}

    if (existing?.patient_id) {
      const pid = existing.patient_id;
      const p = addPatient({ id: pid, name, age, gender, level, presentingConcern: concern.trim(), interventions, triggers, forbidden, medications: meds, consent, signedPatient: signedP, signedTherapist: signedT });

      // Merge, never replace: only the fields the therapist actually typed in
      // this form overwrite the existing plan. Empty sections keep whatever
      // the record already holds.
      const patch = {};
      if (concern.trim()) patch.condition = concern.trim();
      if (subtype) patch.ptsd_subtype = subtype;
      if (triggers.length) patch.known_triggers = triggers;
      if (interventions.length) patch.approved_interventions = interventions;
      if (forbidden.length) patch.forbidden_interventions = forbidden;
      if (meds.length) patch.medications = meds;
      if (Object.keys(patch).length) {
        updateClinicalProfile(pid, patch).catch((e) => {
          console.warn("Clinical profile not updated on AWS:", e);
          Alert.alert(
            "Care plan not saved",
            `${name.trim()} was connected, but the plan changes did not save.\n\n${String(e?.message || e)}\n\nOpen their Treatment plan and add them again.`,
          );
        });
      }
      saveAssignment({ patient_id: pid }).catch((e) => console.warn("Assignment not saved to AWS:", e));

      navigation.replace("Workspace", { patientId: pid });
      return;
    }

    const p = addPatient({ name, age, gender, level, presentingConcern: concern.trim(), interventions, triggers, forbidden, medications: meds, consent, signedPatient: signedP, signedTherapist: signedT });

    saveIdentity({
      patient_id: p.id,
      username: loginUsername.trim(),
      display_name: name.trim(),
    }).catch((e) => console.warn("Identity not saved to AWS:", e));
    saveClinicalProfile({
      patient_id: p.id,
      condition: concern.trim() || "PTSD",
      ptsd_subtype: subtype || null,
      known_triggers: triggers,
      approved_interventions: interventions,
      forbidden_interventions: forbidden,
      medications: meds,
    }).catch((e) => {
      console.warn("Clinical profile not saved to AWS:", e);
      Alert.alert(
        "Care plan not saved",
        `${name.trim()}'s record was created, but the care plan (triggers and approved interventions) did not save.\n\n${String(e?.message || e)}\n\nCompanio cannot make real decisions for them until it does — open their Treatment plan and add it again.`,
      );
    });
    saveAssignment({ patient_id: p.id }).catch((e) => console.warn("Assignment not saved to AWS:", e));

    navigation.replace("Workspace", { patientId: p.id });
  }

  return (
    <Screen>
      <AppHeader title="New patient intake" subtitle="Formal record · consent required" onBack={() => navigation.goBack()} />

      <SectionTitle>Patient details</SectionTitle>
      <Card>
        <Field value={name} onChangeText={setName} placeholder="Full name · e.g. Jordan Rivera" autoFocus />
        <Field value={loginUsername} onChangeText={setLoginUsername}
          placeholder="Their Companio username · links their account"
          autoCapitalize="none" autoCorrect={false} />
        <Text style={[type.meta, { marginTop: -2, marginBottom: 8, letterSpacing: 0 }]}>
          The username they sign in with. This is what connects this record to their account — they can sign up before or after you add them.
        </Text>
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, marginRight: 8 }}><Field value={age} onChangeText={setAge} placeholder="Age" keyboardType="number-pad" /></View>
          <View style={{ flex: 2, flexDirection: "row", flexWrap: "wrap" }}>{["F", "M", "Other"].map((g) => <Chip key={g} label={g} active={gender === g} onPress={() => setGender(g)} />)}</View>
        </View>
        <Text style={[type.meta, { marginTop: 6, marginBottom: 4 }]}>INITIAL RISK LEVEL</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{["low", "elevated", "high"].map((l) => <Chip key={l} label={l} active={level === l} onPress={() => setLevel(l)} />)}</View>
      </Card>

      <SectionTitle>Presenting concern</SectionTitle>
      <Card><Field value={concern} onChangeText={setConcern} placeholder="Reason for referral, history, current symptoms…" multiline style={multiline} /></Card>

      <SectionTitle sub="Shapes how Companio speaks and what it offers. Optional, but support is more appropriate with it.">
        Trauma presentation
      </SectionTitle>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {["Combat / military", "Sexual violence", "Childhood / complex", "Accident / injury",
            "Medical", "Disaster", "Bereavement", "Other"].map((t) => (
            <Chip key={t} label={t} active={subtype === t}
              onPress={() => setSubtype(subtype === t ? "" : t)} />
          ))}
        </View>
        <Text style={[type.meta, { marginTop: 8 }]}>
          This is clinical context for the care plan — it never changes what you have approved or forbidden.
        </Text>
      </Card>

      <SectionTitle>Approved interventions</SectionTitle>
      <Text style={[type.meta, { marginBottom: 6 }]}>Type any therapist-approved intervention. There is no preset restriction.</Text>
      <Card><FreeEntryList items={interventions} setItems={setInterventions} placeholder="Type an intervention, e.g. paced breathing" addLabel="Add intervention" /></Card>

      <SectionTitle>Known triggers</SectionTitle>
      <Card><FreeEntryList items={triggers} setItems={setTriggers} placeholder="Type a trigger, e.g. crowded spaces" addLabel="Add trigger" /></Card>

      <SectionTitle>Forbidden (never suggest)</SectionTitle>
      <Card><FreeEntryList items={forbidden} setItems={setForbidden} placeholder="Type a forbidden intervention" addLabel="Add forbidden item" /></Card>

      <SectionTitle>Medications</SectionTitle>
      <Card>
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 2, marginRight: 6 }}><Field value={mName} onChangeText={setMName} placeholder="Name" /></View>
          <View style={{ flex: 1, marginRight: 6 }}><Field value={mDose} onChangeText={setMDose} placeholder="Dose" /></View>
          <View style={{ flex: 1 }}><Field value={mFreq} onChangeText={setMFreq} placeholder="Freq" /></View>
        </View>
        <Btn label="Add medication" variant="outline" icon="add" onPress={addMed} />
        {meds.map((m, i) => <Row key={i} icon="medkit" iconFg={C.lavender} iconBg={C.lavenderSoft} title={m.name} subtitle={[m.dose, m.frequency].filter(Boolean).join(" · ")} />)}
      </Card>

      <SectionTitle>Consent & signatures</SectionTitle>
      <Card>
        <Checkbox checked={consent} onPress={() => setConsent((v) => !v)}
          label="The patient consents to treatment and to Companio monitoring their wearable signals for safety." />
        <View style={{ height: 12 }} />
        <SignaturePad label="Patient signature" onChange={setSignedP} />
        <View style={{ height: 12 }} />
        <SignaturePad label="Therapist signature" onChange={setSignedT} />
        <Text style={[type.meta, { marginTop: 8 }]}>Signed {new Date().toLocaleDateString()}</Text>
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <Btn label="Create record" icon="person-add" onPress={save} disabled={!ready} />
      </View>
      {!ready ? (
        <Text style={[type.meta, { marginTop: 8, textAlign: "center" }]}>
          {!name.trim() ? "A full name is required."
            : !loginUsername.trim() ? "Their Companio username is required to link the account."
            : interventions.length === 0 ? "Add at least one approved intervention — Companio can only offer what you have approved, and cannot support this patient without it."
            : !consent ? "Patient consent is required."
            : "Your signature is required."}
        </Text>
      ) : null}
      <Text style={[type.meta, { marginTop: 8 }]}>Clinical data is stored under a codename (P-###). Name and identity stay separate.</Text>
    </Screen>
  );
}

function FreeEntryList({ items, setItems, placeholder, addLabel }) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (items.some((x) => x.toLowerCase() === value.toLowerCase())) return;
    setItems((prev) => [...prev, value]);
    setDraft("");
  }

  function remove(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <View>
      <Field
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={add}
        returnKeyType="done"
        blurOnSubmit={false}
        placeholder={placeholder}
      />
      <Btn label={addLabel} icon="add" onPress={add} disabled={!draft.trim()} />
      {items.map((item, index) => (
        <View key={`${item}-${index}`} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: index === items.length - 1 ? 0 : 1, borderBottomColor: C.border }}>
          <Ionicons name="checkmark-circle-outline" size={19} color={C.primary} />
          <Text style={[type.body, { flex: 1, marginLeft: 9 }]}>{item}</Text>
          <TouchableOpacity onPress={() => remove(index)} accessibilityLabel={`Remove ${item}`} style={{ padding: 8 }}>
            <Ionicons name="trash-outline" size={18} color={C.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const multiline = { minHeight: 80, textAlignVertical: "top" };

function Checkbox({ checked, onPress, label }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{ flexDirection: "row", alignItems: "flex-start" }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: checked ? C.primary : C.border, backgroundColor: checked ? C.primary : "transparent", alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1 }}>
        {checked ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function AddEvent({ navigation }) {
  const { patients, addEvent } = useApp();
  const [patientId, setPatientId] = useState(patients[0]?.id || null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [typeStr, setTypeStr] = useState("Individual Therapy");
  const [mode, setMode] = useState("In Person");

  function save() {
    if (!patientId || !date.trim() || !time.trim()) return;
    const p = patients.find((x) => x.id === patientId);
    addEvent({ patientId, name: p?.name || "Patient", date: date.trim(), time: time.trim(), type: typeStr, mode });
    navigation.goBack();
  }

  if (patients.length === 0) {
    return (
      <Screen>
        <AppHeader title="New event" onBack={() => navigation.goBack()} />
        <EmptyState icon="people" title="No patients yet" sub="Add a patient before scheduling a session." />
        <View style={{ marginTop: spacing.md }}><Btn label="Add patient" icon="person-add" onPress={() => navigation.replace("AddPatient")} /></View>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title="New event" subtitle="Schedule a session" onBack={() => navigation.goBack()} />
      <SectionTitle>Patient</SectionTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {patients.map((p) => <Chip key={p.id} label={p.name} active={patientId === p.id} onPress={() => setPatientId(p.id)} />)}
      </View>
      <Card>
        <SectionTitle>Date</SectionTitle>
        <Field value={date} onChangeText={setDate} placeholder="e.g. May 28, 2024" />
        <SectionTitle>Time</SectionTitle>
        <Field value={time} onChangeText={setTime} placeholder="e.g. 10:00 AM" />
        <SectionTitle>Type</SectionTitle>
        <Field value={typeStr} onChangeText={setTypeStr} placeholder="e.g. Individual Therapy" />
        <SectionTitle>Mode</SectionTitle>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {["In Person", "Video", "Phone"].map((m) => <Chip key={m} label={m} active={mode === m} onPress={() => setMode(m)} />)}
        </View>
      </Card>
      <View style={{ marginTop: spacing.lg }}>
        <Btn label="Add to calendar" icon="calendar" onPress={save} disabled={!date.trim() || !time.trim()} />
      </View>
    </Screen>
  );
}

const Field = ({ style, ...props }) => (
  <TextInput {...props} placeholderTextColor={C.textMuted}
    style={[{ backgroundColor: C.background, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.textPrimary, marginBottom: 6 }, style]} />
);
