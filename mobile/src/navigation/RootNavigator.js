// Screen registry and the patient/therapist tab structure.
import React, { useEffect, useContext } from "react";
import { Ionicons } from "@expo/vector-icons";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import { colors as C } from "../theme/theme";
import { useApp } from "../state/AppContext";

import Login from "../screens/login";
import { PatientHome, PatientSupport, PatientProgress, PatientMessages, PatientProfile } from "../screens/patient";
import { PatientCare, Appointments } from "../screens/care";
import { TherapistDashboard, TherapistPatients, TherapistCalendar, TherapistMessages, TherapistMore } from "../screens/therapist";
import { WorkspaceContext, WsOverview, WsSessions, WsProgress, WsNotes, WsMore, TreatmentPlan, RiskSignals, Documents, Assignments, SafetyRules, Audit, SessionLogs, TriggerEvents, Medications } from "../screens/workspace";
import { PatientGlasses } from "../screens/glasses";
import { VoiceCheckIn } from "../screens/checkin";
import { RequestSupport } from "../screens/support_request";
import { FeaturesHub } from "../screens/features_hub";
import { DecisionInspector } from "../screens/inspector";
import { PatientDay } from "../screens/patient_day";
import { Reminders } from "../screens/reminders";
import { MonitoringPrivacy } from "../screens/monitoring_privacy";
import { EpisodeTimeline } from "../screens/episodes";
import { GroundingLibrary } from "../screens/grounding_library";
import { CompanioTab } from "../screens/companio";
import { Notifications } from "../screens/notifications";
import { EventDetail } from "../screens/event_detail";
import { ProfilePhoto } from "../screens/profile_photo";
import { DeclareContext } from "../screens/context_declare";
import { Alerts } from "../screens/alerts_screen";
import { LicenseVerify } from "../screens/license_verify";
import { PatientRecord, RecordSpoken, RecordSeen, RecordNotifications } from "../screens/record";
import { ClinicalOverview } from "../screens/clinical_overview";
import { Conversation, AddPatient, AddEvent } from "../screens/conversation";
import { ConnectDevices, ConnectWatch, ConnectGlasses } from "../screens/connect";
import { LiveMonitor } from "../screens/monitor";

const tabBar = (icons) => ({ route }) => ({
  headerShown: false,
  tabBarActiveTintColor: "#DFF6FF",
  tabBarInactiveTintColor: "rgba(199,223,240,0.62)",
  tabBarStyle: {
    backgroundColor: "#20406F",
    borderTopColor: "rgba(225,247,255,0.16)",
    borderTopWidth: 1,
    height: 84, paddingTop: 8, paddingBottom: 28,
  },
  tabBarLabelStyle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] || "ellipse"} size={size} color={color} />,
});

const PT = createBottomTabNavigator();
function PatientTabs() {
  return (
    <PT.Navigator screenOptions={tabBar({ Home: "home", Companio: "sparkles", Care: "medkit", Progress: "stats-chart", Profile: "person" })}>
      <PT.Screen name="Home" component={PatientHome} />
      <PT.Screen name="Companio" component={CompanioTab} />
      <PT.Screen name="Care" component={PatientCare} />
      <PT.Screen name="Progress" component={PatientProgress} />
      <PT.Screen name="Profile" component={PatientProfile} />
    </PT.Navigator>
  );
}

const PS = createNativeStackNavigator();
function PatientStack() {
  return (
    <PS.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.background } }}>
      <PS.Screen name="PatientTabs" component={PatientTabs} />
      <PS.Screen name="Glasses" component={PatientGlasses} />
      <PS.Screen name="VoiceCheckIn" component={VoiceCheckIn} />
      <PS.Screen name="RequestSupport" component={RequestSupport} />
      <PS.Screen name="Support" component={PatientSupport} />
      <PS.Screen name="Progress" component={PatientProgress} />
      <PS.Screen name="DecisionInspector" component={DecisionInspector} />
      <PS.Screen name="Conversation" component={Conversation} />
      <PS.Screen name="Devices" component={ConnectDevices} />
      <PS.Screen name="ConnectWatch" component={ConnectWatch} />
      <PS.Screen name="ConnectGlasses" component={ConnectGlasses} />
      <PS.Screen name="LiveMonitor" component={LiveMonitor} />
      <PS.Screen name="Reminders" component={Reminders} />
      <PS.Screen name="MonitoringPrivacy" component={MonitoringPrivacy} />
      <PS.Screen name="GroundingLibrary" component={GroundingLibrary} />
      <PS.Screen name="Notifications" component={Notifications} />
      <PS.Screen name="Appointments" component={Appointments} />
      <PS.Screen name="ProfilePhoto" component={ProfilePhoto} />
      <PS.Screen name="DeclareContext" component={DeclareContext} />
      <PS.Screen name="Features" component={FeaturesHub} />
      <PS.Screen name="Messages" component={PatientMessages} />
    </PS.Navigator>
  );
}

const TT = createBottomTabNavigator();
function TherapistTabs() {
  return (
    <TT.Navigator screenOptions={tabBar({ Dashboard: "grid", Patients: "people", Alerts: "notifications", Calendar: "calendar", Profile: "person" })}>
      <TT.Screen name="Dashboard" component={TherapistDashboard} />
      <TT.Screen name="Patients" component={TherapistPatients} />
      <TT.Screen name="Alerts" component={Alerts} />
      <TT.Screen name="Calendar" component={TherapistCalendar} />
      <TT.Screen name="Profile" component={TherapistMore} options={{ title: "Profile" }} />
    </TT.Navigator>
  );
}

const WT = createBottomTabNavigator();

function useWsId() { return useContext(WorkspaceContext); }

function WsEvents(props) {
  const patientId = useWsId();
  return <EpisodeTimeline {...props} route={{ ...props.route, params: { patientId } }} />;
}
function WsPlan(props) {
  const patientId = useWsId();
  return <TreatmentPlan {...props} route={{ ...props.route, params: { patientId } }} />;
}
function WsMessages(props) {
  const patientId = useWsId();
  return <Conversation {...props} route={{ ...props.route, params: { patientId, viewerRole: "therapist" } }} />;
}
function WsAudit(props) {
  const patientId = useWsId();
  return <Audit {...props} route={{ ...props.route, params: { patientId } }} />;
}

function WorkspaceTabs({ route }) {
  const patientId = route.params?.patientId || null;
  const { loadPatientDetail } = useApp();
  useEffect(() => { loadPatientDetail(patientId); }, [patientId]);
  return (
    <WorkspaceContext.Provider value={patientId}>
      <WT.Navigator screenOptions={tabBar({
        Overview: "person",
        WsEvents: "pulse",
        WsPlan: "clipboard",
        WsMessages: "chatbubbles",
        WsNotes: "document-text",
        WsAudit: "shield-checkmark",
      })}>
        <WT.Screen name="Overview" component={WsOverview} />
        <WT.Screen name="WsEvents" component={WsEvents} options={{ title: "Events" }} />
        <WT.Screen name="WsPlan" component={WsPlan} options={{ title: "Plan" }} />
        <WT.Screen name="WsMessages" component={WsMessages} options={{ title: "Messages" }} />
        <WT.Screen name="WsNotes" component={WsNotes} options={{ title: "Notes" }} />
        <WT.Screen name="WsAudit" component={WsAudit} options={{ title: "Audit" }} />
      </WT.Navigator>
    </WorkspaceContext.Provider>
  );
}

const TS = createNativeStackNavigator();
function TherapistStack() {
  return (
    <TS.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.background } }}>
      <TS.Screen name="TherapistTabs" component={TherapistTabs} />
      <TS.Screen name="Workspace" component={WorkspaceTabs} />
      <TS.Screen name="TreatmentPlan" component={TreatmentPlan} />
      <TS.Screen name="RiskSignals" component={RiskSignals} />
      <TS.Screen name="Documents" component={Documents} />
      <TS.Screen name="Assignments" component={Assignments} />
      <TS.Screen name="SafetyRules" component={SafetyRules} />
      <TS.Screen name="Audit" component={Audit} />
      <TS.Screen name="SessionLogs" component={SessionLogs} />
      <TS.Screen name="TriggerEvents" component={TriggerEvents} />
      <TS.Screen name="EpisodeTimeline" component={EpisodeTimeline} />
      <TS.Screen name="PatientRecord" component={PatientRecord} />
      <TS.Screen name="EventDetail" component={EventDetail} />
      <TS.Screen name="LicenseVerify" component={LicenseVerify} />
      <TS.Screen name="Messages" component={TherapistMessages} />
      <TS.Screen name="WsSessionsPage" component={WsSessions} options={{ title: "Sessions" }} />
      <TS.Screen name="WsProgressPage" component={WsProgress} options={{ title: "Progress" }} />
      <TS.Screen name="RecordSpoken" component={RecordSpoken} />
      <TS.Screen name="RecordSeen" component={RecordSeen} />
      <TS.Screen name="RecordNotifications" component={RecordNotifications} />
      <TS.Screen name="Medications" component={Medications} />
      <TS.Screen name="DecisionInspector" component={DecisionInspector} />
      <TS.Screen name="PatientDay" component={PatientDay} />
      <TS.Screen name="ClinicalOverview" component={ClinicalOverview} />
      <TS.Screen name="Glasses" component={PatientGlasses} />
      <TS.Screen name="VoiceCheckIn" component={VoiceCheckIn} />
      <TS.Screen name="LiveMonitor" component={LiveMonitor} />
      <TS.Screen name="Conversation" component={Conversation} />
      <TS.Screen name="AddPatient" component={AddPatient} />
      <TS.Screen name="AddEvent" component={AddEvent} />
      <TS.Screen name="Devices" component={ConnectDevices} />
      <TS.Screen name="ConnectWatch" component={ConnectWatch} />
      <TS.Screen name="ConnectGlasses" component={ConnectGlasses} />
    </TS.Navigator>
  );
}

export default function RootNavigator() {
  const { role } = useApp();
  if (role === "patient") return <PatientStack />;
  if (role === "therapist") return <TherapistStack />;
  return <Login />;
}
