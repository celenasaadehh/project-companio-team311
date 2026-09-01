// Local and push notifications.
import { Platform } from "react-native";

import { reportSyncFailure } from "./errors";

import { awsApiCall } from "./engine";

let Notifications = null;
try {
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

export const isNotifyAvailable = !!Notifications;

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function requestNotifyPermission() {
  if (!Notifications) return { ok: false, reason: "unavailable" };
  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return { ok: status === "granted", reason: status };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export async function notifyNow(title, body, seconds = 0, data = {}) {
  if (!Notifications) return false;
  const perm = await requestNotifyPermission();
  if (!perm.ok) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title, body, sound: true, data,
        ...(data?.categoryIdentifier ? { categoryIdentifier: data.categoryIdentifier } : {}),
      },
      trigger: seconds > 0
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds }
        : null,
    });
    return true;
  } catch (e) {
    reportSyncFailure("notification", e, {
      critical: true, detail: `${title} — ${String(e?.message || e)}`,
    });
    return false;
  }
}

export async function scheduleDaily(title, body, hour, minute = 0) {
  if (!Notifications) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
    });
  } catch {
    return null;
  }
}

export async function scheduleAt(title, body, date) {
  if (!Notifications || !(date instanceof Date) || isNaN(date)) return null;
  if (date.getTime() <= Date.now()) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
    });
  } catch {
    return null;
  }
}

export async function cancelScheduled(id) {
  if (!Notifications || !id) return;
  try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
}

export async function cancelAllScheduled() {
  if (!Notifications) return;
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
}

export async function listScheduled() {
  if (!Notifications) return [];
  try { return await Notifications.getAllScheduledNotificationsAsync(); } catch { return []; }
}

export async function registerForPushToken() {
  if (!Notifications) return null;
  try {
    const perm = await requestNotifyPermission();
    if (!perm.ok) return null;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Companio",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const t = await Notifications.getExpoPushTokenAsync();
    return t?.data || null;
  } catch {
    return null;
  }
}

// Cross-user pushes go through the backend: the server resolves who the
// recipient is and where their device lives. The phone never handles another
// user's push token again, and every attempt lands in a delivery ledger.
export async function sendPushViaServer(patientId, to, title, body, data = {}) {
  try {
    const r = await awsApiCall("/notify", { patient_id: patientId, to, title, body, data }, "POST");
    return { ok: !!r?.delivered, reason: r?.status || "unknown" };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
