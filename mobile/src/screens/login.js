// Sign in and account creation.
import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors as C, spacing, radius, type } from "../theme/theme";
import { useApp } from "../state/AppContext";
import { Disclaimer } from "../components/ui";
import { signUp, confirmSignUp, resendConfirmationCode, forgotPassword, confirmForgotPassword } from "../services/auth";
import { stashPendingCredential } from "../services/pending_credential";

export default function Login() {
  const { signIn } = useApp();
  const [mode, setMode] = useState("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [accountType, setAccountType] = useState("patient");
  const [licenceNo, setLicenceNo] = useState("");
  const [licenceBody, setLicenceBody] = useState("");

  const canSignIn = username.trim() && password && !busy;
  const clinician = accountType === "therapist";
  const canSignUp = username.trim() && password.length >= 8 && email.includes("@") && !busy
    && (!clinician || (licenceNo.trim() && licenceBody.trim()));
  const canConfirm = username.trim() && code.trim() && !busy;

  function whatsMissing() {
    if (busy) return null;
    if (mode === "signin") {
      if (!username.trim()) return "Enter your username.";
      if (!password) return "Enter your password.";
      return null;
    }
    if (mode === "signup") {
      if (!username.trim()) return "Choose a username.";
      if (!email.includes("@")) return "Enter a valid email address.";
      if (password.length < 8) return `Password needs at least 8 characters — you have ${password.length}.`;
      if (clinician && !licenceNo.trim()) return "Clinician accounts need a licence number.";
      if (clinician && !licenceBody.trim()) return "Clinician accounts need the issuing body.";
      return null;
    }
    if (mode === "confirm") {
      if (!username.trim()) return "Enter your username.";
      if (!code.trim()) return "Enter the 6-digit code from your email.";
      return null;
    }
    if (mode === "reset") {
      if (!code.trim()) return "Enter the code we emailed you.";
      if (password.length < 8) return "New password needs at least 8 characters.";
      return null;
    }
    if (mode === "forgot" && !username.trim()) return "Enter your username.";
    return null;
  }

  function humanError(e) {
    const m = String(e?.message || "");
    if (/UsernameExists/i.test(m)) return "That username is already taken.";
    if (/InvalidPassword/i.test(m)) return "Password must be at least 8 characters and include a number, an uppercase and a lowercase letter.";
    if (/InvalidParameter/i.test(m)) return "Please check the details you entered.";
    if (/CodeMismatch/i.test(m)) return "That confirmation code is not correct.";
    if (/ExpiredCode/i.test(m)) return "That code expired — request a new one.";
    if (/LimitExceeded|TooManyRequests/i.test(m)) return "Too many attempts. Wait a minute and try again.";
    if (/NotAuthorized|Incorrect/i.test(m)) return "Incorrect username or password.";
    if (/UserNotFound/i.test(m)) return "No account found for that username.";
    if (/UserNotConfirmed/i.test(m)) return "This account isn't confirmed yet — enter the code we emailed you.";
    if (/Network|fetch/i.test(m)) return "Network error — check your connection.";
    return m || "Something went wrong.";
  }

  async function run(fn, onOk) {
    Keyboard.dismiss();
    setBusy(true); setError(null); setNotice(null);
    try { const r = await fn(); onOk?.(r); }
    catch (e) { setError(humanError(e)); }
    finally { setBusy(false); }
  }

  const onSignUp = () => run(
    async () => {
      const r = await signUp({ username, password, email, name: fullName });
      if (clinician) {
        await stashPendingCredential({
          username: username.trim(),
          licence_number: licenceNo.trim(),
          licence_body: licenceBody.trim(),
        });
      }
      return r;
    },
    () => {
      setMode("confirm");
      setNotice(clinician
        ? `We emailed a 6-digit code to ${email.trim()}. After you sign in, Companio will ask you to photograph your licence.`
        : `We emailed a 6-digit code to ${email.trim()}.`);
    }
  );

  const onConfirm = () => run(
    () => confirmSignUp(username, code),
    () => { setMode("signin"); setCode(""); setNotice("Account confirmed — you can sign in now."); }
  );

  const onResend = () => run(() => resendConfirmationCode(username), () => setNotice("A new code is on its way."));

  const onForgot = () => run(
    () => forgotPassword(username),
    () => { setMode("reset"); setNotice("We emailed you a reset code."); }
  );

  const onReset = () => run(
    () => confirmForgotPassword(username, code, password),
    () => { setMode("signin"); setCode(""); setPassword(""); setNotice("Password changed — sign in with it now."); }
  );

  async function onSignIn() {
    if (!canSignIn) return;
    Keyboard.dismiss();
    setBusy(true); setError(null);
    try {
      await signIn(username, password);
    } catch (e) {
      const m = String(e?.message || "");
      setError(
        /NotAuthorized|Incorrect/i.test(m) ? "Incorrect username or password." :
        /UserNotFound/i.test(m) ? "No account found for that username." :
        /Network|fetch/i.test(m) ? "Network error — check your connection." :
        m || "Sign-in failed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 26, paddingTop: 38, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ flex: 1, justifyContent: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 38 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: C.navy, alignItems: "center", justifyContent: "center" }}><Ionicons name="pulse" size={20} color="#fff" /></View>
            <Text style={{ marginLeft: 10, fontSize: 18, fontWeight: "760", color: C.textPrimary, letterSpacing: -0.4 }}>Companio</Text>
          </View>

          <Text style={[type.hero, { maxWidth: 330 }]}>
            {mode === "signup" ? "Create your Companio account."
              : mode === "confirm" ? "Check your email."
              : mode === "forgot" ? "Reset your password."
              : mode === "reset" ? "Choose a new password."
              : "Care decisions with the therapist in control."}
          </Text>
          <Text style={[type.body, { color: C.textSecondary, marginTop: 13, maxWidth: 330 }]}>
            {mode === "signup" ? (clinician
                ? "Clinician accounts require a professional licence. Enter it here and photograph the document after you sign in."
                : "Patients: your therapist links your care plan to this account after you sign up.")
              : mode === "confirm" ? "Enter the 6-digit code we emailed you to finish setting up your account."
              : mode === "forgot" ? "Enter your username and we'll email you a reset code."
              : mode === "reset" ? "Enter the code we emailed you and pick a new password."
              : "Sign in with your Companio account. Your role — patient or therapist — is set by your account."}
          </Text>

          <View style={{ marginTop: 28 }}>
            <Field icon="person-outline" value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" autoCorrect={false} />

            {mode === "signup" ? (
              <>
                <Field icon="mail-outline" value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
                <Field icon="text-outline" value={fullName} onChangeText={setFullName} placeholder="Full name (optional)" />

                <Text style={[type.meta, { marginTop: 14, marginBottom: 8 }]}>I AM SIGNING UP AS</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[
                    { id: "patient", label: "Someone seeking support", icon: "heart-outline" },
                    { id: "therapist", label: "A clinician", icon: "medkit-outline" },
                  ].map((o) => {
                    const on = accountType === o.id;
                    return (
                      <TouchableOpacity key={o.id} onPress={() => setAccountType(o.id)} activeOpacity={0.8}
                        style={{ flex: 1, borderWidth: 1.5, borderRadius: radius.md, padding: 12,
                                 borderColor: on ? C.primary : C.border,
                                 backgroundColor: on ? C.primarySoft : "transparent" }}>
                        <Ionicons name={o.icon} size={18} color={on ? C.primary : C.textMuted} />
                        <Text style={{ marginTop: 6, fontSize: 13, fontWeight: on ? "700" : "500",
                                       color: on ? C.primary : C.textSecondary }}>{o.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {clinician ? (
                  <View style={{ marginTop: 16 }}>
                    <Text style={[type.meta, { marginBottom: 4 }]}>PROFESSIONAL CREDENTIALS — REQUIRED</Text>
                    <Text style={[type.sub, { marginBottom: 10 }]}>
                      A clinician account decides what an automated system says to a patient in crisis,
                      so Companio asks for a licence before that account is used.
                    </Text>
                    <Field icon="ribbon-outline" value={licenceNo} onChangeText={setLicenceNo}
                      placeholder="Licence number" autoCapitalize="characters" autoCorrect={false} />
                    <Field icon="business-outline" value={licenceBody} onChangeText={setLicenceBody}
                      placeholder="Issuing body" />
                    <Text style={[type.meta, { marginTop: 2 }]}>
                      You will photograph the document itself on first sign-in.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}

            {mode === "confirm" || mode === "reset" ? (
              <Field icon="key-outline" value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" />
            ) : null}

            {mode !== "confirm" && mode !== "forgot" ? (
              <Field icon="lock-closed-outline" value={password} onChangeText={setPassword}
                placeholder={mode === "reset" ? "New password" : "Password"} secureTextEntry
                onSubmitEditing={mode === "signup" ? onSignUp : mode === "reset" ? onReset : onSignIn} returnKeyType="go" />
            ) : null}
          </View>

          {notice ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, backgroundColor: C.successSoft, borderRadius: radius.md, padding: 12 }}>
              <Ionicons name="checkmark-circle" size={18} color={C.success} style={{ marginRight: 8 }} />
              <Text style={{ color: C.success, flex: 1, fontSize: 13.5 }}>{notice}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14, backgroundColor: C.dangerSoft, borderRadius: radius.md, padding: 12 }}>
              <Ionicons name="alert-circle" size={18} color={C.danger} style={{ marginRight: 8 }} />
              <Text style={{ color: C.danger, flex: 1, fontSize: 13.5 }}>{error}</Text>
            </View>
          ) : null}

          {(() => {
            const cfg = {
              signin:  { label: "Sign in",           on: onSignIn,  ok: canSignIn },
              signup:  { label: "Create account",    on: onSignUp,  ok: canSignUp },
              confirm: { label: "Confirm account",   on: onConfirm, ok: canConfirm },
              forgot:  { label: "Email me a code",   on: onForgot,  ok: username.trim() && !busy },
              reset:   { label: "Set new password",  on: onReset,   ok: canConfirm && password.length >= 8 },
            }[mode];
            const missing = whatsMissing();
            return (
              <>
              {missing ? (
                <Text style={[type.meta, { marginTop: 16, textAlign: "center", color: C.textSecondary }]}>
                  {missing}
                </Text>
              ) : null}
              <TouchableOpacity onPress={cfg.on} disabled={!cfg.ok} activeOpacity={0.82}
                style={{ marginTop: 12, backgroundColor: cfg.ok ? C.navy : C.border, borderRadius: radius.pill, paddingVertical: 16, alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{cfg.label}</Text>}
              </TouchableOpacity>
              </>
            );
          })()}

          <View style={{ flexDirection: "row", justifyContent: "center", flexWrap: "wrap", marginTop: 18 }}>
            {mode === "signin" ? (
              <>
                <LinkBtn label="Create an account" onPress={() => { setMode("signup"); setError(null); setNotice(null); }} />
                <LinkBtn label="Forgot password" onPress={() => { setMode("forgot"); setError(null); setNotice(null); }} />
              </>
            ) : mode === "confirm" ? (
              <>
                <LinkBtn label="Resend code" onPress={onResend} />
                <LinkBtn label="Back to sign in" onPress={() => { setMode("signin"); setError(null); }} />
              </>
            ) : (
              <LinkBtn label="Back to sign in" onPress={() => { setMode("signin"); setError(null); setNotice(null); }} />
            )}
          </View>

          <Text style={[type.meta, { textAlign: "center", marginTop: 14 }]}>Secured by Amazon Cognito · your password is never stored on this device.</Text>
          <Disclaimer />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const LinkBtn = ({ label, onPress }) => (
  <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
    <Text style={{ color: C.primary, fontWeight: "600", fontSize: 14 }}>{label}</Text>
  </TouchableOpacity>
);

const Field = ({ icon, ...props }) => <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.borderStrong, marginBottom: 8 }}><Ionicons name={icon} size={18} color={C.textMuted} /><TextInput {...props} placeholderTextColor={C.textMuted} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 10, fontSize: 16, color: C.textPrimary }} /></View>;
