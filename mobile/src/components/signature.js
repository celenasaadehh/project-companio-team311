// Consent signature capture.
import React, { useRef, useState, useEffect } from "react";
import { View, Text, TouchableOpacity, PanResponder } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors as C, radius, type } from "../theme/theme";

export function SignaturePad({ label, height = 150, onChange }) {
  const [strokes, setStrokes] = useState([]);
  const cur = useRef("");

  useEffect(() => { onChange && onChange(strokes.length > 0); }, [strokes.length]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        cur.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        setStrokes((s) => [...s, cur.current]);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        cur.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setStrokes((s) => [...s.slice(0, -1), cur.current]);
      },
    })
  ).current;

  return (
    <View>
      {label ? <Text style={[type.meta, { marginBottom: 6 }]}>{label.toUpperCase()}</Text> : null}
      <View style={{ backgroundColor: C.surface, borderRadius: radius.md, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
        <View {...pan.panHandlers} style={{ height }}>
          <Svg width="100%" height="100%">
            {strokes.map((d, i) => <Path key={i} d={d} stroke={C.textPrimary} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
          </Svg>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border }}>
          <Text style={type.meta}>{strokes.length ? "Signed" : "Sign above with your finger"}</Text>
          <TouchableOpacity onPress={() => { cur.current = ""; setStrokes([]); }}>
            <Text style={{ color: C.primary, fontWeight: "600", fontSize: 13 }}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
