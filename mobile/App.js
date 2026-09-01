// =============================================================================
// Companio — PTSD-support prototype (patient + therapist)
// Real multi-screen navigation. The design system lives in src/theme + src/components.
// Screens live in src/screens, wired by src/navigation/RootNavigator.
//
// >>> Backend: set API_BASE_URL in src/services/engine.js to your Mac's Wi-Fi IP
//     (System Settings → Wi-Fi → Details → IP Address), keeping :8000.
//     Phone + Mac on the same Wi-Fi. The app runs fully offline with labelled
//     demo data if the backend is unreachable.
// =============================================================================
import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from "@react-navigation/native";
import { colors as C } from "./src/theme/theme";
import { AppProvider } from "./src/state/AppContext";
import RootNavigator from "./src/navigation/RootNavigator";
import { useDeepLinks } from "./src/services/deeplink";

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.background, card: C.surface, text: C.textPrimary, primary: C.primary, border: C.border },
};

// No font loading step: the app uses the iOS system font (SF Pro), which is
// always available. That removes the startup loading flash the Google-Fonts
// approach needed, and a network dependency at launch.
const navigationRef = createNavigationContainerRef();

export default function App() {
  // Lets an iOS Shortcut ("Hey Siri, Companio") open the app already listening.
  useDeepLinks({ current: navigationRef });

  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <NavigationContainer theme={navTheme} ref={navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}
