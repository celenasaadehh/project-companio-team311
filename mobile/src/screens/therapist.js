// Therapist dashboard, caseload and calendar.
import React, { useMemo, useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type, riskColor } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, MetricCard, RiskBadge, Chip, Pill, EmptyState, Btn, Divider, Disclaimer } from "../components/ui";
import { getSessions, getMediaViewUrl, getIdentity, getDecisions } from "../services/engine";
import { useApp } from "../state/AppContext";
import { pendingCredential } from "../services/pending_credential";

const avatarInitials = (name) => (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("");

export function Avatar({ name, color = C.navy, size = 44, s3Key = null, patientId = null }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!s3Key || !patientId) return undefined;
    getMediaViewUrl(s3Key, patientId)
      .then((r) => { if (alive) setUrl(r?.url || null); })
      .catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [s3Key, patientId]);

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color,
                   alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: size * 0.34 }}>{avatarInitials(name)}</Text>
      )}
    </View>
  );
}

export function TherapistDashboard({ navigation }) {
  const { patients, events, authUser, updatePatient } = useApp();

  // Live risk for the caseload, computed from the decisions the engine
  // actually made (each carries the risk score it decided under). The
  // caseload list itself arrives without risk, so without this the
  // dashboard would show "low" forever no matter what happened today.
  const patientsRef = useRef(patients);
  useEffect(() => { patientsRef.current = patients; }, [patients]);
  useEffect(() => {
    let alive = true;
    async function pollRisk() {
      for (const p of patientsRef.current) {
        try {
          const r = await getDecisions(p.id);
          const ds = (r?.decisions || []).filter((d) => d.risk_score != null);
          if (!ds.length) continue;
          const ts = (d) => new Date(d.timestamp || d.created_at || 0).getTime();
          const recent = ds.filter((d) => Date.now() - ts(d) < 24 * 3600 * 1000);
          if (!recent.length) continue;
          const peak = recent.reduce((m, d) =>
            Number(d.risk_score) > Number(m.risk_score) ? d : m, recent[0]);
          const score = Number(peak.risk_score) || 0;
          const level = score >= 0.75 ? "high" : score >= 0.5 ? "elevated" : "low";
          // Baseline days stay quiet: the therapist's dashboard registers a
          // patient only when the peak actually rose. Low readings are still
          // stored server-side with every decision; they just don't page.
          if (level === "low") continue;
          const when = new Date(ts(peak)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          if (!alive) return;
          updatePatient(p.id, (prev) => ({
            ...prev,
            risk: { ...(prev.risk || {}), score, level, lastUpdated: when },
            lastEvent: `Peak risk score ${score.toFixed(2)} (${level}) at ${when}`
              + (peak.selected_action ? ` · offered: ${peak.selected_action}` : ""),
          }));
        } catch {}
      }
    }
    pollRisk();
    const t = setInterval(pollRisk, 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const therapistDisplayName = authUser?.name || authUser?.username || "there";
  const firstName = therapistDisplayName.split(" ")[0];

  const today = new Date();
  const dateLine = today.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const hour = today.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const alerts = patients.filter((p) =>
    p.alert || ["high", "critical"].includes((p.risk?.level || "").toLowerCase()));

  const todayStr = today.toDateString();
  const todaysSessions = events.filter((e) => {
    const t = Date.parse(`${e.date} ${e.time || ""}`);
    return Number.isFinite(t) && new Date(t).toDateString() === todayStr;
  });

  const [activity, setActivity] = useState(null);
  const [unread, setUnread] = useState(0);
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    let alive = true;
    const me = authUser?.username || authUser?.sub;
    if (!me) return undefined;
    getIdentity(me)
      .then((r) => {
        const item = r?.item || r;
        if (alive) setVerification(item?.verification_status || "none");
      })
      .then(() => pendingCredential(me))
      .then((c) => { if (alive && c) navigation.navigate("LicenseVerify"); })
      // Unknown is not the same as unverified: do not nag someone because a
      // lookup failed.
      .catch(() => { if (alive) setVerification(null); });
    return () => { alive = false; };
  }, [authUser?.username]);

  useEffect(() => {
    let alive = true;
    Promise.all(patients.slice(0, 8).map((p) =>
      getSessions(p.id).then((r) => (r?.sessions || []).map((x) => ({ ...x, _patient: p })))
        .catch(() => [])))
      .then((lists) => {
        if (!alive) return;
        const all = lists.flat()
          .filter((x) => ["trigger_event", "voice_transcription", "call_request", "emergency_alert", "message"].includes(x.type))
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        setActivity(all.slice(0, 6));
        setUnread(all.filter((x) => x.type === "message" && x.sender_role === "patient").length);
      });
    return () => { alive = false; };
  }, [patients.length]);

  const Metric = ({ value, label, tint, onPress }) => (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} disabled={!onPress}
      style={{ width: "48%", marginBottom: spacing.md }}>
      <Card style={{ marginTop: 0 }}>
        <Text style={[type.metric, { fontSize: 30, color: tint || C.textPrimary }]}>{value}</Text>
        <Text style={[type.sub, { marginTop: 2 }]}>{label}</Text>
      </Card>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.metric, { fontSize: 24 }]}>{`${greeting}, ${firstName}`}</Text>
          <Text style={[type.sub, { marginTop: 2 }]}>{dateLine}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate("Alerts")}
          style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.surfaceStrong,
                   alignItems: "center", justifyContent: "center", marginRight: 8 }}>
          <Ionicons name="notifications-outline" size={20} color={C.textPrimary} />
          {alerts.length > 0 ? (
            <View style={{ position: "absolute", top: 8, right: 9, width: 8, height: 8,
                           borderRadius: 4, backgroundColor: C.danger }} />
          ) : null}
        </TouchableOpacity>
        <Avatar name={therapistDisplayName} color={C.navy} size={42} />
      </View>

      {verification === "none" || verification === "rejected" ? (
        <Card accent={C.warning} onPress={() => navigation.navigate("LicenseVerify")}>
          <Row icon="shield-outline" iconFg={C.warning} iconBg={C.warningSoft}
            title={verification === "rejected" ? "Your credential was not accepted"
              : "Verify your professional credentials"}
            subtitle="A Companio therapist account defines what an automated system says to a patient in crisis."
            right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
          <Btn label="Submit licence" icon="document-text"
            onPress={() => navigation.navigate("LicenseVerify")} />
        </Card>
      ) : verification === "pending_review" ? (
        <Card>
          <Row icon="hourglass" iconFg={C.warning} iconBg={C.warningSoft}
            title="Credential under review"
            subtitle="You can keep working while this is checked." />
        </Card>
      ) : null}

      {patients.length === 0 ? (
        <Card>
          <EmptyState icon="people" title="Your caseload is empty"
            sub="Add your first patient to start building care plans and monitoring decisions." />
          <Btn label="Add your first patient" icon="person-add" onPress={() => navigation.navigate("AddPatient")} />
        </Card>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <Metric value={patients.length} label="Patients"
              onPress={() => navigation.navigate("Patients")} />
            <Metric value={alerts.length} label="Need attention" tint={alerts.length ? C.danger : undefined}
              onPress={() => navigation.navigate("Alerts")} />
            <Metric value={todaysSessions.length} label="Sessions today"
              onPress={() => navigation.navigate("Calendar")} />
            <Metric value={unread} label="Patient messages" tint={unread ? C.accentBlue : undefined}
              onPress={() => navigation.navigate("Messages")} />
          </View>

          <SectionTitle sub="Only the cases that deserve your attention now.">Needs attention</SectionTitle>
          {alerts.length === 0 ? (
            <Card>
              <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
                title="Nothing needs review" subtitle="No high-attention flags at the moment." />
            </Card>
          ) : alerts.slice(0, 4).map((p) => {
            const rc = riskColor(p.risk?.level);
            return (
              <Card key={p.id} accent={C.danger}
                onPress={() => navigation.navigate("PatientRecord", { patientId: p.id })}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Avatar name={p.name} color={p.avatar || C.navy} size={42}
                    s3Key={p.avatarS3Key} patientId={p.id} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={type.title}>{p.name}</Text>
                    <Text style={[type.sub, { marginTop: 2 }]}>
                      {p.lastEvent || p.status || "Recent elevated episode"}
                    </Text>
                  </View>
                  <Pill text={rc.label} fg={rc.fg} bg={rc.bg} />
                </View>
              </Card>
            );
          })}

          <SectionTitle sub={todaysSessions.length ? undefined : "Nothing scheduled today."}>
            Today's schedule
          </SectionTitle>
          {todaysSessions.length === 0 ? (
            <Card><Row icon="calendar-outline" iconFg={C.textMuted} iconBg={C.surfaceStrong}
              title="No sessions today" /></Card>
          ) : todaysSessions.map((e) => (
            <Card key={e.id} onPress={() => navigation.navigate("PatientRecord", { patientId: e.patientId })}>
              <Row icon="time" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
                title={`${e.time} · ${e.name}`} subtitle={e.type}
                right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
            </Card>
          ))}

          <SectionTitle>Recent activity</SectionTitle>
          {activity === null ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 8 }} />
          ) : activity.length === 0 ? (
            <Card><Row icon="pulse" iconFg={C.textMuted} iconBg={C.surfaceStrong}
              title="No recent activity" /></Card>
          ) : activity.map((a, i) => (
            <Card key={a.session_id || i}
              onPress={() => navigation.navigate("PatientRecord", { patientId: a._patient?.id })}>
              <Row
                icon={a.type === "trigger_event" ? "camera"
                  : a.type === "voice_transcription" ? "mic"
                  : a.type === "message" ? "chatbubbles" : "alert-circle"}
                iconFg={["call_request", "emergency_alert"].includes(a.type) ? C.danger : C.primary}
                iconBg={["call_request", "emergency_alert"].includes(a.type) ? C.dangerSoft : C.primarySoft}
                title={`${a._patient?.name || "Patient"} · ${
                  a.type === "trigger_event" ? (a.normalized_visual_trigger || "Trigger check")
                  : a.type === "voice_transcription" ? "Voice check-in"
                  : a.type === "message" ? "Message"
                  : a.type === "emergency_alert" ? "Emergency alert" : "Contact requested"}`}
                subtitle={a.created_at ? new Date(a.created_at).toLocaleString() : ""}
                right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
            </Card>
          ))}
        </>
      )}
      <Disclaimer />
    </Screen>
  );
}

function Action({ label, icon, onPress }) {
  return <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={{ width: "48%", marginRight: "2%", marginBottom: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", alignItems: "center" }}><Ionicons name={icon} size={18} color={C.primary} /><Text style={[type.title, { marginLeft: 9, fontSize: 14 }]}>{label}</Text></TouchableOpacity>;
}

export function TherapistPatients({ navigation }) {
  const { patients, events } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const [lastEvents, setLastEvents] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all(patients.map(async (p) => {
      const r = await getSessions(p.id).catch(() => null);
      const rows = (r?.sessions || [])
        .filter((x) => ["trigger_event", "voice_transcription", "call_request", "emergency_alert"].includes(x.type))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      return [p.id, rows[0] || null];
    })).then((pairs) => { if (alive) setLastEvents(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [patients.length]);

  const nextSessionFor = (pid) => {
    const mine = events.filter((e) => e.patientId === pid);
    return mine[0] || null;
  };

  const list = useMemo(() => {
    let l = patients;
    if (filter === "Needs attention") {
      l = l.filter((p) => p.alert || ["high", "critical"].includes((p.risk?.level || "").toLowerCase()));
    }
    if (filter === "Recent") {
      l = [...l].sort((a, b) =>
        new Date(lastEvents[b.id]?.created_at || 0) - new Date(lastEvents[a.id]?.created_at || 0));
    }
    if (q.trim()) {
      const s2 = q.toLowerCase();
      l = l.filter((p) => p.name.toLowerCase().includes(s2)
        || (p.displayId || "").toLowerCase().includes(s2));
    }
    return l;
  }, [patients, filter, q, lastEvents]);

  const describe = (e) => {
    if (!e) return "No support events yet";
    const when = new Date(e.created_at).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const what = e.type === "trigger_event" ? (e.normalized_visual_trigger || "Trigger check")
      : e.type === "voice_transcription" ? "Voice check-in"
      : e.type === "emergency_alert" ? "Emergency alert" : "Contact requested";
    return `${what} · ${when}`;
  };

  return (
    <Screen>
      <AppHeader eyebrow="CASELOAD" title="Patients"
        subtitle={`${patients.length} ${patients.length === 1 ? "person" : "people"} in your care`}
        right={
          <TouchableOpacity onPress={() => navigation.navigate("AddPatient")}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.navy,
                     alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        } />

      {patients.length === 0 ? (
        <>
          <EmptyState icon="people" title="No patients yet"
            sub="Add your first patient and create an individualized care plan." />
          <Btn label="Add patient" icon="person-add" onPress={() => navigation.navigate("AddPatient")} />
        </>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.surface,
                         borderRadius: radius.md, borderWidth: 1, borderColor: C.border,
                         paddingHorizontal: 13, marginBottom: spacing.sm }}>
            <Ionicons name="search" size={18} color={C.textMuted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search patients"
              placeholderTextColor={C.textMuted}
              style={{ flex: 1, paddingVertical: 13, paddingHorizontal: 9, color: C.textPrimary, fontSize: 15 }} />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: spacing.sm }}>
            {["All", "Needs attention", "Recent"].map((f) => (
              <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
            ))}
          </View>

          {list.length === 0 ? (
            <EmptyState icon="search" title="No matches" sub="Try a different search or filter." />
          ) : list.map((p) => {
            const rc = riskColor(p.risk?.level);
            const last = lastEvents[p.id];
            const next = nextSessionFor(p.id);
            const attention = p.alert || ["high", "critical"].includes((p.risk?.level || "").toLowerCase());
            return (
              <Card key={p.id} accent={attention ? C.danger : undefined}
                onPress={() => navigation.navigate("PatientRecord", { patientId: p.id })}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Avatar name={p.name} color={p.avatar || C.navy} size={46}
                    s3Key={p.avatarS3Key} patientId={p.id} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={type.title}>{p.name}</Text>
                    <Text style={[type.meta, { marginTop: 2 }]}>{p.displayId}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Pill text={rc.label} fg={rc.fg} bg={rc.bg} />
                    <Ionicons name="chevron-forward" size={17} color={C.textMuted} style={{ marginTop: 6 }} />
                  </View>
                </View>

                <View style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border }}>
                  <Row icon="pulse" iconFg={C.primary} iconBg={C.primarySoft}
                    title="Last support event" subtitle={describe(last)} />
                  <Row icon="calendar" iconFg={C.accentBlue} iconBg={C.accentBlueSoft}
                    title="Next session"
                    subtitle={next ? `${next.date} · ${next.time}` : "Not scheduled"} />
                </View>
              </Card>
            );
          })}
        </>
      )}
      <Disclaimer />
    </Screen>
  );
}

export function TherapistCalendar({ navigation }) {
  const { events } = useApp();

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const isToday = (d) => d.toDateString() === today.toDateString();

  const parsed = events.map((e) => {
    const t = Date.parse(`${e.date} ${e.time || ""}`);
    return { ...e, _t: Number.isFinite(t) ? t : null };
  });

  const groups = new Map();
  for (const e of parsed) {
    const key = e._t ? new Date(e._t).toDateString() : `unparsed:${e.date || "no date"}`;
    if (!groups.has(key)) groups.set(key, { key, t: e._t, label: null, items: [] });
    groups.get(key).items.push(e);
  }
  for (const g of groups.values()) {
    if (g.t) {
      const d = new Date(g.t);
      const isSameDay = d.toDateString() === today.toDateString();
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      g.label = isSameDay ? `Today · ${d.toLocaleDateString([], { month: "long", day: "numeric" })}`
        : d.toDateString() === tomorrow.toDateString()
          ? `Tomorrow · ${d.toLocaleDateString([], { month: "long", day: "numeric" })}`
          : d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    } else {
      g.label = g.items[0]?.date || "No date set";
    }
    g.items.sort((a, b) => (a._t ?? 0) - (b._t ?? 0));
  }

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.t == null) return 1;
    if (b.t == null) return -1;
    return a.t - b.t;
  });

  return (
    <Screen>
      <AppHeader eyebrow={today.toLocaleDateString([], { month: "long", year: "numeric" }).toUpperCase()}
        title="Calendar"
        subtitle={`${events.length} scheduled session${events.length === 1 ? "" : "s"}`}
        right={
          <TouchableOpacity onPress={() => navigation.navigate("AddEvent")}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.navy,
                     alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        } />

      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 }}>
        {week.map((d, i) => {
          const has = ordered.some((g) => g.t && new Date(g.t).toDateString() === d.toDateString());
          return (
            <View key={d.toISOString()} style={{ alignItems: "center" }}>
              <Text style={type.meta}>{["M", "T", "W", "T", "F", "S", "S"][i]}</Text>
              <View style={{ width: 34, height: 34, borderRadius: 17, marginTop: 5,
                             backgroundColor: isToday(d) ? C.primary : "transparent",
                             alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "700", color: isToday(d) ? "#fff" : C.textPrimary }}>
                  {d.getDate()}
                </Text>
              </View>
              <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 4,
                             backgroundColor: has ? C.accentBlue : "transparent" }} />
            </View>
          );
        })}
      </View>

      {ordered.length === 0 ? (
        <EmptyState icon="calendar" title="No sessions scheduled"
          sub="Tap + to schedule one with a patient." />
      ) : ordered.map((g) => (
        <View key={g.key}>
          <SectionTitle>{g.label}</SectionTitle>
          {g.items.map((c) => (
            <Card key={c.id}
              onPress={() => navigation.navigate("PatientRecord", { patientId: c.patientId })}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 84 }}>
                  <Text style={[type.title, { fontSize: 14 }]}>{c.time || "—"}</Text>
                  {c._t == null ? <Text style={type.meta}>as entered</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.title}>{c.name}</Text>
                  <Text style={[type.sub, { marginTop: 2 }]}>{c.type}</Text>
                </View>
                <Pill text={c.mode || "Session"}
                  fg={c.mode === "Video" ? C.teal : C.primary}
                  bg={c.mode === "Video" ? C.tealSoft : C.primarySoft} />
              </View>
            </Card>
          ))}
        </View>
      ))}
      <Disclaimer />
    </Screen>
  );
}

export function TherapistMessages({ navigation }) {
  const { patients, messagesFor } = useApp();
  const [q, setQ] = useState("");
  const list = patients.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen>
      <AppHeader eyebrow="SECURE INBOX" title="Messages" subtitle="Patient conversations and care follow-up" />
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, marginBottom: 8 }}><Ionicons name="search" size={18} color={C.textMuted} /><TextInput value={q} onChangeText={setQ} placeholder="Search conversations" placeholderTextColor={C.textMuted} style={{ flex: 1, paddingVertical: 13, paddingHorizontal: 9, color: C.textPrimary, fontSize: 15 }} /></View>
      {list.length === 0 ? <EmptyState icon="chatbubbles" title="No conversations" sub="No patient conversations match your search." /> : list.map((p, index) => {
        const t = messagesFor(p.id); const last = t[t.length - 1];
        return <TouchableOpacity key={p.id} activeOpacity={0.72} onPress={() => navigation.navigate("Conversation", { patientId: p.id, viewerRole: "therapist" })}><View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 15, borderBottomWidth: index === list.length - 1 ? 0 : 1, borderBottomColor: C.border }}><Avatar name={p.name} color={p.avatar || C.navy} size={46} /><View style={{ flex: 1, marginLeft: 13 }}><Text style={type.title}>{p.name}</Text><Text style={[type.sub, { marginTop: 2 }]} numberOfLines={1}>{last ? `${last.from === "therapist" ? "You: " : ""}${last.text}` : "No messages yet"}</Text></View><Ionicons name="chevron-forward" size={18} color={C.textMuted} /></View></TouchableOpacity>;
      })}
    </Screen>
  );
}

export function TherapistMore({ navigation }) {
  const { signOut, authUser, patients } = useApp();
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    let alive = true;
    const me = authUser?.username || authUser?.sub;
    if (!me) return undefined;
    getIdentity(me)
      .then((r) => { const it = r?.item || r; if (alive) setVerification(it?.verification_status || "none"); })
      .catch(() => { if (alive) setVerification(null); });
    return () => { alive = false; };
  }, [authUser?.username]);

  const badge = {
    verified: { text: "Verified", fg: C.success, bg: C.successSoft },
    pending_review: { text: "Pending review", fg: C.warning, bg: C.warningSoft },
    rejected: { text: "Not accepted", fg: C.danger, bg: C.dangerSoft },
    none: { text: "Not submitted", fg: C.textSecondary, bg: C.surfaceStrong },
  }[verification || "none"];

  const caseload = patients.length;

  return (
    <Screen>
      <AppHeader eyebrow="ACCOUNT" title="Profile"
        subtitle="Your Companio account and professional credentials" />

      <Card>
        <Row icon="person-circle" iconFg={C.primary} iconBg={C.primarySoft}
          title={authUser?.name || authUser?.username || "Signed in"}
          subtitle={`Therapist account${caseload ? ` · ${caseload} patient${caseload === 1 ? "" : "s"}` : ""}`} />
      </Card>

      <Card accent={verification === "verified" ? C.success : C.warning}
        onPress={() => navigation.navigate("LicenseVerify")}>
        <Row icon={verification === "verified" ? "shield-checkmark" : "shield-outline"}
          iconFg={badge.fg} iconBg={badge.bg}
          title="Professional verification"
          subtitle={verification === "verified"
            ? "Your credential has been accepted"
            : "Submit your licence or practising certificate"}
          right={<Pill text={badge.text} fg={badge.fg} bg={badge.bg} />} />
      </Card>

      <Card onPress={() => navigation.navigate("Alerts")}>
        <Row icon="notifications" iconFg={C.warning} iconBg={C.warningSoft}
          title="Alerts" subtitle="Episodes needing your review"
          right={<Ionicons name="chevron-forward" size={18} color={C.textMuted} />} />
      </Card>

      <Divider style={{ marginTop: 28 }} />
      <TouchableOpacity onPress={signOut} style={{ paddingVertical: 13 }}>
        <Text style={{ color: C.danger, fontWeight: "700", textAlign: "center" }}>Sign out</Text>
      </TouchableOpacity>
    </Screen>
  );
}

