export const AWS_REGION =
  process.env.EXPO_PUBLIC_AWS_REGION || "us-east-1";

export const AWS_API_BASE_URL =
  process.env.EXPO_PUBLIC_AWS_API_URL ||
  "https://l4irn73k01.execute-api.us-east-1.amazonaws.com";

export const COGNITO_USER_POOL_ID =
  process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || "us-east-1_oH6wx6AFd";
export const COGNITO_CLIENT_ID =
  process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "6gp7272venghtl4o74ksqb7lr1";
export const COGNITO_IDP_ENDPOINT =
  `https://cognito-idp.${AWS_REGION}.amazonaws.com/`;

function engineHostFromMetro() {
  // The URL this very bundle was fetched from is the one address PROVEN
  // reachable from this device -- the constants below can be absent in a
  // dev-client build, and the 127.0.0.1 fallback then points a physical
  // phone at itself, silently sending every decision to the AWS fallback.
  try {
    const { NativeModules } = require("react-native");
    const scriptURL = NativeModules?.SourceCode?.scriptURL;
    const host = String(scriptURL || "").split("://").pop().split("/")[0].split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") return host;
  } catch {}
  try {
    const Constants = require("expo-constants").default;
    const hostUri =
      Constants?.expoConfig?.hostUri ||
      Constants?.expoGoConfig?.debuggerHost ||
      Constants?.manifest2?.extra?.expoGo?.debuggerHost ||
      Constants?.manifest?.debuggerHost;
    const host = String(hostUri || "").split("://").pop().split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") return host;
  } catch {}
  return null;
}

const ENGINE_PORT = 8000;
const derivedHost = engineHostFromMetro();

export const THERAPIST_ENGINE_URL =
  process.env.EXPO_PUBLIC_THERAPIST_ENGINE_URL ||
  (derivedHost ? `http://${derivedHost}:${ENGINE_PORT}` : "http://127.0.0.1:8000");
