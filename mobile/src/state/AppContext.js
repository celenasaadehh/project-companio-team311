// App-wide state: auth, caseload, preferences, messages.
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Linking } from "react-native";
import { newPatient, patientFromAws } from "../data/demoData";
import * as Auth from "../services/auth";
import * as SecureStore from "expo-secure-store";
import { recordInterventionOutcome, recordPatientResponse } from "../services/episode";
import { getMe, getMyPatients, getClinicalProfile, updateClinicalProfile, getNotes, getTherapistRules, getSessions, getAssignments, updateAssignment as updateAssignmentAws, saveNote } from "../services/engine";
import { registerForPushToken, requestNotifyPermission } from "../services/notify";
import { reportSyncFailure } from "../services/errors";
import { restoreEpisode } from "../services/episode";
import { registerNotificationActions, onNotificationAction } from "../services/notify_actions";
import { saveSession, saveDecision } from "../services/engine";

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const nowTime = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function AppProvider({ children }) {
  const [role, setRole] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [patients, setPatients] = useState([]);
  const [audit, setAudit] = useState([]);
  const [threads, setThreads] = useState({});
  const [events, setEvents] = useState([]);
  const [currentPatientId, setCurrentPatientId] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [askFollowupQuestions, setAskFollowupQuestionsState] = useState(false);
  const [devices, setDevices] = useState({ watch: false, glasses: false });

  // Baseline calibration and privacy choices are clinical state, not session
  // state: an app restart must not silently return a patient to uncalibrated
  // monitoring or default privacy settings.
  const hydratedRef = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const [d, p] = await Promise.all([
          SecureStore.getItemAsync("companio.devices"),
          SecureStore.getItemAsync("companio.prefs"),
        ]);
        if (d) setDevices((cur) => ({ ...cur, ...JSON.parse(d) }));
        if (p) setPrefs((cur) => ({ ...cur, ...JSON.parse(p) }));
      } catch {}
      hydratedRef.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!hydratedRef.current) return;
    SecureStore.setItemAsync("companio.devices", JSON.stringify(devices)).catch(() => {});
  }, [devices]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    SecureStore.setItemAsync("companio.prefs", JSON.stringify(prefs)).catch(() => {});
  }, [prefs]);

  const [prefs, setPrefs] = useState({
    physiologicalMonitoring: true,
    autoCheckIns: true,
    autoCapture: true,
    voiceRecording: true,
    saveTranscripts: true,
    saveAudio: false,
    saveImages: true,
    therapistAlerts: true,
    caregiverEscalation: false,
    voiceMode: "AUTO",
    // Off by default: an app that starts listening without being asked is not
    // one a trauma patient should have to discover after the fact.
    wakeWord: true,
    // Under HEADPHONES_ONLY, whether the phone speaker may be used. Off by
    // default: the whole point of that mode is not broadcasting a private
    // message aloud.
    allowSpeaker: false,
    allowBargeIn: true,
    allowAutoSpeech: true,
  });
  const [monitoringPausedUntil, setMonitoringPausedUntil] = useState(null);

  const setPref = useCallback((key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  const pauseMonitoring = useCallback((until) => setMonitoringPausedUntil(until), []);
  const resumeMonitoring = useCallback(() => setMonitoringPausedUntil(null), []);

  const isMonitoringPaused = useCallback(() => {
    if (!monitoringPausedUntil) return false;
    if (monitoringPausedUntil === "indefinite") return true;
    return Date.now() < monitoringPausedUntil;
  }, [monitoringPausedUntil]);

  useEffect(() => { restoreEpisode(); }, []);

  useEffect(() => {
    registerNotificationActions();
    return onNotificationAction(async ({ action, text, data }) => {
      // The camera-activation banner's "would you rather talk?": any tap
      // opens the Talk screen already listening, via the same deep link the
      // Siri shortcut uses.
      if (data?.kind === "camera_talk") {
        try { Linking.openURL("companio://help"); } catch {}
        return;
      }
      const pid = data?.patient_id || currentPatientId;
      if (!pid) return;

      const log = (payload) => saveSession({ patient_id: pid, ...payload })
        .catch((e) => reportSyncFailure("notification_response", e, { critical: true }));

      if (action === "IM_OK") {
        recordPatientResponse("okay");
        log({ type: "check_in_response", answer: "okay", via: "notification",
              message: "Patient answered “I'm okay” from a notification." });
      } else if (action === "NEED_HELP") {
        // Feeds the episode state machine directly: the next monitor step opens
        // the same support episode instead of only logging an event.
        recordPatientResponse("need_support");
        log({ type: "check_in_response", answer: "need_help", via: "notification",
              message: "Patient asked for help from a notification." });
      } else if (action === "HELPED" || action === "DIDNT_HELP") {
        const helped = action === "HELPED";
        recordInterventionOutcome(helped);
        saveDecision({
          patient_id: pid,
          decision_id: data?.decision_id || undefined,
          selected_action: data?.action || null,
          patient_reported_helped: helped,
          outcome_recorded_at: new Date().toISOString(),
          via: "notification",
        }).catch((e) => reportSyncFailure("intervention_outcome", e, { critical: true }));

        log({ type: "intervention_outcome", patient_reported_helped: helped, via: "notification",
              message: `Patient reported the suggestion ${helped ? "helped" : "did not help"}.` });
      } else if (action === "REPLY" && text) {
        const channel = data?.channel === "therapist" ? "therapist" : "companio";
        sendMessage(pid, "patient", text, channel);
      }
    });
  }, [currentPatientId, sendMessage]);

  useEffect(() => {
    (async () => {
      try {
        const base = await Auth.restoreSession();
        if (base) {
          const user = await resolveUser(base);
          applyUser(user);
          await hydrateForUser(user);
        }
      } catch {}
      setAuthReady(true);
    })();
  }, []);

  async function resolveUser(base) {
    try {
      const me = await getMe();
      const role = String(me.role || "").toUpperCase() === "THERAPIST" ? "therapist" : "patient";
      return {
        ...base, role,
        patientId: me.patient_id || null,
        username: me.username || base?.username,
        name: me.name || base?.name || me.username || base?.username || null,
        therapistName: me.therapist_name || null,
        groups: me.groups || base?.groups,
      };
    } catch {
      return base;
    }
  }

  function applyUser(u) {
    setAuthUser(u);
    setRole(u?.role || null);
    if (u?.role === "patient") setCurrentPatientId(u.patientId || u.username || u.sub || null);
  }

  async function hydrateForUser(user) {
    if (!user) return;

    (async () => {
      try {
        await requestNotifyPermission();

        const token = await registerForPushToken();
        if (!token) return;

        if (user.role === "patient" && (user.patientId || user.username)) {
          await updateClinicalProfile(user.patientId || user.username, { push_token: token });
        }

        if (user.role === "therapist") {
          const r = await getMyPatients().catch(() => null);
          for (const pt of r?.patients || []) {
            if (!pt.patient_id) continue;
            const a = await getAssignments(pt.patient_id).catch(() => null);
            for (const asg of a?.assignments || []) {
              if (asg.assignment_id && asg.active !== false) {
                await updateAssignment(asg.assignment_id, { therapist_push_token: token })
          .catch((e) => reportSyncFailure("therapist_push_token", e, {
            critical: true, detail: `assignment ${asg.assignment_id}`,
          }));
              }
            }
          }
        }
      } catch {}
    })();

    if (user.role === "therapist") {
      try {
        const r = await getMyPatients();
        const list = (r?.patients || []).map(patientFromAws);
        setPatients(list);
      } catch {}
    } else if (user.role === "patient" && (user.patientId || user.username)) {
      const pid = user.patientId || user.username;
      setCurrentPatientId(pid);
      try {
        const p = await getClinicalProfile(pid);
        if (p && !p.error) {
          setPatients([patientFromAws({ ...p, patient_id: p.patient_id || pid })]);
          setAskFollowupQuestionsState(!!p.ask_followup_questions);
        }
      } catch {}
    }
  }

  const setAskFollowupQuestions = useCallback(async (value) => {
    setAskFollowupQuestionsState(value);
    if (!currentPatientId) return;
    try {
      await updateClinicalProfile(currentPatientId, { ask_followup_questions: value });
    } catch {
    }
  }, [currentPatientId]);

  const signIn = useCallback(async (username, password) => {
    await Auth.login(username, password);
    const base = await Auth.currentUser();
    const user = await resolveUser(base);
    applyUser(user);
    await hydrateForUser(user);
    return user;
  }, []);

  const signOut = useCallback(async () => {
    try { await Auth.logout(); } catch {}
    setAuthUser(null); setRole(null); setCurrentPatientId(null); setPatients([]);
  }, []);

  const refreshMyProfile = useCallback(async () => {
    const pid = currentPatientId;
    if (!pid || role === "therapist") return;
    try {
      const p = await getClinicalProfile(pid);
      if (p && !p.error) setPatients([patientFromAws({ ...p, patient_id: p.patient_id || pid })]);
    } catch {}
  }, [currentPatientId, role]);

  const refreshMyPatients = useCallback(async () => {
    try {
      const r = await getMyPatients();
      setPatients((r?.patients || []).map(patientFromAws));
    } catch (e) {
      reportSyncFailure("load_caseload", e, { critical: true });
    }
  }, []);

  const patient = useCallback((id) => patients.find((p) => p.id === id) || null, [patients]);

  const updatePatient = useCallback((id, updater) => {
    setPatients((prev) => prev.map((p) => (p.id === id ? updater({ ...p }) : p)));
  }, []);

  const loadPatientDetail = useCallback(async (id) => {
    if (!id) return;
    const [notesRes, rulesRes, sessionsRes, profileRes] = await Promise.all([
      getNotes(id).catch(() => null),
      getTherapistRules(id).catch(() => null),
      getSessions(id).catch(() => null),
      getClinicalProfile(id).catch(() => null),
    ]);
    updatePatient(id, (p) => {
      const next = { ...p };
      // The caseload list is deliberately slim (id + name + condition), so the
      // clinical profile is re-read here: it is where medications and the
      // treatment plan live between restarts. Only fields the server actually
      // returned overwrite local state.
      const prof = profileRes && !profileRes.error ? profileRes : null;
      if (prof) {
        if (Array.isArray(prof.medications)) next.medications = prof.medications;
        const tp = { ...(p.treatmentPlan || {}) };
        if (Array.isArray(prof.approved_interventions)) tp.approvedInterventions = prof.approved_interventions;
        if (Array.isArray(prof.known_triggers)) tp.knownTriggers = prof.known_triggers;
        if (Array.isArray(prof.forbidden_interventions)) tp.forbiddenInterventions = prof.forbidden_interventions;
        if (Array.isArray(prof.communication_preferences)) tp.communicationPreferences = prof.communication_preferences;
        if (Array.isArray(prof.warning_signs)) tp.warningSigns = prof.warning_signs;
        if (prof.intervention_resources) tp.interventionResources = prof.intervention_resources;
        if (Array.isArray(prof.conditional_forbidden)) tp.conditionalForbidden = prof.conditional_forbidden;
        if (prof.clinical_guidance != null) tp.clinicalGuidance = prof.clinical_guidance;
        if (prof.ptsd_subtype != null) tp.ptsdSubtype = prof.ptsd_subtype;
        next.treatmentPlan = tp;
        if (prof.age != null) next.age = prof.age;
        if (prof.condition) next.condition = prof.condition;
        if (prof.avatar_s3_key) next.avatarS3Key = prof.avatar_s3_key;
      }
      const allNotes = notesRes?.notes;
      const byKind = (k) => (allNotes || []).filter((n) => n.note_kind === k)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const docs = byKind("document");
      if (docs.length) next.documents = docs.map((n) => ({ name: n.name, date: n.date, demo: false }));
      const hw = byKind("homework");
      if (hw.length) next.assignments = hw.map((n) => ({
        title: n.title, status: n.status || "Not Started", assignment_id: n.assignment_id }));
      const logs = byKind("session_log");
      if (logs.length) next.sessionLogs = logs.map((n) => ({ ...n }));
      const cal = byKind("calendar_event");
      if (cal.length) {
        setEvents((prev) => {
          const have = new Set(prev.map((e) => e.id));
          // The server strips real names from every table except identity (by
          // design), so a reloaded event comes back nameless: re-attach this
          // patient's local display name rather than showing "Patient".
          const merged = prev.map((e) =>
            e.patientId === id && (!e.name || e.name === "Patient")
              ? { ...e, name: p.name || e.name } : e);
          for (const n of cal) {
            if (!have.has(n.id)) merged.push({
              id: n.id, patientId: n.patient_id || id, name: p.name || "Patient",
              date: n.date, time: n.time, type: n.type, mode: n.mode,
            });
          }
          return merged.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        });
      }
      const notes = (allNotes || []).filter((n) => !n.note_kind);
      if (Array.isArray(notes) && notes.length) {
        next.notes = notes
          .slice()
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
          .map((n) => ({
            date: n.date || (n.created_at ? new Date(n.created_at).toLocaleDateString() : ""),
            time: n.time || (n.created_at ? new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""),
            type: n.type || "Clinical Note",
            text: n.text || "",
            tags: n.tags || [],
          }));
      }
      const rules = rulesRes?.rules;
      if (Array.isArray(rules) && rules.length) {
        const active = rules.find((r) => r.active !== false) || rules[0];
        next.safetyRule = {
          ...(p.safetyRule || {}),
          rule_id: active.rule_id,
          triggers: active.triggers || (active.trigger ? [active.trigger] : []),
          forbiddenActions: active.forbidden_actions || active.forbiddenActions || [],
          instructions: active.instructions || "",
        };
      }
      const sessions = sessionsRes?.sessions;
      if (Array.isArray(sessions) && sessions.length) next.awsSessions = sessions;
      return next;
    });
  }, [updatePatient]);

  const actorName = authUser?.name || authUser?.username || "Therapist";

  const addNote = useCallback((id, note) => {
    updatePatient(id, (p) => ({ ...p, notes: [note, ...(p.notes || [])] }));
  }, [updatePatient]);

  const addAssignment = useCallback((id, a) => {
    const item = { ...a, status: "Not Started", assignment_id: `HW-${Date.now()}` };
    updatePatient(id, (p) => ({ ...p, assignments: [item, ...(p.assignments || [])] }));
    // "Homework", stored as a typed note: CompanioAssignments is the ACCESS
    // GRANT table and must never hold tasks.
    saveNote({ patient_id: id, note_kind: "homework", ...item })
      .catch((e) => reportSyncFailure("save_homework", e, { critical: true }));
  }, [updatePatient]);

  const addAudit = useCallback((id, entry) => {
    updatePatient(id, (p) => ({ ...p, audit: [entry, ...(p.audit || [])] }));
  }, [updatePatient]);

  const updateRule = useCallback((id, ruleId, patch, actor = actorName) => {
    updatePatient(id, (p) => ({
      ...p,
      rules: (p.rules || []).map((r) => (r.ruleId === ruleId ? { ...r, ...patch, version: (r.version || 1) + 1 } : r)),
      audit: [{ when: new Date().toLocaleString(), who: actor, change: Object.keys(patch).map((k) => `${k} updated`).join(", ") }, ...(p.audit || [])],
    }));
  }, [updatePatient, actorName]);

  const addDecision = useCallback((rec) => setAudit((prev) => [rec, ...prev].slice(0, 40)), []);

  const updateTreatmentPlanList = useCallback((id, field, items, actor = actorName) => {
    updatePatient(id, (p) => ({
      ...p,
      treatmentPlan: { ...(p.treatmentPlan || {}), [field]: items },
      audit: [{ when: new Date().toLocaleString(), who: actor, change: `Treatment plan updated: ${field}` }, ...(p.audit || [])],
    }));
  }, [updatePatient, actorName]);

  const updateAssignment = useCallback((id, index, patch) => {
    updatePatient(id, (p) => ({
      ...p,
      assignments: (p.assignments || []).map((a, i) => i === index ? { ...a, ...patch } : a),
      audit: [{ when: new Date().toLocaleString(), who: actorName, change: `Assignment updated: ${(p.assignments || [])[index]?.title || index}` }, ...(p.audit || [])],
    }));
  }, [updatePatient, actorName]);

  const dischargePatient = useCallback(async (patientId) => {
    if (!patientId) return { ok: false, error: "No patient id" };
    try {
      const r = await getAssignments(patientId);
      const active = (r?.assignments || []).filter((a) => a.active !== false);
      if (!active.length) {
        setPatients((prev) => prev.filter((p) => p.id !== patientId));
        return { ok: true, serverUpdated: false };
      }
      for (const a of active) {
        // updateAssignmentAws is the SERVER write. The component also defines a
        // local updateAssignment for homework state, which shadowed the import:
        // discharge was updating homework state and never AWS, so the patient
        // returned on every restart.
        if (a.assignment_id) await updateAssignmentAws(a.assignment_id, { active: false });
      }
      setPatients((prev) => prev.filter((p) => p.id !== patientId));
      return { ok: true, serverUpdated: true };
    } catch (e) {
      reportSyncFailure("discharge_patient", e, { critical: true, detail: patientId });
      return { ok: false, error: String(e?.message || e) };
    }
  }, []);

  const removeAssignment = useCallback((id, index) => {
    updatePatient(id, (p) => {
      const target = (p.assignments || [])[index];
      return {
        ...p,
        assignments: (p.assignments || []).filter((_, i) => i !== index),
        audit: [{ when: new Date().toLocaleString(), who: actorName, change: `Assignment removed: ${target?.title || index}` }, ...(p.audit || [])],
      };
    });
  }, [updatePatient, actorName]);

  const addDocument = useCallback((id, doc) => {
    updatePatient(id, (p) => ({
      ...p,
      documents: [{ ...doc }, ...(p.documents || [])],
      audit: [{ when: new Date().toLocaleString(), who: actorName, change: `Document added: ${doc.name}` }, ...(p.audit || [])],
    }));
    saveNote({ patient_id: id, note_kind: "document", ...doc })
      .catch((e) => reportSyncFailure("save_document", e, { critical: true }));
  }, [updatePatient, actorName]);

  // Clears local state only. Nothing is reseeded: the caseload is whatever
  // AWS says it is, and an empty caseload renders as an honest empty state.
  const resetDemoData = useCallback(() => {
    setPatients([]);
    setAudit([]);
    setThreads({});
    setEvents([]);
    setVitals(null);
    setDevices({ watch: false, glasses: false });
    setCurrentPatientId(null);
  }, []);

  const messagesFor = useCallback((pid) => threads[pid] || [], [threads]);
  const sendMessage = useCallback((pid, from, text, channel = "therapist") => {
    const t = (text || "").trim();
    if (!t) return;
    const msg = { from, text: t, time: nowTime(), channel, created_at: new Date().toISOString() };
    setThreads((prev) => ({ ...prev, [pid]: [...(prev[pid] || []), msg] }));

    saveSession({
      patient_id: pid,
      type: "message",
      channel,
      sender_role: from,
      message: t,
    }).catch((e) => reportSyncFailure("message", e, {
      critical: true, detail: `${channel} message not delivered`,
    }));
  }, []);

  const loadMessages = useCallback(async (pid) => {
    if (!pid) return;
    try {
      const r = await getSessions(pid);
      const stored = (r?.sessions || [])
        .filter((x) => x.type === "message" && x.message)
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .map((x) => ({
          from: x.sender_role || "patient",
          text: x.message,
          time: x.created_at
            ? new Date(x.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "",
          channel: x.channel || "therapist",
          created_at: x.created_at,
        }));
      if (stored.length) setThreads((prev) => ({ ...prev, [pid]: stored }));
    } catch (e) {
      reportSyncFailure("load_messages", e, { critical: false });
    }
  }, []);

  const addPatient = useCallback((form) => {
    const p = newPatient({ ...form, actor: actorName });
    setPatients((prev) => [p, ...prev]);
    return p;
  }, [actorName]);

  const addEvent = useCallback((ev) => {
    const item = { id: `E-${Date.now()}`, ...ev };
    setEvents((prev) => [...prev, item].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    // Persist against the patient the appointment concerns, when one is set.
    if (ev.patientId || ev.patient_id) {
      saveNote({ patient_id: ev.patientId || ev.patient_id, note_kind: "calendar_event", ...item })
        .catch((e) => reportSyncFailure("save_calendar_event", e, { critical: true }));
    }
  }, []);

  const addSessionLog = useCallback((id, log) => {
    const item = { id: `S-${Date.now()}`, ...log };
    updatePatient(id, (p) => ({
      ...p,
      sessionLogs: [item, ...(p.sessionLogs || [])],
      audit: [{ when: new Date().toLocaleString(), who: actorName, change: "Session log added" }, ...(p.audit || [])],
    }));
    saveNote({ patient_id: id, note_kind: "session_log", ...item })
      .catch((e) => reportSyncFailure("save_session_log", e, { critical: true }));
  }, [updatePatient, actorName]);

  const addMedication = useCallback((id, med) => {
    let nextList = [];
    updatePatient(id, (p) => {
      nextList = [...(p.medications || []), med];
      return { ...p, medications: nextList };
    });
    updateClinicalProfile(id, { medications: nextList })
      .catch((e) => reportSyncFailure("medications", e, { critical: true, detail: med?.name }));
  }, [updatePatient]);

  const toggleMedicationTaken = useCallback((patientId, medIndex) => {
    const today = new Date().toDateString();
    updatePatient(patientId, (p) => {
      const meds = [...(p.medications || [])];
      const med = meds[medIndex];
      if (!med) return p;
      const takenDates = med.takenDates || [];
      const already = takenDates.includes(today);
      meds[medIndex] = { ...med, takenDates: already ? takenDates.filter((d) => d !== today) : [...takenDates, today] };

      saveSession({
        patient_id: patientId,
        type: "medication_log",
        medication: med.name,
        dose: med.dose || null,
        taken: !already,
        logged_for_date: today,
        message: `${med.name} marked ${already ? "not taken" : "taken"}.`,
      }).catch((e) => reportSyncFailure("medication_log", e, {
        critical: true, detail: `${med.name} (${today})`,
      }));

      return { ...p, medications: meds };
    });
  }, [updatePatient]);

  const addTriggerEvent = useCallback((id, ev) => {
    updatePatient(id, (p) => ({ ...p, triggerEvents: [{ id: `T-${Date.now()}`, time: nowTime(), ...ev }, ...(p.triggerEvents || [])] }));
  }, [updatePatient]);

  return (
    <AppContext.Provider value={{ role, setRole, loadMessages, dischargePatient, refreshMyProfile, authUser, authReady, signIn, signOut, refreshMyPatients, patients, patient, updatePatient, updateTreatmentPlanList, addNote, addAssignment, updateAssignment, removeAssignment, addDocument, addAudit, updateRule, audit, addDecision, threads, messagesFor, sendMessage, addPatient, events, addEvent, addSessionLog, addMedication, toggleMedicationTaken, addTriggerEvent, loadPatientDetail, resetDemoData, currentPatientId, setCurrentPatientId, vitals, setVitals, devices, setDevices, askFollowupQuestions, setAskFollowupQuestions, prefs, setPref, pauseMonitoring, resumeMonitoring, monitoringPausedUntil, isMonitoringPaused }}>
      {children}
    </AppContext.Provider>
  );
}
