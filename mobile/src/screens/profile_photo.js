// Takes a profile photo and stores it with identity, not clinical data.
import React, { useState, useRef } from "react";
import { View, Text, ActivityIndicator, Alert } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { Screen, AppHeader, Card, Row, Btn, Disclaimer } from "../components/ui";
import { uploadImage } from "../services/media";
import { saveIdentity } from "../services/engine";
import { useApp } from "../state/AppContext";

export function ProfilePhoto({ navigation }) {
  const { currentPatientId, authUser, refreshMyPatients } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cameraRef = useRef(null);

  async function capture() {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (!pic?.uri) throw new Error("No photo was captured.");

      const { s3_key } = await uploadImage(currentPatientId, pic.uri, "image/jpeg");

      await saveIdentity({
        patient_id: currentPatientId,
        avatar_s3_key: s3_key,
        avatar_updated_at: new Date().toISOString(),
      });

      await refreshMyPatients?.();
      Alert.alert("Photo saved", "Your profile photo has been updated.");
      navigation.goBack();
    } catch (e) {
      setError(e?.message || "The photo could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!permission) {
    return (
      <Screen>
        <AppHeader title="Profile photo" onBack={() => navigation.goBack()} />
        <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <AppHeader title="Profile photo" subtitle="Take a photo for your profile"
          onBack={() => navigation.goBack()} />
        <Card>
          <Row icon="camera" iconFg={C.primary} iconBg={C.primarySoft}
            title="Camera access needed"
            subtitle="Companio needs the camera to take your profile photo. It is used for nothing else here." />
          <Btn label="Allow camera" icon="camera" onPress={requestPermission} />
        </Card>
        <Disclaimer />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader title="Profile photo" subtitle="Line yourself up and tap the button"
        onBack={() => navigation.goBack()} />

      <Card>
        <View style={{ height: 380, borderRadius: radius.md, overflow: "hidden",
                       backgroundColor: "#000" }}>
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        </View>

        {error ? (
          <Text style={[type.sub, { color: C.danger, marginTop: 10 }]}>{error}</Text>
        ) : null}

        <View style={{ marginTop: spacing.md }}>
          <Btn label={busy ? "Saving…" : "Take photo"} icon="camera"
            disabled={busy} onPress={capture} />
        </View>
        {busy ? <ActivityIndicator color={C.primary} style={{ marginTop: 10 }} /> : null}
      </Card>

      <Card>
        <Row icon="lock-closed" iconFg={C.success} iconBg={C.successSoft}
          title="Where this is kept"
          subtitle="Your photo is stored encrypted, listed against your name rather than your clinical records, and is only visible to you and your therapist." />
      </Card>

      <Disclaimer />
    </Screen>
  );
}
