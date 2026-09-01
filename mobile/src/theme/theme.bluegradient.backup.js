export const colors = {
  sky0: "#DFF6FF",
  sky1: "#C7ECFF",
  sky2: "#9BD9F7",
  sky3: "#6FB8E8",
  sky4: "#4D87C7",
  sky5: "#345F9C",
  sky6: "#233F70",
  sky7: "#172C50",
  sky8: "#10213E",

  background: "#BFE4F8",
  surface: "rgba(223,246,255,0.42)",
  surfaceAlt: "rgba(223,246,255,0.28)",
  surfaceStrong: "rgba(223,246,255,0.55)",

  textPrimary: "#10294A",
  textSecondary: "#2D5379",
  textMuted: "#3F6485",
  textOnDark: "#EAF7FF",
  textMutedOnDark: "#C7DFF0",

  border: "rgba(225,247,255,0.30)",
  borderStrong: "rgba(225,247,255,0.45)",

  primary: "#3B78C4",
  primarySoft: "rgba(223,246,255,0.42)",
  navy: "#172C50",
  teal: "#4D87C7",
  tealSoft: "rgba(155,217,247,0.34)",

  accentBlue: "#467FC3",
  accentBlueSoft: "rgba(155,217,247,0.34)",
  lavender: "#6E86C8",
  lavenderSoft: "rgba(190,206,245,0.34)",
  pink: "#C25C6B",
  pinkSoft: "rgba(230,170,180,0.30)",

  success: "#2E7D6B",
  successSoft: "rgba(160,226,210,0.34)",
  warning: "#9A6A1E",
  warningSoft: "rgba(246,214,150,0.36)",
  danger: "#B14550",
  dangerSoft: "rgba(240,175,182,0.34)",

  riskLow: "#2E7D6B",
  riskElevated: "#9A6A1E",
  riskHigh: "#B14550",
  riskUnknown: "#3F6485",
};

export const gradients = {
  screen: ["#DEF6FF", "#C5ECFF", "#9FDCF7", "#8CCCF1", "#77BCE8"],
  screenDeep: ["#DEF6FF", "#9FDCF7", "#518AC8", "#345F9B", "#142A4C"],
  glass: ["rgba(215,243,255,0.52)", "rgba(136,195,230,0.42)", "rgba(73,126,183,0.38)"],
  glassSoft: ["rgba(224,247,255,0.48)", "rgba(140,200,234,0.30)"],
  primary: ["#5EA9DF", "#467FC3", "#2B558E"],
  hero: ["#BFE6FB", "#7DBEEA", "#4A7CBB"],
  orb: ["#DFF8FF", "#A8E2F8", "#7DC2ED", "#5A92D2", "#3B68AA", "#274A80"],
  calm: ["#5EA9DF", "#2B558E"],
  ocean: ["#7DC2ED", "#2B558E"],
  violet: ["#8FA8E0", "#3B68AA"],
  sunrise: ["#F0C27B", "#B14550"],
  calmSoft: ["rgba(223,246,255,0.5)", "rgba(155,217,247,0.2)"],
  tabbar: ["rgba(33,62,112,0.92)", "rgba(20,42,76,0.97)"],
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30, xxxl: 40 };
export const radius = { sm: 14, md: 17, lg: 22, xl: 29, pill: 999 };

const ROUNDED = "SF Pro Rounded";
export const fonts = {
  regular: ROUNDED, medium: ROUNDED, semiBold: ROUNDED, bold: ROUNDED, extraBold: ROUNDED,
};

export const type = {
  hero:   { fontFamily: ROUNDED, fontSize: 31, fontWeight: "700", color: colors.textPrimary, letterSpacing: -1.2, lineHeight: 34 },
  h1:     { fontFamily: ROUNDED, fontSize: 27, fontWeight: "700", color: colors.textPrimary, letterSpacing: -1.0, lineHeight: 31 },
  h2:     { fontFamily: ROUNDED, fontSize: 20, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.6, lineHeight: 25 },
  title:  { fontFamily: ROUNDED, fontSize: 16, fontWeight: "600", color: colors.textPrimary, letterSpacing: -0.3 },
  body:   { fontFamily: ROUNDED, fontSize: 15, fontWeight: "400", color: colors.textPrimary, lineHeight: 22 },
  sub:    { fontFamily: ROUNDED, fontSize: 13, fontWeight: "400", color: colors.textSecondary, lineHeight: 19.5 },
  meta:   { fontFamily: ROUNDED, fontSize: 10.5, fontWeight: "800", color: colors.textMuted, letterSpacing: 1.4 },
  metric: { fontFamily: ROUNDED, fontSize: 32, fontWeight: "700", color: colors.textPrimary, letterSpacing: -1.2 },
};

export const shadow = {
  card: {
    shadowColor: "#173D69",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#275286",
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
};

export function riskColor(level) {
  const l = (level || "").toLowerCase();
  if (l === "low" || l === "baseline") return { fg: colors.riskLow, bg: colors.successSoft, label: l === "baseline" ? "Baseline" : "Low" };
  if (l === "elevated" || l === "moderate") return { fg: colors.riskElevated, bg: colors.warningSoft, label: "Elevated" };
  if (l === "high" || l === "critical") return { fg: colors.riskHigh, bg: colors.dangerSoft, label: l === "critical" ? "Critical" : "High" };
  return { fg: colors.riskUnknown, bg: "rgba(223,246,255,0.4)", label: "Unknown" };
}
