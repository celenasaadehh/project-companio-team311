// Deep links, so an iOS Shortcut can open Companio straight into listening.
import { useEffect } from "react";
import { Linking } from "react-native";

// A true always-on wake word is not available to a third-party iOS app: the
// microphone cannot stay open in the background, and on-device wake-word
// detection needs a native model this build does not ship. Rather than fake it
// with continuous recording -- which would be both a battery and a privacy
// problem -- Companio registers a URL scheme.
//
// The patient makes one Shortcut called "Companio" that opens companio://help.
// Saying "Hey Siri, Companio" then launches the app already listening, which is
// the outcome a wake word was wanted for, using the mechanism Apple actually
// sanctions for it.
export const LINK_ROUTES = {
  "help":     { screen: "PatientTabs", params: { screen: "Companio", params: { autoListen: true } } },
  "talk":     { screen: "PatientTabs", params: { screen: "Companio", params: { autoListen: true } } },
  "checkin":  { screen: "PatientTabs", params: { screen: "Companio", params: { autoListen: true } } },
  "grounding": { screen: "GroundingLibrary", params: {} },
  "therapist": { screen: "Messages", params: {} },
};

export function parseDeepLink(url) {
  if (!url) return null;
  const withoutScheme = String(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const path = withoutScheme.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  return LINK_ROUTES[path] || null;
}

export function useDeepLinks(navigationRef) {
  useEffect(() => {
    let alive = true;

    const go = (url) => {
      const route = parseDeepLink(url);
      if (!route || !alive) return;
      // The app may still be mounting when a cold-start link arrives.
      const attempt = (tries) => {
        if (!alive) return;
        if (navigationRef?.current?.isReady?.()) {
          let params = route.params;
          if (params?.params?.autoListen) {
            // Fresh value on every invocation: navigation params only count
            // as changed when they differ, so a second "Hey Siri, Companio"
            // was swallowed as the same params as the first and never
            // re-triggered the listener.
            params = { ...params, params: { ...params.params, wakeAt: Date.now() } };
          }
          navigationRef.current.navigate(route.screen, params);
        } else if (tries > 0) {
          setTimeout(() => attempt(tries - 1), 250);
        }
      };
      attempt(20);
    };

    Linking.getInitialURL().then((url) => url && go(url)).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => go(e?.url));
    return () => { alive = false; try { sub.remove(); } catch {} };
  }, [navigationRef]);
}
