// Patient workspace: overview, plan, rules, notes, media.
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, Switch, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { colors as C, spacing, radius, type, type as type_, riskColor } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, RiskBadge, Pill, ProgressBar, IconChip, Btn, Chip, EmptyState, Disclaimer, DecisionSourceBadge, StatTile } from "../components/ui";
import { ResourceEditor } from "../components/resource_editor";
import { asResourceList } from "../components/resource_player";
import { TrendChart, Sparkline, DayChart } from "../components/charts";
import { Avatar } from "./therapist";
import { useApp } from "../state/AppContext";
import { saveNote, updateNote, deleteNote, saveTherapistRule, updateClinicalProfile, updateTherapistRule, deleteTherapistRule, getMediaViewUrl, getSessions, getDecisions } from "../services/engine";

const PLAN_FIELD_TO_AWS = {
  approvedInterventions: "approved_interventions",
  knownTriggers: "known_triggers",
  forbiddenInterventions: "forbidden_interventions",
  communicationPreferences: "communication_preferences",
  clinicalGuidance: "clinical_guidance",
};

export const WorkspaceContext = createContext(null);
export const useWid = () => useContext(WorkspaceContext);

function Head({ p, onBack }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.md }}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} accessibilityLabel="Back" style={{ marginRight: spacing.sm, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: C.surfaceAlt }}>
          <Ionicons name="chevron-back" size={20} color={C.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <Avatar name={p.name} color={p.avatar} size={48} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={type.h2}>{p.name}</Text>
        <Text style={type.sub}>{p.displayId} · {p.age}{p.gender !== "—" ? `, ${p.gender}` : ""} · {p.status}</Text>
      </View>
      <RiskBadge level={p.risk.level} />
    </View>
  );
}

export function WsOverview({ navigation }) {
  const { patient, events } = useApp();
  const patientId = useWid();
  const p = patient(patientId);

  const [sessions, setSessions] = useState(null);
  const [decisions, setDecisions] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getSessions(patientId).catch(() => null),
      getDecisions(patientId).catch(() => null),
    ]).then(([s2, d]) => {
      if (!alive) return;
      setSessions(s2?.sessions || []);
      setDecisions(d?.decisions || []);
    });
    return () => { alive = false; };
  }, [patientId]);

  const today = new Date().toDateString();
  const isToday = (x) => x?.created_at && new Date(x.created_at).toDateString() === today;

  const supportToday = (sessions || []).filter((x) =>
    isToday(x) && ["trigger_event", "voice_transcription"].includes(x.type)).length;

  const snapshot = [...(sessions || [])]
    .filter((x) => x.type === "daily_snapshot")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;

  const unresolved = (decisions || [])
    .filter((d) => d.escalation_required || d.patient_reported_helped === false)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0] || null;

  const meds = p?.medications || [];
  const takenToday = meds.filter((m) => (m.takenDates || []).includes(today)).length;
  const nextAppt = events.filter((e) => e.patientId === patientId)[0] || null;

  const lastMsg = [...(sessions || [])]
    .filter((x) => x.type === "message" && x.sender_role === "patient")
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;

  const Tile = ({ label, value, sub, tint }) => (
    <View style={{ width: "31.5%" }}>
      <Card style={{ marginTop: 0 }}>
        <Text style={type.meta}>{label}</Text>
        <Text style={[type.title, { fontSize: 15, marginTop: 4, color: tint || C.textPrimary }]}>{value}</Text>
        {sub ? <Text style={[type.meta, { marginTop: 2 }]}>{sub}</Text> : null}
      </Card>
    </View>
  );

  const rc = riskColor(snapshot?.risk_level || p?.risk?.level);

  return (
    <Screen>
      <Head p={p} onBack={() => navigation.goBack()} />

      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md }}>
        <Tile label="CURRENT" value={rc.label} tint={rc.fg}
          sub={snapshot?.created_at ? "last reading" : "no readings"} />
        <Tile label="TODAY" value={`${supportToday}`} sub={supportToday === 1 ? "support event" : "support events"} />
        <Tile label="NEXT SESSION" value={nextAppt ? nextAppt.date : "—"} sub={nextAppt ? nextAppt.time : "not scheduled"} />
      </View>

      {unresolved ? (
        <>
          <SectionTitle>Needs attention</SectionTitle>
          <Card accent={C.danger}
            onPress={() => navigation.navigate("EventDetail", { patientId, episodeId: unresolved.episode_id })}>
            <Row icon="alert-circle" iconFg={C.danger} iconBg={C.dangerSoft}
              title={unresolved.escalation_required ? "Support escalated" : "Support did not help"}
              subtitle={[unresolved.selected_action, unresolved.decision_source].filter(Boolean).join(" · ")} />
            <Text style={[type.meta, { marginTop: 6 }]}>
              {unresolved.timestamp ? new Date(unresolved.timestamp).toLocaleString() : ""}
            </Text>
            <Btn label="Review event" icon="pulse"
              onPress={() => navigation.navigate("EventDetail", { patientId, episodeId: unresolved.episode_id })} />
          </Card>
        </>
      ) : null}

      <SectionTitle sub="From the patient's watch and phone.">Physiology today</SectionTitle>
      {snapshot ? (
        <Card onPress={() => navigation.navigate("RiskSignals", { patientId })}>
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <StatTile label="HEART RATE" icon="heart" tint={C.danger} value={snapshot.hr ?? "—"} unit="bpm" />
            <StatTile label="HRV" icon="pulse" tint={C.primary} value={snapshot.hrv ?? "—"} unit="ms" />
          </View>
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
            <StatTile label="SLEEP" icon="moon" tint={C.lavender} value={snapshot.sleep_hours_last_night ?? "—"} unit="hrs" />
            <StatTile label="STEPS" icon="footsteps" tint={C.teal} value={snapshot.steps ?? "—"} unit="today" />
          </View>
          <Text style={[type.meta, { marginTop: 10 }]}>Tap for the full signal summary →</Text>
        </Card>
      ) : (
        <Card><EmptyState icon="watch" title="No readings yet"
          sub="Physiology appears once the patient has connected a watch and monitoring has run." /></Card>
      )}

      <SectionTitle>Care</SectionTitle>
      <Card>
        <Row icon="medkit" iconFg={C.danger} iconBg={C.dangerSoft}
          title="Medication adherence"
          subtitle={meds.length ? `${takenToday} of ${meds.length} taken today` : "No medications assigned"} />
        <Row icon="calendar" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
          title="Upcoming appointment"
          subtitle={nextAppt ? `${nextAppt.date} · ${nextAppt.time}` : "Not scheduled"} />
        <Row icon="chatbubbles" iconFg={C.primary} iconBg={C.primarySoft}
          title="Last patient message"
          subtitle={lastMsg?.created_at ? new Date(lastMsg.created_at).toLocaleString() : "None yet"} />
      </Card>

      <Disclaimer />
    </Screen>
  );
}

export function WsSessions({ navigation }) {
  const { patient } = useApp();
  const p = patient(useWid());
  const [tab, setTab] = useState("All");
  const list = (p.sessions || []).filter((s) => tab === "All" || s.status === tab);
  return (
    <Screen>
      <Head p={p} onBack={() => navigation.goBack()} />
      <View style={{ flexDirection: "row" }}>{["All", "Upcoming", "Completed"].map((t) => <Chip key={t} label={t} active={tab === t} onPress={() => setTab(t)} />)}</View>
      {list.length ? list.map((s, i) => (
        <Card key={i}><Row icon={s.mode === "Video" ? "videocam" : "person"} title={`${s.date} · ${s.time}`} subtitle={`${s.type} · ${s.duration} · ${s.mode}`}
          right={<Pill text={s.status} fg={s.status === "Upcoming" ? C.primary : C.success} bg={s.status === "Upcoming" ? C.primarySoft : C.successSoft} />} /></Card>
      )) : <EmptyState icon="calendar" title="No sessions" />}
    </Screen>
  );
}

export function WsProgress({ navigation }) {
  const { patient } = useApp();
  const p = patient(useWid());

  // A patient added through the app has none of the demo trend fields, so every
  // one of these has to survive being absent rather than assuming a shape.
  const mood = p?.trends?.mood || [];
  const physio = p?.trends?.physio || [];
  const assessments = p?.assessments || [];
  const progress = Number.isFinite(p?.progress) ? p.progress : null;

  if (!p) {
    return (
      <Screen>
        <AppHeader title="Progress" onBack={() => navigation.goBack()} />
        <EmptyState icon="person" title="Patient not found"
          sub="This record could not be loaded. Go back and open the patient again." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Head p={p} onBack={() => navigation.goBack()} />

      {progress != null ? (
        <Card>
          <Row title="Overall progress" right={`${progress}%`} />
          <ProgressBar value={progress} />
        </Card>
      ) : null}

      {mood.length ? (
        <>
          <Card>
            <TrendChart label="Mood trend" data={mood} color={C.teal}
              avg={(mood.reduce((a, b) => a + b, 0) / mood.length).toFixed(1)} />
          </Card>
          {physio.length ? (
            <Card><TrendChart label="Physiological trend" data={physio} color={C.primary} /></Card>
          ) : null}
        </>
      ) : (
        <Card>
          <Text style={type.sub}>
            No trend data yet. Trends build up from recorded sessions once the patient's
            watch is connected and they have used Companio a few times.
          </Text>
        </Card>
      )}

      <SectionTitle>Assessment scores</SectionTitle>
      {assessments.length ? assessments.map((a, i) => (
        <Card key={i}>
          <Row icon="clipboard" title={a.name} subtitle="Assessment record · not AI-derived"
            right={<Pill text={`${a.score} · ${a.band}`} fg={C.textSecondary} bg="#EEF1F6" />} />
        </Card>
      )) : <EmptyState icon="clipboard" title="No assessments"
             sub="Assessment scores are entered by you, not derived by Companio." />}

      <Disclaimer />
    </Screen>
  );
}

export function WsNotes({ navigation }) {
  const { patient, addNote, updatePatient } = useApp();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const p = patient(useWid());
  const [tab, setTab] = useState("All");
  const [text, setText] = useState("");
  const list = (p.notes || []).filter((n) => tab === "All" || (tab === "Clinical" ? n.type.includes("Clinical") : !n.type.includes("Clinical")));
  return (
    <Screen>
      <Head p={p} onBack={() => navigation.goBack()} />
      <View style={{ flexDirection: "row" }}>{["All", "Clinical", "Patient"].map((t) => <Chip key={t} label={t} active={tab === t} onPress={() => setTab(t)} />)}</View>
      <Card>
        <TextInput value={text} onChangeText={setText} placeholder="Add a clinical note..." placeholderTextColor={C.textMuted} multiline
          style={{ backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 12, minHeight: 60, color: C.textPrimary, textAlignVertical: "top" }} />
        <Btn label="Add note" icon="add" onPress={() => {
          if (!text.trim()) return;
          const note = { date: new Date().toLocaleDateString(), time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), type: "Clinical Note", text: text.trim(), tags: ["New"] };
          addNote(p.id, note);
          saveNote({ patient_id: p.id, ...note }).catch((e) => console.warn("Note saved locally but AWS save failed:", e));
          setText("");
        }} />
      </Card>
      {list.length ? list.map((n, i) => (
        <Card key={n.note_id || i}>
          <Text style={type.meta}>{n.date} · {n.time} · {n.type}</Text>
          {editingId === (n.note_id || i) ? (
            <>
              <TextInput value={editText} onChangeText={setEditText} multiline
                style={{ backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 12, minHeight: 70, marginTop: 8, color: C.textPrimary, textAlignVertical: "top" }} />
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Btn label="Save" icon="checkmark" onPress={() => {
                    const text = editText.trim();
                    if (!text) return;
                    updatePatient(p.id, (pp) => ({
                      ...pp,
                      notes: (pp.notes || []).map((x, xi) => ((x.note_id || xi) === (n.note_id || i) ? { ...x, text } : x)),
                    }));
                    if (n.note_id) updateNote(n.note_id, { text }).catch((e) => console.warn("Note edited locally but AWS save failed:", e));
                    setEditingId(null);
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Btn label="Cancel" variant="outline" color={C.textSecondary} onPress={() => setEditingId(null)} />
                </View>
              </View>
            </>
          ) : (
            <Text style={[type.body, { marginTop: 6 }]}>{n.text}</Text>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            {(n.tags || []).map((t) => <View key={t} style={{ marginRight: 6 }}><Pill text={t} fg={C.teal} bg={C.tealSoft} /></View>)}
            <View style={{ flex: 1 }} />
            {editingId !== (n.note_id || i) ? (
              <>
                <TouchableOpacity onPress={() => { setEditingId(n.note_id || i); setEditText(n.text || ""); }} hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="create-outline" size={19} color={C.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert("Delete this note?", "This removes it from the patient's clinical record.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => {
                        updatePatient(p.id, (pp) => ({ ...pp, notes: (pp.notes || []).filter((x, xi) => (x.note_id || xi) !== (n.note_id || i)) }));
                        if (n.note_id) deleteNote(n.note_id).catch((e) => console.warn("Note removed locally but AWS delete failed:", e));
                      } },
                  ])}
                  hitSlop={8} style={{ padding: 6 }}>
                  <Ionicons name="trash-outline" size={19} color={C.danger} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </Card>
      )) : <EmptyState icon="document-text" title="No notes yet" />}
    </Screen>
  );
}

export function WsMore({ navigation }) {
  const { patient } = useApp();
  const p = patient(useWid());
  const items = [
    ["Clinical overview", "analytics", "ClinicalOverview"],
    ["Today's summary", "today", "PatientDay"],
    ["Session Logs", "document-text", "SessionLogs"],
    ["Trigger Events", "alert-circle", "TriggerEvents"],
    ["Medications", "medkit", "Medications"],
    ["Treatment Plan", "clipboard", "TreatmentPlan"],
    ["Risk & Signals", "pulse", "RiskSignals"],
    ["Documents", "folder", "Documents"],
    ["Assignments", "list", "Assignments"],
    ["Safety & Rules", "shield-checkmark", "SafetyRules"],
    ["Audit History", "time", "Audit"],
    ["How it decided", "flash", "DecisionInspector"],
  ];
  return (
    <Screen>
      <Head p={p} onBack={() => navigation.goBack()} />
      {items.map(([l, ic, dest]) => (
        <Card key={l} onPress={() => navigation.navigate(dest, { patientId: p.id })}>
          <Row icon={ic} title={l} right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
        </Card>
      ))}
    </Screen>
  );
}

export function TreatmentPlan({ route, navigation }) {
  const { patient, updateTreatmentPlanList, loadPatientDetail } = useApp();
  const p = patient(route.params.patientId);
  const tp = p.treatmentPlan || {};
  // Hydrate from the server on open: this screen is reachable from routes
  // that never fetched the clinical profile, and must show what AWS holds.
  useEffect(() => { loadPatientDetail?.(route.params.patientId); }, [route.params.patientId]);
  const [guidance, setGuidance] = useState(tp.clinicalGuidance || "");
  const [savingGuidance, setSavingGuidance] = useState(false);

  const sections = [
    { title: "Approved interventions", field: "approvedInterventions", icon: "checkmark-circle", fg: C.success, bg: C.successSoft, placeholder: "e.g. paced breathing", empty: "None set" },
    { title: "Known triggers", field: "knownTriggers", icon: "alert-circle", fg: C.warning, bg: C.warningSoft, placeholder: "e.g. crowded spaces", empty: "None recorded" },
    { title: "Forbidden interventions", field: "forbiddenInterventions", icon: "close-circle", fg: C.danger, bg: C.dangerSoft, placeholder: "e.g. flashing-light exercise", empty: "None recorded" },
    { title: "Communication preferences", field: "communicationPreferences", icon: "chatbubble", fg: C.primary, bg: C.primarySoft, placeholder: "e.g. short written prompts", empty: "None set" },
  ];

  return (
    <Screen>
      <AppHeader title="Treatment plan" subtitle={`${p.name} · therapist-controlled`} onBack={() => navigation.goBack()} />
      <Text style={[type.sub, { marginBottom: 4 }]}>Edit the patient-specific care boundaries used by the decision engine. Changes save immediately and sync to the patient's AWS clinical profile.</Text>
      <SectionTitle sub="Anything that doesn't fit a list. Written in your words, and read by the engine as context for this patient.">
        Clinical guidance
      </SectionTitle>
      <Card>
        <TextInput
          value={guidance}
          onChangeText={setGuidance}
          multiline
          placeholder="e.g. Responds badly to breathing instructions during a flashback — orient to the room first. Prefers short sentences. Never mention the accident directly."
          placeholderTextColor={C.textMuted}
          style={{ backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 12, minHeight: 120, color: C.textPrimary, textAlignVertical: "top" }}
        />
        <Btn label={savingGuidance ? "Saving…" : "Save guidance"} icon="save"
          disabled={savingGuidance || guidance === (tp.clinicalGuidance || "")}
          onPress={async () => {
            setSavingGuidance(true);
            try {
              updateTreatmentPlanList(p.id, "clinicalGuidance", guidance);
              await updateClinicalProfile(p.id, { clinical_guidance: guidance });
            } catch (e) {
              console.warn("Guidance saved locally but AWS save failed:", e);
            } finally {
              setSavingGuidance(false);
            }
          }} />
        <Text style={[type.meta, { marginTop: 8, letterSpacing: 0 }]}>
          Passed to the reasoner alongside the lists below. Your explicit rules still outrank it.
        </Text>
      </Card>

      {sections.map((cfg) => (
        <EditablePlanSection
          key={cfg.field}
          patientId={p.id}
          items={tp[cfg.field] || []}
          onSave={(patientId, field, items) => {
            updateTreatmentPlanList(patientId, field, items);
            const awsField = PLAN_FIELD_TO_AWS[field];
            if (awsField) {
              updateClinicalProfile(patientId, { [awsField]: items }).catch((e) => {
                console.warn("Treatment plan AWS save failed:", e);
                Alert.alert(
                  "Not saved to the patient's record",
                  `"${cfg.title}" was updated on this screen but could NOT be saved to ${patientId}'s record, so Companio will not use it yet.\n\n${String(e?.message || e)}\n\nCheck your connection and add it again.`,
                );
              });
            }
          }}
          resources={tp.interventionResources || {}}
          onSaveResource={cfg.field === "approvedInterventions" ? (pid, item, value, removeAt) => {
            const next = { ...(tp.interventionResources || {}) };
            const current = asResourceList(next[item]);
            if (value) next[item] = [...current, value];
            else if (removeAt != null) {
              const kept = current.filter((_, i) => i !== removeAt);
              if (kept.length) next[item] = kept; else delete next[item];
            } else delete next[item];
            updateTreatmentPlanList(pid, "interventionResources", next);
            updateClinicalProfile(pid, { intervention_resources: next }).catch((e) => {
              Alert.alert("Link not saved",
                `The link could not be saved to ${pid}'s record, so the patient will not see it.\n\n${String(e?.message || e)}`);
            });
          } : undefined}
          {...cfg}
        />
      ))}
      <ConditionalBans
        patientId={p.id}
        items={tp.conditionalForbidden || []}
        approved={tp.approvedInterventions || []}
        onSave={(pid, next) => {
          updateTreatmentPlanList(pid, "conditionalForbidden", next);
          updateClinicalProfile(pid, { conditional_forbidden: next }).catch((e) => {
            Alert.alert("Limit not saved",
              `This situational limit could not be saved to ${pid}'s record, so Companio will not apply it yet.\n\n${String(e?.message || e)}`);
          });
        }} />

      <Disclaimer text="Forbidden interventions are never offered. Situational limits are withheld only when the condition you set actually holds." />
    </Screen>
  );
}


// Situational bans: allowed normally, withheld only when a condition holds.
//
// A blanket ban is blunt. Most contraindications are situational -- a countdown
// may suit this patient except when they are already very distressed. Forcing a
// choice between "always" and "never" pushes a clinician toward banning
// outright, removing a technique that would have helped most of the time.
function ConditionalBans({ patientId, items, approved, onSave }) {
  const [action, setAction] = useState("");
  const [type, setType] = useState("risk_at_least");
  const [value, setValue] = useState("high");
  const [reason, setReason] = useState("");

  const TYPES = [
    { id: "risk_at_least", label: "When distress is at least", values: ["elevated", "high", "critical"] },
    { id: "trigger_present", label: "When this trigger is present", values: null },
    { id: "context_declared", label: "When the patient has said", values: ["exercise", "caffeine", "horror", "exam", "travel", "illness", "poor_sleep", "crowd"] },
    { id: "after_failed", label: "After this has already failed", values: null },
  ];
  const current = TYPES.find((t) => t.id === type);

  const add = () => {
    if (!action.trim() || !String(value).trim()) return;
    onSave(patientId, [...(items || []), {
      action: action.trim(),
      condition_type: type,
      value: String(value).trim(),
      reason: reason.trim() || null,
    }]);
    setAction(""); setReason("");
  };

  return (
    <>
      <SectionTitle sub="Allowed normally, withheld only in the situation you describe.">
        Situational limits
      </SectionTitle>

      {(items || []).map((b, i) => (
        <Card key={`${b.action}-${i}`}>
          <Row icon="alert-circle" iconFg={C.warning} iconBg={C.warningSoft}
            title={`Don't use: ${b.action}`}
            subtitle={`${TYPES.find((t) => t.id === b.condition_type)?.label || b.condition_type} ${b.value}`}
            right={
              <TouchableOpacity onPress={() => onSave(patientId, items.filter((_, x) => x !== i))}
                style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            } />
          {b.reason ? <Text style={[type_.meta, { marginTop: 4 }]}>{b.reason}</Text> : null}
        </Card>
      ))}

      <Card>
        <Text style={type_.meta}>INTERVENTION</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginBottom: 8 }}>
          {(approved || []).map((a) => (
            <Chip key={a} label={a} active={action === a} onPress={() => setAction(a)} />
          ))}
        </View>

        <Text style={type_.meta}>WHEN</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginBottom: 8 }}>
          {TYPES.map((t) => (
            <Chip key={t.id} label={t.label} active={type === t.id}
              onPress={() => { setType(t.id); setValue(t.values ? t.values[0] : ""); }} />
          ))}
        </View>

        {current?.values ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>
            {current.values.map((v) => (
              <Chip key={v} label={v} active={value === v} onPress={() => setValue(v)} />
            ))}
          </View>
        ) : (
          <TextInput value={value} onChangeText={setValue}
            placeholder={type === "trigger_present" ? "e.g. trash bag" : "e.g. box breathing"}
            placeholderTextColor={C.textMuted} style={[wsInput, { marginBottom: 8 }]} />
        )}

        <TextInput value={reason} onChangeText={setReason}
          placeholder="Why (optional) — shown to you, never to the patient"
          placeholderTextColor={C.textMuted} style={[wsInput, { marginBottom: 10 }]} />

        <Btn label="Add limit" icon="add" disabled={!action.trim() || !String(value).trim()} onPress={add} />
      </Card>
    </>
  );
}

function EditablePlanSection({ patientId, title, field, items, icon, fg, bg, placeholder, empty, onSave,
                              resources = {}, onSaveResource }) {
  const [draft, setDraft] = useState("");
  const [linking, setLinking] = useState(null);
  const [linkDraft, setLinkDraft] = useState("");

  function describeResource(r) {
  if (!r) return "";
  if (r.kind === "voice") return `Your recorded voice${r.seconds ? ` · ${r.seconds}s` : ""}`;
  if (r.kind === "audio") return "Audio file";
  if (r.kind === "image") return "Image";
  if (r.kind === "phone") return `Calls ${r.phone}`;
  if (r.kind === "note") return `Note: ${r.text}`;
  return `Opens: ${r.url || ""}`;
}

const validUrl = (u) => /^https?:\/\/\S+\.\S+/i.test((u || "").trim());
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (items.some((x) => x.toLowerCase() === value.toLowerCase())) {
      Alert.alert("Already added", `“${value}” is already in ${title.toLowerCase()}.`);
      return;
    }
    onSave(patientId, field, [...items, value]);
    setDraft("");
  };
  const remove = (index) => Alert.alert(
    "Remove item?",
    `Remove “${items[index]}” from ${title.toLowerCase()}?`,
    [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => onSave(patientId, field, items.filter((_, i) => i !== index)) }]
  );
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          accessibilityLabel={`Add ${title}`}
          style={[wsInput, { flex: 1, marginBottom: 0, marginRight: 8 }]}
        />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add to ${title}`} onPress={add} disabled={!draft.trim()} style={{ minWidth: 76, height: 46, paddingHorizontal: 14, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: draft.trim() ? C.primary : C.surfaceStrong }}>
          <Ionicons name="add" size={19} color={draft.trim() ? "#fff" : C.textMuted} />
          <Text style={{ marginLeft: 4, fontWeight: "700", color: draft.trim() ? "#fff" : C.textMuted }}>Add</Text>
        </TouchableOpacity>
      </View>
      {items.length ? items.map((x, i) => (
        <View key={`${field}-${x}-${i}`} style={{ paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <IconChip icon={icon} fg={fg} bg={bg} size={36} />
            <Text style={[type.body, { flex: 1, marginLeft: 11, color: C.textPrimary }]}>{x}</Text>
            {onSaveResource ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Attach a link to ${x}`}
                onPress={() => setLinking(linking === x ? null : x)}
                style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={asResourceList(resources[x]).length ? "attach" : "attach-outline"}
                  size={19}
                  color={asResourceList(resources[x]).length ? C.primary : C.textMuted} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${x}`} onPress={() => remove(i)} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="close" size={20} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          {asResourceList(resources[x]).length && linking !== x ? (
            <Text style={[type.meta, { marginLeft: 47, marginTop: 4 }]} numberOfLines={1}>
              {asResourceList(resources[x]).map(describeResource).join("  ·  ")}
            </Text>
          ) : null}

          {linking === x ? (
            <View style={{ marginLeft: 47 }}>
              <ResourceEditor patientId={patientId} intervention={x}
                existing={null}
                onSave={(res) => { onSaveResource(patientId, x, res); setLinking(null); }}
                onCancel={() => setLinking(null)} />
              {asResourceList(resources[x]).map((r, ri) => (
                <View key={ri} style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
                  <Text style={[type.sub, { flex: 1 }]} numberOfLines={1}>{describeResource(r)}</Text>
                  <TouchableOpacity onPress={() => onSaveResource(patientId, x, null, ri)}
                    style={{ padding: 8 }}>
                    <Ionicons name="trash" size={17} color={C.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      )) : <Text style={[type.sub, { paddingVertical: 14 }]}>{empty}</Text>}
    </>
  );
}

export function RiskSignals({ route, navigation }) {
  const { patient } = useApp();
  const patientId = route.params.patientId;
  const p = patient(patientId);

  const [snaps, setSnaps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSessions(patientId)
      .then((r) => {
        if (cancelled) return;
        setSnaps((r?.sessions || [])
          .filter((x) => x.type === "daily_snapshot")
          .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)));
      })
      .catch(() => { if (!cancelled) setSnaps([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  const latest = (snaps || []).length ? snaps[snaps.length - 1] : null;
  const series = (key) => (snaps || []).filter((x) => x[key] != null).map((x) => Number(x[key]));

  const sig = latest ? [
    { icon: "heart", label: "Heart rate", value: latest.hr != null ? `${latest.hr} bpm` : "—", fg: C.danger, bg: C.dangerSoft, spark: series("hr") },
    { icon: "heart-half", label: "Resting heart rate", value: latest.resting_hr != null ? `${latest.resting_hr} bpm` : "—", fg: C.danger, bg: C.dangerSoft, spark: series("resting_hr") },
    { icon: "pulse", label: "HRV (SDNN)", value: latest.hrv != null ? `${latest.hrv} ms` : "—", fg: C.lavender, bg: C.lavenderSoft, spark: series("hrv") },
    { icon: "moon", label: "Sleep last night", value: latest.sleep_hours_last_night != null ? `${latest.sleep_hours_last_night} hrs` : "—", fg: C.lavender, bg: C.lavenderSoft, spark: series("sleep_hours_last_night") },
    { icon: "footsteps", label: "Steps", value: latest.steps != null ? `${latest.steps}` : "—", fg: C.teal, bg: C.tealSoft, spark: series("steps") },
    { icon: "flame", label: "Active energy", value: latest.active_energy != null ? `${latest.active_energy} kcal` : "—", fg: C.warning, bg: C.warningSoft, spark: series("active_energy") },
  ] : [];

  const summary = [];
  if (latest) {
    if (latest.hr != null && latest.resting_hr != null) {
      const rise = ((latest.hr - latest.resting_hr) / latest.resting_hr) * 100;
      summary.push([
        `Heart rate ${rise >= 0 ? "+" : ""}${Math.round(rise)}% vs their resting rate`,
        rise >= 40 ? "High" : rise >= 15 ? "Moderate" : "Low",
      ]);
    }
    if (latest.hrv != null) {
      summary.push([`HRV ${latest.hrv} ms`, latest.hrv < 20 ? "High" : latest.hrv < 35 ? "Moderate" : "Low"]);
    }
    if (latest.sleep_hours_last_night != null) {
      const h = latest.sleep_hours_last_night;
      summary.push([`Slept ${h} hours`, h < 5 ? "High" : h < 6.5 ? "Moderate" : "Low"]);
    }
    if (latest.caffeine_mg != null && latest.caffeine_mg > 0) {
      summary.push([`${latest.caffeine_mg} mg caffeine`, latest.caffeine_mg >= 300 ? "Moderate" : "Low"]);
    }
    if (latest.recent_workout_minutes_ago != null) {
      summary.push([`Workout ${latest.recent_workout_minutes_ago} min before this reading`, "Low"]);
    }
  }

  const pct = latest?.risk_score != null ? Math.round(Number(latest.risk_score) * 100) : null;
  const level = latest?.risk_level || p?.risk?.level || "unknown";

  return (
    <Screen>
      <AppHeader title="Risk & signals" subtitle={p?.name} onBack={() => navigation.goBack()} />
      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 12 }} /> : null}

      {!loading && !latest ? (
        <Card>
          <EmptyState icon="watch" title="No physiological data recorded yet"
            sub="Readings appear here once the patient has connected a watch and monitoring has run." />
        </Card>
      ) : null}

      {latest ? (
        <>
          <Card accent={level === "high" ? C.danger : level === "elevated" ? C.warning : C.success}>
            <Text style={type.meta}>PHYSIOLOGICAL DISTRESS AT LAST READING</Text>
            {pct != null ? (
              <Text style={{ fontSize: 40, fontWeight: "800", color: C.textPrimary }}>
                {pct}<Text style={{ fontSize: 18, color: C.textMuted }}> / 100</Text>
              </Text>
            ) : (
              <Text style={[type.sub, { marginTop: 6 }]}>
                No score was recorded with this reading.
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
              <RiskBadge level={level} />
              {latest.recorded_at || latest.created_at ? (
                <Text style={[type.sub, { marginLeft: 8 }]}>
                  {`· ${new Date(latest.recorded_at || latest.created_at).toLocaleString()}`}
                </Text>
              ) : null}
            </View>
            {latest.risk_source ? (
              <Text style={[type.meta, { marginTop: 8 }]}>
                {latest.risk_source === "trained_model"
                  ? `Scored by the trained model${latest.risk_model ? ` (${latest.risk_model})` : ""}.`
                  : "Scored by the heart-rate comparison — the trained model was unavailable."}
              </Text>
            ) : null}
            <Text style={[type.meta, { marginTop: 6 }]}>Physiological distress estimate; not a PTSD diagnosis.</Text>
          </Card>

          <SectionTitle sub="Read from Apple Health on the patient's device.">Recorded signals</SectionTitle>
          {sig.map((x) => (
            <Card key={x.label}>
              <Row icon={x.icon} iconFg={x.fg} iconBg={x.bg} title={x.label}
                right={<Text style={{ fontWeight: "700", color: C.textPrimary }}>{x.value}</Text>} />
              {x.spark && x.spark.length > 1 ? (
                <View style={{ marginTop: 8 }}><Sparkline data={x.spark} color={x.fg} /></View>
              ) : null}
            </Card>
          ))}

          {(latest.hourly_steps || []).length ? (
            <>
              <SectionTitle sub="When they moved, across the day.">Movement</SectionTitle>
              <Card><DayChart data={latest.hourly_steps} color={C.primary} /></Card>
            </>
          ) : null}

          <SectionTitle sub="Derived from the readings above. Thresholds shown so you can judge them yourself.">
            Signal summary
          </SectionTitle>
          {summary.length === 0 ? (
            <Card><Row title="Nothing notable in the latest reading" /></Card>
          ) : summary.map(([label, lvl]) => (
            <Card key={label}>
              <Row title={label} right={
                <Pill text={lvl}
                  fg={lvl === "High" ? C.danger : lvl === "Moderate" ? C.warning : C.success}
                  bg={lvl === "High" ? C.dangerSoft : lvl === "Moderate" ? C.warningSoft : C.successSoft} />
              } />
            </Card>
          ))}

          <Card>
            <Row icon="information-circle" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
              title="Not measured by this hardware"
              subtitle="Skin conductance (EDA) and skin temperature are not available from Apple Watch. The trained 16-feature model needs them, which is why live scoring uses the Watch-compatible model instead." />
          </Card>
        </>
      ) : null}
      <Disclaimer />
    </Screen>
  );
}

export function Documents({ route, navigation }) {
  const { patient, addDocument } = useApp();
  const p = patient(route.params.patientId);
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim();
    if (!n) return;
    addDocument(p.id, { name: n.toLowerCase().endsWith(".pdf") ? n : `${n}.pdf`, date: new Date().toLocaleDateString(), demo: true });
    setName("");
  };
  return (
    <Screen>
      <AppHeader title="Documents" subtitle={p.name} onBack={() => navigation.goBack()} />
      <Card>
        <Text style={type.title}>Add demo document</Text>
        <Text style={[type.sub, { marginTop: 3, marginBottom: 10 }]}>Local metadata only for now. Real file upload is intentionally left for S3/presigned URLs.</Text>
        <WsField value={name} onChangeText={setName} onSubmitEditing={add} placeholder="e.g. Updated treatment plan" />
        <Btn label="Add document record" icon="add" onPress={add} disabled={!name.trim()} />
      </Card>
      {(p.documents || []).length ? p.documents.map((d, i) => <Card key={`${d.name}-${i}`}><Row icon="document" title={d.name} subtitle={`${d.date}${d.demo ? " · local demo" : ""}`} right={<Ionicons name="document-outline" size={20} color={C.textMuted} />} /></Card>) : <EmptyState icon="folder-open" title="No documents" sub="Document storage connects here later." />}
    </Screen>
  );
}

export function Assignments({ route, navigation }) {
  const { patient, addAssignment, updateAssignment, removeAssignment } = useApp();
  const p = patient(route.params.patientId);
  const [text, setText] = useState("");
  const clr = (s) => (s === "Completed" ? [C.success, C.successSoft] : s === "In Progress" ? [C.primary, C.primarySoft] : [C.textMuted, "#EEF1F6"]);
  const cycle = (status) => status === "Not Started" ? "In Progress" : status === "In Progress" ? "Completed" : "Not Started";
  return (
    <Screen>
      <AppHeader title="Assignments" subtitle={p.name} onBack={() => navigation.goBack()} />
      <Card>
        <TextInput value={text} onChangeText={setText} onSubmitEditing={() => { if (text.trim()) { addAssignment(p.id, { title: text.trim() }); setText(""); } }} placeholder="New assignment title..." placeholderTextColor={C.textMuted}
          style={{ backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 12, color: C.textPrimary }} />
        <Btn label="Add assignment" icon="add" onPress={() => { if (text.trim()) { addAssignment(p.id, { title: text.trim() }); setText(""); } }} disabled={!text.trim()} />
      </Card>
      {(p.assignments || []).map((a, i) => { const [fg, bg] = clr(a.status); return (
        <Card key={`${a.title}-${i}`}>
          <Row icon="checkbox" iconFg={fg} iconBg={bg} title={a.title} subtitle="Tap status to advance" right={<TouchableOpacity onPress={() => updateAssignment(p.id, i, { status: cycle(a.status) })}><Pill text={a.status} fg={fg} bg={bg} /></TouchableOpacity>} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${a.title}`} onPress={() => removeAssignment(p.id, i)} style={{ alignSelf: "flex-end", marginTop: 8, padding: 8 }}><Text style={{ color: C.danger, fontWeight: "650" }}>Remove</Text></TouchableOpacity>
        </Card>
      ); })}
      {!(p.assignments || []).length ? <EmptyState icon="list" title="No assignments" /> : null}
    </Screen>
  );
}

const RULE_FIELD_TO_AWS = {
  active: "active",
  minRisk: "min_risk_level",
  triggers: "trigger_conditions",
  approvedAction: "approved_action",
  forbiddenActions: "forbidden_actions",
  aiOverride: "ai_override_allowed",
};

export function SafetyRules({ route, navigation }) {
  const { patient, updateRule } = useApp();
  const [newTrigger, setNewTrigger] = useState("");
  const [newAction, setNewAction] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState(null);
  const p = patient(route.params.patientId);
  const rule = p.rules?.[0];
  const [triggerDraft, setTriggerDraft] = useState("");
  const [forbiddenDraft, setForbiddenDraft] = useState("");
  const [actionDraft, setActionDraft] = useState(rule?.approvedAction || "");

  const persistRule = (patch) => {
    updateRule(p.id, rule.ruleId, patch);
    const awsPatch = {};
    for (const [field, value] of Object.entries(patch)) {
      const awsField = RULE_FIELD_TO_AWS[field];
      if (awsField) awsPatch[awsField] = value;
    }
    if (Object.keys(awsPatch).length) {
      updateTherapistRule(rule.ruleId, awsPatch).catch((e) => console.warn("Rule saved locally but AWS save failed:", e));
    }
  };

  const setOverride = (val) => {
    if (val) {
      Alert.alert("Allow AI override?", "This weakens the default hierarchy. The therapist rule normally always wins.",
        [{ text: "Cancel", style: "cancel" }, { text: "Allow", style: "destructive", onPress: () => persistRule({ aiOverride: true }) }]);
    } else persistRule({ aiOverride: false });
  };
  if (!rule) {
    return (
      <Screen>
        <AppHeader title="Safety & rules" subtitle={p.name} onBack={() => navigation.goBack()} />
        <Card accent={C.warning}>
          <Row icon="shield" iconFg={C.warning} iconBg={C.warningSoft}
            title="No safety rule yet"
            subtitle="Until you write one, unseen moments fall back to bounded AI reasoning and then to safe support." />
        </Card>

        <SectionTitle sub="An exact instruction that outranks every model.">Create the first rule</SectionTitle>
        <Card>
          <Text style={type.meta}>WHEN COMPANIO SEES / HEARS</Text>
          <WsField value={newTrigger} onChangeText={setNewTrigger} placeholder="e.g. crowd" />
          <Text style={[type.meta, { marginTop: 8 }]}>DO THIS</Text>
          <WsField value={newAction} onChangeText={setNewAction} placeholder="e.g. offer calm mode" />
          <Text style={[type.meta, { marginTop: 8 }]}>SAY THIS (optional)</Text>
          <WsField value={newInstructions} onChangeText={setNewInstructions} placeholder="Exact words Companio should use" />
          {createErr ? <Text style={[type.meta, { color: C.danger, marginTop: 6 }]}>{createErr}</Text> : null}
          <Btn label={creating ? "Saving…" : "Create rule"} icon="shield-checkmark"
            disabled={creating || !newTrigger.trim() || !newAction.trim()}
            onPress={async () => {
              setCreating(true); setCreateErr(null);
              try {
                await saveTherapistRule({
                  patient_id: p.id,
                  trigger: newTrigger.trim(),
                  triggers: [newTrigger.trim()],
                  intervention: newAction.trim(),
                  approved_action: newAction.trim(),
                  instructions: newInstructions.trim() || null,
                  priority: 10,
                  active: true,
                });
                setNewTrigger(""); setNewAction(""); setNewInstructions("");
                navigation.goBack();
              } catch (e) {
                setCreateErr(String(e?.message || e));
              } finally {
                setCreating(false);
              }
            }} />
          <Text style={[type.meta, { marginTop: 10, letterSpacing: 0 }]}>
            When this trigger is seen, Companio uses your instruction exactly. No model is consulted.
          </Text>
        </Card>
        <Disclaimer />
      </Screen>
    );
  }
  const addUnique = (field, value, clear) => {
    const v = value.trim(); if (!v) return;
    const current = rule[field] || [];
    if (!current.some((x) => x.toLowerCase() === v.toLowerCase())) persistRule({ [field]: [...current, v] });
    clear("");
  };
  const removeFrom = (field, index) => persistRule({ [field]: (rule[field] || []).filter((_, i) => i !== index) });
  return (
    <Screen>
      <AppHeader title="Safety & rules" subtitle={`${p.name} · therapist authority`} onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            onPress={() => Alert.alert(
              "Delete this safety rule?",
              "The engine will stop applying it immediately, and unseen moments will fall back to safe support instead.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete rule", style: "destructive", onPress: () => {
                    if (rule?.ruleId) {
                      deleteTherapistRule(rule.ruleId)
                        .then(() => navigation.goBack())
                        .catch((e) => Alert.alert("Could not delete", String(e?.message || e)));
                    }
                  } },
              ])}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.dangerSoft }}>
            <Ionicons name="trash-outline" size={20} color={C.danger} />
          </TouchableOpacity>
        } />
      <Card accent={C.primary}>
        <Row icon="shield-checkmark" title={`Rule ${rule.ruleId}`} subtitle={`Priority ${rule.priority} · v${rule.version}`} right={<Switch accessibilityLabel="Rule active" value={!!rule.active} onValueChange={(active) => persistRule({ active })} />} />
        <SectionTitle>WHEN</SectionTitle>
        <Text style={type.meta}>MINIMUM PHYSIOLOGICAL RISK</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{["baseline", "elevated", "high", "critical"].map((r) => <Chip key={r} label={r} active={(rule.minRisk || "baseline") === r} onPress={() => persistRule({ minRisk: r })} />)}</View>
        <Text style={[type.meta, { marginTop: 16 }]}>TRIGGER CONDITIONS</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 7 }}><WsField value={triggerDraft} onChangeText={setTriggerDraft} onSubmitEditing={() => addUnique("triggers", triggerDraft, setTriggerDraft)} placeholder="e.g. crowd" style={{ flex: 1, marginBottom: 0, marginRight: 8 }} /><TouchableOpacity onPress={() => addUnique("triggers", triggerDraft, setTriggerDraft)} style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" }}><Ionicons name="add" size={22} color="#fff" /></TouchableOpacity></View>
        {(rule.triggers || []).map((x, i) => <View key={`${x}-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}><Text style={[type.body, { flex: 1 }]}>{x}</Text><TouchableOpacity onPress={() => removeFrom("triggers", i)}><Ionicons name="close" size={19} color={C.textMuted} /></TouchableOpacity></View>)}

        <SectionTitle>THEN</SectionTitle>
        <Text style={type.meta}>APPROVED ACTION</Text>
        <WsField value={actionDraft} onChangeText={setActionDraft} placeholder="e.g. offer calm mode" style={{ marginTop: 7 }} />
        <Btn label="Save approved action" icon="checkmark" onPress={() => actionDraft.trim() && persistRule({ approvedAction: actionDraft.trim() })} disabled={!actionDraft.trim() || actionDraft.trim() === rule.approvedAction} />

        <SectionTitle>NEVER</SectionTitle>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 7 }}><WsField value={forbiddenDraft} onChangeText={setForbiddenDraft} onSubmitEditing={() => addUnique("forbiddenActions", forbiddenDraft, setForbiddenDraft)} placeholder="e.g. auto-alert caregiver" style={{ flex: 1, marginBottom: 0, marginRight: 8 }} /><TouchableOpacity onPress={() => addUnique("forbiddenActions", forbiddenDraft, setForbiddenDraft)} style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: C.danger, alignItems: "center", justifyContent: "center" }}><Ionicons name="add" size={22} color="#fff" /></TouchableOpacity></View>
        {(rule.forbiddenActions || []).map((x, i) => <View key={`${x}-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}><Text style={[type.body, { flex: 1 }]}>{x}</Text><TouchableOpacity onPress={() => removeFrom("forbiddenActions", i)}><Ionicons name="close" size={19} color={C.textMuted} /></TouchableOpacity></View>)}

        <SectionTitle>Authority</SectionTitle>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flex: 1, paddingRight: 12 }}><Text style={type.title}>AI override</Text><Text style={type.sub}>OFF is the safe default. AI cannot bypass a matching therapist rule.</Text></View><Switch accessibilityLabel="AI override" value={!!rule.aiOverride} onValueChange={setOverride} trackColor={{ true: C.danger }} /></View>
        <View style={{ marginTop: 10 }}><Pill text={rule.aiOverride ? "AI override: ON" : "AI override: OFF (safe default)"} fg={rule.aiOverride ? C.danger : C.success} bg={rule.aiOverride ? C.dangerSoft : C.successSoft} /></View>
        <Text style={[type.meta, { marginTop: 10 }]}>Created by {rule.createdBy || "therapist"}. Every edit increments the local rule version and creates an audit entry.</Text>
      </Card>
      <Disclaimer />
    </Screen>
  );
}
const KV = ({ k, v }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
    <Text style={type.sub}>{k}</Text><Text style={{ fontWeight: "700", color: C.textPrimary, maxWidth: "60%", textAlign: "right" }}>{v}</Text>
  </View>
);

const wsInput = { backgroundColor: C.surfaceAlt, borderRadius: radius.md, padding: 12, color: C.textPrimary, marginBottom: 8 };
const WsField = ({ style, ...props }) => <TextInput {...props} placeholderTextColor={C.textMuted} style={[wsInput, style]} />;

export function SessionLogs({ route, navigation }) {
  const { patient, addSessionLog } = useApp();
  const p = patient(route.params.patientId);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ duration: "50 min", summary: "", interventions: "", homework: "", medicationChanges: "", nextSteps: "" });
  const [risk, setRisk] = useState("low");
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  function save() {
    if (!f.summary.trim()) return;
    addSessionLog(p.id, { date: new Date().toLocaleDateString(), ...f, riskObserved: risk });
    setF({ duration: "50 min", summary: "", interventions: "", homework: "", medicationChanges: "", nextSteps: "" }); setRisk("low"); setOpen(false);
  }
  return (
    <Screen>
      <AppHeader title="Session logs" subtitle={p.name} onBack={() => navigation.goBack()}
        right={<TouchableOpacity onPress={() => setOpen((v) => !v)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" }}><Ionicons name={open ? "close" : "add"} size={22} color="#fff" /></TouchableOpacity>} />
      {open ? (
        <Card accent={C.primary}>
          <SectionTitle>New session log</SectionTitle>
          <Text style={[type.meta, { marginBottom: 4 }]}>DURATION</Text>
          <WsField value={f.duration} onChangeText={set("duration")} placeholder="e.g. 50 min" />
          <Text style={[type.meta, { marginBottom: 4 }]}>SESSION SUMMARY</Text>
          <WsField value={f.summary} onChangeText={set("summary")} placeholder="What was covered…" multiline style={{ minHeight: 70, textAlignVertical: "top" }} />
          <Text style={[type.meta, { marginBottom: 4 }]}>INTERVENTIONS USED</Text>
          <WsField value={f.interventions} onChangeText={set("interventions")} placeholder="e.g. grounding, CBT reframing" />
          <Text style={[type.meta, { marginBottom: 4 }]}>HOMEWORK ASSIGNED</Text>
          <WsField value={f.homework} onChangeText={set("homework")} placeholder="e.g. daily mood journal" />
          <Text style={[type.meta, { marginBottom: 4 }]}>MEDICATION CHANGES</Text>
          <WsField value={f.medicationChanges} onChangeText={set("medicationChanges")} placeholder="e.g. none / increased sertraline" />
          <Text style={[type.meta, { marginBottom: 4 }]}>RISK OBSERVED</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 8 }}>{["low", "elevated", "high"].map((r) => <Chip key={r} label={r} active={risk === r} onPress={() => setRisk(r)} />)}</View>
          <Text style={[type.meta, { marginBottom: 4 }]}>NEXT STEPS</Text>
          <WsField value={f.nextSteps} onChangeText={set("nextSteps")} placeholder="Plan for next session" />
          <Btn label="Save session log" icon="checkmark" onPress={save} disabled={!f.summary.trim()} />
        </Card>
      ) : null}
      {(p.sessionLogs || []).length === 0 ? <EmptyState icon="document-text" title="No session logs" sub="Tap + to log a session after you meet." /> :
        (p.sessionLogs || []).map((l) => (
          <Card key={l.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={type.title}>{l.date}</Text>
              <RiskBadge level={l.riskObserved} />
            </View>
            <Text style={[type.meta, { marginTop: 2 }]}>{l.duration}</Text>
            <Text style={[type.body, { marginTop: 8 }]}>{l.summary}</Text>
            {l.interventions ? <LogLine k="Interventions" v={l.interventions} /> : null}
            {l.homework ? <LogLine k="Homework" v={l.homework} /> : null}
            {l.medicationChanges ? <LogLine k="Medication" v={l.medicationChanges} /> : null}
            {l.nextSteps ? <LogLine k="Next steps" v={l.nextSteps} /> : null}
          </Card>
        ))}
      <Disclaimer />
    </Screen>
  );
}
const LogLine = ({ k, v }) => (
  <Text style={[type.sub, { marginTop: 6 }]}><Text style={{ fontWeight: "700", color: C.textPrimary }}>{k}: </Text>{v}</Text>
);

export function TriggerImage({ s3Key, patientId }) {
  const [url, setUrl] = useState(null);
  const [status, setStatus] = useState("idle");
  async function reveal() {
    setStatus("loading");
    try {
      const r = await getMediaViewUrl(s3Key, patientId);
      setUrl(r.url);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
    }
  }
  if (!s3Key) return null;
  if (url) return <Image source={{ uri: url }} style={{ width: "100%", height: 180, borderRadius: radius.md, marginTop: 10 }} resizeMode="cover" />;
  return (
    <View style={{ marginTop: 10 }}>
      <Btn label={status === "loading" ? "Loading…" : "View captured image"} icon="image" variant="outline" onPress={reveal} disabled={status === "loading"} />
      {status === "error" ? <Text style={[type.meta, { color: C.danger, marginTop: 4 }]}>Couldn't load the image right now.</Text> : null}
    </View>
  );
}

export function TriggerAudio({ s3Key, patientId }) {
  const [status, setStatus] = useState("idle");
  const playerRef = useRef(null);
  useEffect(() => () => { try { playerRef.current?.remove?.(); } catch {} }, []);

  async function play() {
    setStatus("loading");
    try {
      const r = await getMediaViewUrl(s3Key, patientId);
      const player = createAudioPlayer(r.url);
      playerRef.current = player;
      player.play();
      setStatus("playing");
    } catch (e) {
      setStatus("error");
    }
  }
  function stop() {
    try { playerRef.current?.pause(); } catch {}
    setStatus("idle");
  }
  if (!s3Key) return null;
  return (
    <View style={{ marginTop: 10 }}>
      {status === "playing"
        ? <Btn label="Stop audio" icon="stop" variant="outline" onPress={stop} />
        : <Btn label={status === "loading" ? "Loading…" : "Play captured audio"} icon="play" variant="outline" onPress={play} disabled={status === "loading"} />}
      {status === "error" ? <Text style={[type.meta, { color: C.danger, marginTop: 4 }]}>Couldn't load the audio right now.</Text> : null}
    </View>
  );
}

export function TriggerEvents({ route, navigation }) {
  const { patient } = useApp();
  const p = patient(route.params.patientId);
  const [awsSessions, setAwsSessions] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSessions(p.id)
      .then((r) => { if (!cancelled) setAwsSessions(r?.sessions || []); })
      .catch(() => { if (!cancelled) setAwsSessions(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [p.id]);

  const usingAws = awsSessions !== null;
  const EVENT_TYPES = new Set([
    "trigger_event", "voice_transcription", "emergency_alert",
    "call_request", "appointment_request",
  ]);
  const rawEvs = usingAws
    ? awsSessions.filter((e) => EVENT_TYPES.has(e.type)
        || (!e.type && (e.image_s3_key || e.s3_key || e.transcript || e.normalized_visual_trigger)))
    : (p.triggerEvents || []);
  const evs = [...rawEvs].sort((a, b) => {
    const urgentA = a.type === "emergency_alert" || a.type === "call_request";
    const urgentB = b.type === "emergency_alert" || b.type === "call_request";
    if (urgentA !== urgentB) return urgentA ? -1 : 1;
    return 0;
  });

  return (
    <Screen>
      <AppHeader title="Trigger events" subtitle={`${p.name} · reported by patient's device`} onBack={() => navigation.goBack()}
        right={usingAws ? <Pill text="Synced from AWS" fg={C.success} bg={C.successSoft} icon="cloud-done" /> : (!loading ? <Pill text="Local demo only" fg={C.textSecondary} bg="#EEF1F6" /> : null)} />
      <Text style={[type.meta, { marginBottom: 6 }]}>Detected by the patient's camera or voice check-in, plus any calls/alerts they've requested — saved for you to review. Physiological triggers — not diagnoses.</Text>
      {loading ? <ActivityIndicator color={C.primary} style={{ marginTop: 10 }} /> : null}
      {!loading && evs.length === 0 ? <EmptyState icon="alert-circle" title="No episodes yet" sub="When the patient's glasses detect a trigger or they record a voice check-in, it appears here." /> :
        evs.map((e, i) => {
          if (e.type === "emergency_alert" || e.type === "call_request") {
            const isEmergency = e.type === "emergency_alert";
            return (
              <Card key={e.session_id || i} accent={C.danger} style={{ backgroundColor: isEmergency ? C.dangerSoft : undefined }}>
                <Row icon={isEmergency ? "alert-circle" : "call"} iconFg={C.danger} iconBg={C.dangerSoft}
                  title={isEmergency ? "🚨 Emergency alert" : "📞 Call requested"}
                  subtitle={e.created_at}
                  right={<Pill text="Needs attention" fg={C.danger} bg="#fff" />} />
                {e.message ? <Text style={[type.sub, { marginTop: 8 }]}>{e.message}</Text> : null}
              </Card>
            );
          }
          return (
          <Card key={e.session_id || e.id || i} accent={C.warning}>
            <Row icon="alert-circle" iconFg={C.warning} iconBg={C.warningSoft}
              title={e.known_trigger === true
                ? `Known trigger: ${e.matched_trigger || e.normalized_visual_trigger}`
                : `Context: ${e.normalized_visual_trigger || e.trigger || (e.transcript ? "voice check-in" : "unknown")}`}
              subtitle={e.created_at || e.time}
              right={<Pill text={e.camera_source || e.source || (e.audio_s3_key ? "voice check-in" : "phone camera")} fg={C.textSecondary} bg="#EEF1F6" />} />
            {(e.message || e.companio_said) ? <Text style={[type.sub, { marginTop: 8 }]}>Companio responded: “{e.message || e.companio_said}”</Text> : null}
            {(e.transcript || e.patient_said) ? <Text style={[type.sub, { marginTop: 8 }]}>Patient said: “{e.transcript || e.patient_said}”</Text> : null}
            {(e.decision_source || e.decisionSource) ? <View style={{ marginTop: 8 }}><DecisionSourceBadge source={e.decision_source || e.decisionSource} /></View> : null}
            {(e.image_s3_key || e.s3_key) ? <TriggerImage s3Key={e.image_s3_key || e.s3_key} patientId={p.id} /> : null}
            {e.audio_s3_key ? <TriggerAudio s3Key={e.audio_s3_key} patientId={p.id} /> : null}
          </Card>
          );
        })}
      <Disclaimer />
    </Screen>
  );
}

export function Medications({ route, navigation }) {
  const { patient, addMedication } = useApp();
  const p = patient(route.params.patientId);
  const [name, setName] = useState(""); const [dose, setDose] = useState(""); const [freq, setFreq] = useState("");
  function add() { if (!name.trim()) return; addMedication(p.id, { name: name.trim(), dose: dose.trim(), frequency: freq.trim() }); setName(""); setDose(""); setFreq(""); }
  return (
    <Screen>
      <AppHeader title="Medications" subtitle={p.name} onBack={() => navigation.goBack()} />
      <Card>
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 2, marginRight: 6 }}><WsField value={name} onChangeText={setName} placeholder="Name" /></View>
          <View style={{ flex: 1, marginRight: 6 }}><WsField value={dose} onChangeText={setDose} placeholder="Dose" /></View>
          <View style={{ flex: 1 }}><WsField value={freq} onChangeText={setFreq} placeholder="Freq" /></View>
        </View>
        <Btn label="Add medication" icon="add" onPress={add} disabled={!name.trim()} />
      </Card>
      {(p.medications || []).length === 0 ? <EmptyState icon="medkit" title="No medications" sub="Add the patient's current medications." /> :
        (p.medications || []).map((m, i) => (
          <Card key={i}><Row icon="medkit" iconFg={C.lavender} iconBg={C.lavenderSoft} title={m.name} subtitle={[m.dose, m.frequency].filter(Boolean).join(" · ") || "—"} /></Card>
        ))}
      <Disclaimer />
    </Screen>
  );
}

export function Audit({ route, navigation }) {
  const { patient, audit } = useApp();
  const p = patient(route.params.patientId);
  const [awsDecisions, setAwsDecisions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDecisions(p.id)
      .then((r) => { if (!cancelled) setAwsDecisions(r?.decisions || []); })
      .catch(() => { if (!cancelled) setAwsDecisions(null); });
    return () => { cancelled = true; };
  }, [p.id]);

  const engineEvents = awsDecisions !== null ? awsDecisions : audit.filter((a) => a.patient_id === p.id);
  return (
    <Screen>
      <AppHeader title="Audit history" subtitle={p.name} onBack={() => navigation.goBack()}
        right={awsDecisions !== null ? <Pill text="Synced from AWS" fg={C.success} bg={C.successSoft} icon="cloud-done" /> : null} />
      {engineEvents.length ? <SectionTitle>Engine decisions</SectionTitle> : null}
      {engineEvents.map((a, i) => (
        <Card key={i}><Row icon="git-commit" title={a.selected_action} subtitle={`${a.timestamp} · source ${a.decision_source} · conf ${a.confidence}`}
          right={<Pill text={a.decision_source === "therapist_rule" ? "Rule" : a.decision_source === "ai_reasoning" ? "AI" : "Fallback"} fg={C.textSecondary} bg="#EEF1F6" />} /></Card>
      ))}
      <SectionTitle>Rule & plan changes</SectionTitle>
      {(p.audit || []).map((a, i) => (
        <Card key={i}><Row icon="time" iconFg={C.textSecondary} iconBg="#EEF1F6" title={a.change} subtitle={`${a.when} · ${a.who}`} /></Card>
      ))}
    </Screen>
  );
}
