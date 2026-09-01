// Who Companio reaches for when every approved intervention has been tried.
import { Linking } from "react-native";

// Running out of approved interventions is the point where an automated system
// should stop being the answer. What it must not do is invent a sixth technique,
// and what it must not do either is say "contact someone" and leave a person in
// crisis to work out who.
//
// So the ladder is built from real, named contacts the therapist entered, in a
// deliberate order: the person who knows them, then the clinician, then a
// staffed line. Nothing here is a placeholder -- a contact that was never
// configured is not shown, because offering a number that does not connect is
// worse than offering nothing.
export const CONTACT_KIND = {
  CAREGIVER: "caregiver",
  THERAPIST: "therapist",
  HOTLINE: "hotline",
  EMERGENCY: "emergency",
};

const clean = (v) => (typeof v === "string" ? v.trim() : "");

function telHref(number) {
  const n = clean(number).replace(/[^\d+]/g, "");
  return n ? `tel:${n}` : null;
}

// The clinical profile is the only source. Nothing is defaulted, because a
// wrong number in a crisis is a harm the app would have introduced itself.
export function escalationContacts(profile = {}) {
  const out = [];

  const caregiver = profile.caregiver || {};
  if (clean(caregiver.phone)) {
    out.push({
      kind: CONTACT_KIND.CAREGIVER,
      label: clean(caregiver.name) || "Your emergency contact",
      detail: clean(caregiver.relationship) || "Named by you and your therapist",
      href: telHref(caregiver.phone),
      action: "Call",
      icon: "person",
    });
  }

  if (profile.therapist_name || profile.therapist_id) {
    out.push({
      kind: CONTACT_KIND.THERAPIST,
      label: clean(profile.therapist_name) || "Your therapist",
      detail: "Sends a message now, and flags this as urgent",
      href: null,
      action: "Message",
      icon: "medkit",
    });
    if (clean(profile.therapist_phone)) {
      out.push({
        kind: CONTACT_KIND.THERAPIST,
        label: `Call ${clean(profile.therapist_name) || "your therapist"}`,
        detail: "Their practice line",
        href: telHref(profile.therapist_phone),
        action: "Call",
        icon: "call",
      });
    }
  }

  // A staffed crisis line, entered by the therapist for this patient's own
  // country. Numbers differ everywhere and a hardcoded one would be wrong for
  // most people who used it.
  const line = profile.crisis_line || {};
  if (clean(line.phone)) {
    out.push({
      kind: CONTACT_KIND.HOTLINE,
      label: clean(line.name) || "Crisis line",
      detail: clean(line.hours) || "Staffed support line",
      href: telHref(line.phone),
      action: "Call",
      icon: "help-buoy",
    });
  }

  return out;
}

// True when the therapist has configured nobody at all. The interface has to
// say so plainly rather than presenting an empty list as though it were a
// complete one.
export function hasNoContacts(profile) {
  return escalationContacts(profile).length === 0;
}

export async function openContact(contact) {
  if (!contact?.href) return false;
  try {
    const ok = await Linking.canOpenURL(contact.href);
    if (!ok) return false;
    await Linking.openURL(contact.href);
    return true;
  } catch {
    return false;
  }
}
