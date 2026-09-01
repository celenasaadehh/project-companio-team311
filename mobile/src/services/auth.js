// Cognito sign-in, token storage and refresh.
import * as SecureStore from "expo-secure-store";
import { COGNITO_CLIENT_ID, COGNITO_IDP_ENDPOINT } from "../config";

const K_ACCESS = "companio.accessToken";
const K_ID = "companio.idToken";
const K_REFRESH = "companio.refreshToken";
const K_EXP = "companio.expiresAt";

function b64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  try {
    if (typeof atob === "function") return atob(s);
  } catch {}
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let output = "";
  s = s.replace(/[^A-Za-z0-9+/=]/g, "");
  for (let i = 0; i < s.length; ) {
    const e1 = chars.indexOf(s.charAt(i++));
    const e2 = chars.indexOf(s.charAt(i++));
    const e3 = chars.indexOf(s.charAt(i++));
    const e4 = chars.indexOf(s.charAt(i++));
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    output += String.fromCharCode(c1);
    if (e3 !== 64) output += String.fromCharCode(c2);
    if (e4 !== 64) output += String.fromCharCode(c3);
  }
  return output;
}

export function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(b64urlDecode(payload));
  } catch {
    return null;
  }
}

async function cognito(target, body) {
  const res = await fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.__type || `Cognito ${target} failed`;
    const err = new Error(msg);
    err.code = data.__type;
    throw err;
  }
  return data;
}

async function storeTokens(auth) {
  const expiresAt = Date.now() + (auth.ExpiresIn || 3600) * 1000;
  await SecureStore.setItemAsync(K_ACCESS, auth.AccessToken);
  await SecureStore.setItemAsync(K_ID, auth.IdToken);
  if (auth.RefreshToken) await SecureStore.setItemAsync(K_REFRESH, auth.RefreshToken);
  await SecureStore.setItemAsync(K_EXP, String(expiresAt));
}

export async function login(username, password) {
  const data = await cognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: { USERNAME: (username || "").trim(), PASSWORD: password },
  });
  if (!data.AuthenticationResult) {
    throw new Error(data.ChallengeName ? `Sign-in needs: ${data.ChallengeName}` : "Sign-in failed");
  }
  await storeTokens(data.AuthenticationResult);
  return currentUser();
}

export async function logout() {
  await Promise.all([
    SecureStore.deleteItemAsync(K_ACCESS),
    SecureStore.deleteItemAsync(K_ID),
    SecureStore.deleteItemAsync(K_REFRESH),
    SecureStore.deleteItemAsync(K_EXP),
  ]);
}

export async function refreshSession() {
  const refresh = await SecureStore.getItemAsync(K_REFRESH);
  if (!refresh) return false;
  try {
    const data = await cognito("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refresh },
    });
    if (!data.AuthenticationResult) return false;
    await storeTokens({ ...data.AuthenticationResult, RefreshToken: refresh });
    return true;
  } catch {
    return false;
  }
}

export async function getValidAccessToken() {
  const [token, expStr] = await Promise.all([
    SecureStore.getItemAsync(K_ACCESS),
    SecureStore.getItemAsync(K_EXP),
  ]);
  if (!token) return null;
  const exp = Number(expStr || 0);
  if (Date.now() < exp - 60000) return token;
  const ok = await refreshSession();
  return ok ? SecureStore.getItemAsync(K_ACCESS) : null;
}

export async function getIdToken() {
  return SecureStore.getItemAsync(K_ID);
}

export async function restoreSession() {
  const token = await getValidAccessToken();
  if (!token) return null;
  return currentUser();
}

export async function currentUser() {
  const idToken = (await SecureStore.getItemAsync(K_ID)) || (await SecureStore.getItemAsync(K_ACCESS));
  if (!idToken) return null;
  const c = decodeJwt(idToken) || {};
  const groups = c["cognito:groups"] || [];
  const role = groups.includes("THERAPIST") ? "therapist" : groups.includes("PATIENT") ? "patient" : null;
  return {
    sub: c.sub,
    username: c["cognito:username"] || c.username || c.email,
    name: c.name || c.given_name || null,
    email: c.email,
    groups,
    role,
  };
}

export async function isSignedIn() {
  return !!(await getValidAccessToken());
}

export async function signUp({ username, password, email, role = "PATIENT", name }) {
  const u = (username || "").trim();
  if (!u) throw new Error("Username is required");
  if (!email || !email.includes("@")) throw new Error("A valid email is required");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");

  const attrs = [{ Name: "email", Value: email.trim() }];
  if (name && name.trim()) attrs.push({ Name: "name", Value: name.trim() });

  await cognito("SignUp", {
    ClientId: COGNITO_CLIENT_ID,
    Username: u,
    Password: password,
    UserAttributes: attrs,
  });
  return { username: u, email: email.trim(), role };
}

export async function confirmSignUp(username, code) {
  const u = (username || "").trim();
  const c = (code || "").trim();
  if (!u || !c) throw new Error("Username and confirmation code are required");
  await cognito("ConfirmSignUp", {
    ClientId: COGNITO_CLIENT_ID,
    Username: u,
    ConfirmationCode: c,
  });
  return true;
}

export async function resendConfirmationCode(username) {
  const u = (username || "").trim();
  if (!u) throw new Error("Username is required");
  await cognito("ResendConfirmationCode", { ClientId: COGNITO_CLIENT_ID, Username: u });
  return true;
}

export async function forgotPassword(username) {
  const u = (username || "").trim();
  if (!u) throw new Error("Username is required");
  await cognito("ForgotPassword", { ClientId: COGNITO_CLIENT_ID, Username: u });
  return true;
}

export async function confirmForgotPassword(username, code, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  await cognito("ConfirmForgotPassword", {
    ClientId: COGNITO_CLIENT_ID,
    Username: (username || "").trim(),
    ConfirmationCode: (code || "").trim(),
    Password: newPassword,
  });
  return true;
}
