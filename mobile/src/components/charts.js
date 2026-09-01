// Charts drawn from real recorded values.
import React from "react";
import { View, Text } from "react-native";
import Svg, { Polyline, Polygon, Line, Circle, Rect, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors as C, type } from "../theme/theme";

function toPoints(data, W, H, pad) {
  if (!data || data.length === 0) return "";
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const stepX = (W - pad * 2) / (data.length - 1 || 1);
  return data
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = H - pad - ((v - min) / span) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TrendChart({ data, color = C.primary, height = 120, label, avg, unit }) {
  const W = 320, H = height, pad = 12;
  const pts = toPoints(data, W, H, pad);
  const grid = [0.25, 0.5, 0.75];
  return (
    <View>
      {(label || avg != null) && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={type.sub}>{label}</Text>
          {avg != null ? <Text style={{ fontWeight: "700", color: C.textPrimary }}>{avg}{unit ? ` ${unit}` : ""}</Text> : null}
        </View>
      )}
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {grid.map((g, i) => (
          <Line key={i} x1={pad} y1={pad + g * (H - pad * 2)} x2={W - pad} y2={pad + g * (H - pad * 2)} stroke="#EDF1F7" strokeWidth="1" />
        ))}
        <Polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data && data.length ? (() => {
          const last = pts.split(" ").pop().split(",");
          return <Circle cx={last[0]} cy={last[1]} r="4" fill={color} />;
        })() : null}
      </Svg>
    </View>
  );
}

export function Sparkline({ data, color = C.primary, width = 74, height = 26 }) {
  const pts = toPoints(data, width, height, 3);
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

export function RiskGauge({ score = 0, thresholds = [0.4, 0.7] }) {
  const W = 320, H = 30, pad = 8;
  const x = pad + Math.max(0, Math.min(1, score)) * (W - pad * 2);
  return (
    <Svg width="100%" height={H + 16} viewBox={`0 0 ${W} ${H + 16}`}>
      <Rect x={pad} y={10} width={W - pad * 2} height={10} rx={5} fill="#EDF1F7" />
      <Rect x={pad} y={10} width={x - pad} height={10} rx={5} fill={score >= 0.7 ? C.riskHigh : score >= 0.4 ? C.riskElevated : C.riskLow} />
      {thresholds.map((t, i) => {
        const tx = pad + t * (W - pad * 2);
        return <Line key={i} x1={tx} y1={6} x2={tx} y2={24} stroke={C.textMuted} strokeWidth="1.5" />;
      })}
      <Circle cx={x} cy={15} r="7" fill="#fff" stroke={score >= 0.7 ? C.riskHigh : score >= 0.4 ? C.riskElevated : C.riskLow} strokeWidth="2.5" />
    </Svg>
  );
}

export function AreaChart({ data, color = C.primary, height = 150, label, unit, avg }) {
  const W = 320, H = height, pad = 14;
  if (!data || data.length === 0) {
    return (
      <View style={{ height: H, alignItems: "center", justifyContent: "center" }}>
        <Text style={type.sub}>No data yet</Text>
      </View>
    );
  }
  const pts = toPoints(data, W, H, pad);
  const first = pts.split(" ")[0].split(",");
  const last = pts.split(" ").pop().split(",");
  const areaPts = `${first[0]},${H - pad} ${pts} ${last[0]},${H - pad}`;
  const gid = `grad-${color.replace("#", "")}`;
  return (
    <View>
      {(label || avg != null) && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <Text style={type.sub}>{label}</Text>
          {avg != null ? (
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: C.textPrimary, letterSpacing: -0.6 }}>{avg}</Text>
              {unit ? <Text style={[type.sub, { marginLeft: 3 }]}>{unit}</Text> : null}
            </View>
          ) : null}
        </View>
      )}
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.30" />
            <Stop offset="1" stopColor={color} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((g, i) => (
          <Line key={i} x1={pad} y1={pad + g * (H - pad * 2)} x2={W - pad} y2={pad + g * (H - pad * 2)} stroke="#EDF1F7" strokeWidth="1" />
        ))}
        <Polygon points={areaPts} fill={`url(#${gid})`} />
        <Polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={last[0]} cy={last[1]} r="4.5" fill={color} />
        <Circle cx={last[0]} cy={last[1]} r="8" fill={color} fillOpacity="0.18" />
      </Svg>
    </View>
  );
}

export function DayChart({ data, color = C.primary, height = 130, unit }) {
  const W = 320, H = height, pad = 14;
  if (!data || data.length === 0) {
    return (
      <View style={{ height: H, alignItems: "center", justifyContent: "center" }}>
        <Text style={type.sub}>Nothing recorded today yet</Text>
      </View>
    );
  }
  const values = data.map((d) => d.value ?? 0);
  const max = Math.max(...values) || 1;
  const barW = Math.max(2, (W - pad * 2) / data.length - 2);
  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#E4E8EF" strokeWidth="1" />
        {data.map((d, i) => {
          const h = ((d.value ?? 0) / max) * (H - pad * 2);
          const x = pad + i * ((W - pad * 2) / data.length);
          return <Rect key={i} x={x} y={H - pad - h} width={barW} height={Math.max(1, h)} rx={barW / 2} fill={color} opacity={0.85} />;
        })}
      </Svg>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
        <Text style={type.meta}>12 AM</Text>
        <Text style={type.meta}>12 PM</Text>
        <Text style={type.meta}>11 PM</Text>
      </View>
    </View>
  );
}
