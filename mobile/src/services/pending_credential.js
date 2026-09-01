// Holds a clinician's licence details between sign-up and first sign-in.
import * as SecureStore from "expo-secure-store";

const KEY = "companio.pending_credential";

// The identity table needs an authenticated caller, and sign-up has none yet.
// The details are kept on the device only until they are submitted with the
// document photograph, then cleared.
export async function stashPendingCredential(cred) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ ...cred, stashed_at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export async function pendingCredential(username) {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // Belongs to whoever signed up on this device, not to whoever signs in next.
    if (username && c.username && c.username !== username) return null;
    return c;
  } catch {
    return null;
  }
}

export async function clearPendingCredential() {
  try { await SecureStore.deleteItemAsync(KEY); } catch {}
}
