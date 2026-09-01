// Notification action buttons and inline reply.
let Notifications = null;
try { Notifications = require("expo-notifications"); } catch { Notifications = null; }

export const CATEGORY = {
  CHECK_IN: "companio.checkin",
  SUPPORT: "companio.support",
  THERAPIST_MSG: "companio.therapist",
};

export const ACTION = {
  IM_OK: "IM_OK",
  NEED_HELP: "NEED_HELP",
  REPLY: "REPLY",
  OPEN: "OPEN",
  HELPED: "HELPED",
  DIDNT_HELP: "DIDNT_HELP",
};

export async function registerNotificationActions() {
  if (!Notifications?.setNotificationCategoryAsync) return false;
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY.CHECK_IN, [
      { identifier: ACTION.IM_OK, buttonTitle: "I'm okay",
        options: { opensAppToForeground: false } },
      { identifier: ACTION.NEED_HELP, buttonTitle: "I need help",
        options: { opensAppToForeground: true } },
      { identifier: ACTION.REPLY, buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Tell Companio what's happening…" },
        options: { opensAppToForeground: false } },
    ]);

    await Notifications.setNotificationCategoryAsync(CATEGORY.SUPPORT, [
      { identifier: ACTION.HELPED, buttonTitle: "That helped",
        options: { opensAppToForeground: false } },
      { identifier: ACTION.DIDNT_HELP, buttonTitle: "Didn't help",
        options: { opensAppToForeground: true } },
      { identifier: ACTION.REPLY, buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Say what's going on…" },
        options: { opensAppToForeground: false } },
    ]);

    await Notifications.setNotificationCategoryAsync(CATEGORY.THERAPIST_MSG, [
      { identifier: ACTION.REPLY, buttonTitle: "Reply",
        textInput: { submitButtonTitle: "Send", placeholder: "Message your therapist…" },
        options: { opensAppToForeground: false } },
      { identifier: ACTION.OPEN, buttonTitle: "Open",
        options: { opensAppToForeground: true } },
    ]);
    return true;
  } catch {
    return false;
  }
}

export function onNotificationAction(handler) {
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    try {
      const action = response?.actionIdentifier || ACTION.OPEN;
      const text = response?.userText || null;
      const data = response?.notification?.request?.content?.data || {};
      handler({ action, text, data });
    } catch {
    }
  });
  return () => { try { sub.remove(); } catch {} };
}
