// Therapist credential upload and verification status.
import React, { useState, useEffect } from "react";
import { View, Text, TextInput, Alert, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, SectionTitle, Row, Btn, Pill, Disclaimer } from "../components/ui";
import { uploadImage } from "../services/media";
import { saveIdentity, getIdentity } from "../services/engine";
import { useApp } from "../state/AppContext";
import { pendingCredential, clearPendingCredential } from "../services/pending_credential";

// A therapist account controls another person's clinical record: their
// triggers, their approved interventions, and what an automated system will
// say to them during a crisis. Letting anyone self-declare that role is the
// single largest trust gap in a system like this.
//
// This build cannot verify a licence automatically -- that requires a registry
// integration or a human reviewer, and neither exists here. What it CAN do is
// refuse to let an unverified account act as though it were verified: the
// credential is captured, the account is marked pending, and the status is
// visible to the therapist and stored on the identity record.
//
// The status is deliberately NOT enforced client-side as a hard block. A check
// that only exists in the app is not a security control -- a modified client
// would simply skip it. Real enforcement belongs in the Lambda authorizer, and
// is recorded as a required next step rather than faked here.
export const VERIFICATION = {
  NONE: "none",
  PENDING: "pending_review",
  VERIFIED: "verified",
  REJECTED: "rejected",
};

export function LicenseVerify({ navigation }) {
  const { authUser, currentPatientId } = useApp();
  const therapistId = authUser?.username || authUser?.sub;

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState(null);
  const [licenceNo, setLicenceNo] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cameraRef = React.useRef(null);

  useEffect(() => {
    let alive = true;
    // Prefill whatever was entered at sign-up so it is not typed twice.
    pendingCredential(therapistId).then((c) => {
      if (!alive || !c) return;
      setLicenceNo((v) => v || c.licence_number || "");
      setBody((v) => v || c.licence_body || "");
    });
    getIdentity(therapistId)
      .then((r) => {
        const item = r?.item || r;
        if (alive) setStatus(item?.verification_status || VERIFICATION.NONE);
      })
      .catch(() => { if (alive) setStatus(VERIFICATION.NONE); });
    return () => { alive = false; };
  }, [therapistId]);

  async function submit() {
    if (!cameraRef.current || busy) return;
    if (!licenceNo.trim() || !body.trim()) {
      setError("Enter your licence number and the issuing body before photographing the document.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
      if (!pic?.uri) throw new Error("No photograph was captured.");

      const { s3_key } = await uploadImage(therapistId, pic.uri, "image/jpeg");

      // Credential details are identifying information about the clinician, so
      // they go to the identity table alongside their name -- never into any
      // patient's clinical record.
      await saveIdentity({
        patient_id: therapistId,
        role: "therapist",
        licence_number: licenceNo.trim(),
        licence_body: body.trim(),
        licence_document_s3_key: s3_key,
        verification_status: VERIFICATION.PENDING,
        verification_submitted_at: new Date().toISOString(),
      });

      await clearPendingCredential();
      setStatus(VERIFICATION.PENDING);
      Alert.alert(
        "Submitted for review",
        "Your credential has been recorded and your account is marked as pending review. You can continue using Companio meanwhile.",
      );
    } catch (e) {
      setError(e?.message || "The credential could not be submitted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const badge = {
    [VERIFICATION.VERIFIED]: { text: "Verified", fg: C.success, bg: C.successSoft },
    [VERIFICATION.PENDING]: { text: "Pending review", fg: C.warning, bg: C.warningSoft },
    [VERIFICATION.REJECTED]: { text: "Not accepted", fg: C.danger, bg: C.dangerSoft },
    [VERIFICATION.NONE]: { text: "Not submitted", fg: C.textSecondary, bg: C.surfaceStrong },
  }[status || VERIFICATION.NONE];

  return (
    <Screen>
      <AppHeader eyebrow="CREDENTIALS" title="Professional verification"
        subtitle="Companio accounts that manage patient care plans should be held by licensed clinicians."
        onBack={() => navigation.goBack()} />

      <Card accent={status === VERIFICATION.VERIFIED ? C.success : C.warning}>
        <Row icon={status === VERIFICATION.VERIFIED ? "shield-checkmark" : "shield-outline"}
          iconFg={badge.fg} iconBg={badge.bg}
          title="Your verification status"
          right={<Pill text={badge.text} fg={badge.fg} bg={badge.bg} />} />
      </Card>

      {status === VERIFICATION.VERIFIED ? (
        <Card>
          <Row icon="checkmark-circle" iconFg={C.success} iconBg={C.successSoft}
            title="Your credential has been accepted"
            subtitle="Nothing further is needed." />
        </Card>
      ) : (
        <>
          <SectionTitle sub="Both fields are required before the document is captured.">
            Licence details
          </SectionTitle>
          <Card>
            <Text style={type.meta}>LICENCE NUMBER</Text>
            <TextInput value={licenceNo} onChangeText={setLicenceNo}
              placeholder="As printed on your licence" placeholderTextColor={C.textMuted}
              autoCapitalize="characters" autoCorrect={false}
              style={{ paddingVertical: 12, fontSize: 15, color: C.textPrimary,
                       borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 12 }} />
            <Text style={type.meta}>ISSUING BODY</Text>
            <TextInput value={body} onChangeText={setBody}
              placeholder="e.g. Lebanese Order of Psychologists"
              placeholderTextColor={C.textMuted}
              style={{ paddingVertical: 12, fontSize: 15, color: C.textPrimary }} />
          </Card>

          <SectionTitle sub="Photograph the licence or practising certificate itself.">
            Document
          </SectionTitle>
          {!permission ? (
            <ActivityIndicator color={C.primary} />
          ) : !permission.granted ? (
            <Card>
              <Row icon="camera" iconFg={C.primary} iconBg={C.primarySoft}
                title="Camera access needed"
                subtitle="Used only to photograph your credential." />
              <Btn label="Allow camera" icon="camera" onPress={requestPermission} />
            </Card>
          ) : (
            <Card>
              <View style={{ height: 300, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#000" }}>
                <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
              </View>
              {error ? <Text style={[type.sub, { color: C.danger, marginTop: 10 }]}>{error}</Text> : null}
              <View style={{ marginTop: spacing.md }}>
                <Btn label={busy ? "Submitting…" : "Photograph and submit"} icon="document-text"
                  disabled={busy} onPress={submit} />
              </View>
            </Card>
          )}
        </>
      )}

      <Card>
        <Row icon="information-circle" iconFg={C.textSecondary} iconBg={C.surfaceStrong}
          title="How this is handled"
          subtitle="Your document is stored encrypted, listed against your own record and never against a patient's. Verification is reviewed by a person; this build does not check a licence registry automatically." />
      </Card>

      <Disclaimer text="A Companio therapist account can define what an automated system says to a patient in crisis. Credential checks exist because that responsibility should sit with a licensed clinician." />
    </Screen>
  );
}
