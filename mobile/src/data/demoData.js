// Maps AWS records into the shape the screens use.
const wave = (base, amp, n = 12) =>
  Array.from({ length: n }, (_, i) => +(base + amp * Math.sin(i / 1.7) + (i % 3) * amp * 0.15).toFixed(1));

const defaults = (p) => ({
  gender: "—",
  status: "Active",
  documents: [],
  assignments: [],
  audit: [],
  trends: { mood: [], hr: [], physio: [] },
  goals: [],
  sessions: [],
  assessments: [],
  notes: [],
  rules: [],
  medications: [],
  sessionLogs: [],
  triggerEvents: [],
  intake: { presentingConcern: "", consent: false, signedPatient: false, signedTherapist: false, signedDate: null },
  ...p,
});

export const THERAPIST = { name: "Dr. Morgan Lee", initials: "ML" };

export const INTERVENTION_OPTIONS = [
  "offer calm mode", "breathing prompt", "5-4-3-2-1 grounding",
  "paced breathing", "journaling", "safe-place visualization", "grounding techniques",
];


export const EXAMPLE_PATIENT = defaults({
  id: "EX-001", displayId: "PT-EXAMPLE", name: "Example Patient", age: 32, gender: "M",
  status: "Active", progress: 75, avatar: "#2864E8",
  risk: { score: 0.78, level: "high", supportLevel: "Level 3 · High", lastUpdated: "just now" },
  treatmentPlan: {
    approvedInterventions: ["offer calm mode", "breathing prompt", "5-4-3-2-1 grounding"],
    knownTriggers: ["crowds", "loud bangs"],
    forbiddenInterventions: ["flashing lights"],
    communicationPreferences: ["short sentences"], warningSigns: ["clenched jaw"],
    environmentalSensitivities: ["sudden noise"], escalationPreferences: ["ask me first"],
    baseline: { resting_hr: 68 },
  },
  rules: [
    { ruleId: "TR-001", minRisk: "HIGH", triggers: ["crowd"], approvedAction: "offer calm mode", forbiddenActions: ["auto-alert caregiver"], priority: 10, active: true, aiOverride: false, createdBy: "therapist:T-007", version: 1 },
  ],
  signals: { hr: 96, eda: 4.6, temp: 33.9, movement: "Elevated", hrv: "Low" },
});

const AVATARS = ["#2864E8", "#1FA9A0", "#7C6CF0", "#E0932A", "#DB5A54"];
let _seq = 100;
export function newPatient({ name, age, gender = "—", level = "low", interventions = [], triggers = [], forbidden = [], medications = [], presentingConcern = "", consent = false, signedPatient = false, signedTherapist = false, actor = "Therapist" }) {
  _seq += 1;
  const score = level === "high" ? 0.75 : level === "elevated" ? 0.55 : 0.3;
  return defaults({
    id: `P-${_seq}`, displayId: `PT-0${_seq}`, name: (name || "").trim(), age: Number(age) || null, gender,
    status: "Active", progress: 0, avatar: AVATARS[_seq % AVATARS.length],
    risk: { score, level, supportLevel: level === "high" ? "Level 3 · High" : level === "elevated" ? "Level 2 · Elevated" : "Level 1 · Low", lastUpdated: "just now" },
    treatmentPlan: {
      approvedInterventions: interventions, knownTriggers: triggers, forbiddenInterventions: forbidden,
      communicationPreferences: [], warningSigns: [], environmentalSensitivities: [], escalationPreferences: [], baseline: {},
    },
    medications,
    intake: { presentingConcern, consent, signedPatient, signedTherapist, signedDate: (signedPatient || signedTherapist) ? new Date().toLocaleDateString() : null },
    signals: { hr: 0, eda: 0, temp: 0, movement: "—", hrv: "—" },
    audit: [{ when: "just now", who: actor, change: "Patient created and consented" }],
  });
}

function _hash(s) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
export function patientFromAws(aws = {}) {
  const id = aws.patient_id || aws.id || "unknown";
  const level = (aws.risk_level || "low").toLowerCase();
  const approved = aws.approved_interventions || (aws.preferred_intervention ? [aws.preferred_intervention] : []);
  return defaults({
    id,
    displayId: id,
    name: aws.name || aws.display_name || id,
    age: aws.age || null,
    gender: aws.gender || "—",
    status: aws.status || "Active",
    condition: aws.condition || aws.diagnosis || "",
    progress: Number(aws.progress) || 0,
    avatar: AVATARS[_hash(id) % AVATARS.length],
    risk: {
      score: aws.risk_score ?? 0.3, level,
      supportLevel: level === "high" ? "Level 3 · High" : level === "elevated" ? "Level 2 · Elevated" : "Level 1 · Low",
      lastUpdated: aws.risk_updated || "synced",
    },
    treatmentPlan: {
      approvedInterventions: approved,
      knownTriggers: aws.known_triggers || [],
      forbiddenInterventions: aws.forbidden_interventions || [],
      communicationPreferences: aws.communication_preferences || [],
      warningSigns: aws.warning_signs || [], environmentalSensitivities: [], escalationPreferences: [],
      interventionResources: aws.intervention_resources || {},
      conditionalForbidden: aws.conditional_forbidden || [],
      clinicalGuidance: aws.clinical_guidance || "",
      ptsdSubtype: aws.ptsd_subtype || null,
      baseline: { resting_hr: aws.baseline_heart_rate },
    },
    medications: aws.medications || [],
    avatarS3Key: aws.avatar_s3_key || null,
    caregiver: aws.caregiver || null,
    signals: { hr: 0, eda: 0, temp: 0, movement: "—", hrv: "—" },
    _source: "aws",
  });
}
