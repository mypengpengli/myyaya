import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { LooiPairingSession } from "../device-tools/looi-pairing-session";
import { connectSelectedLooiRobot, scanLooiRobotCandidates, suspendLooiRobotAutoConnection } from "../device-tools/looi-robot-autoconnect";
import { disconnectLooiRobot, getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import VoskCommandRecognizer from "../../modules/vosk-command-recognizer";
import { chineseVoice } from "../voice/chinese-voice-runtime";
import { looiTheme as theme } from "../ui/looi-theme";

const makeSession = () => new LooiPairingSession({
  prepare: () => suspendLooiRobotAutoConnection("pairing-discovery"),
  scan: (signal, onCandidates) => scanLooiRobotCandidates({ signal, onCandidates }),
  connect: async (item) => { await connectSelectedLooiRobot(item); },
  disconnect: disconnectLooiRobot, connected: () => getLooiRobotRuntimeState().connected, now: Date.now,
});
let previousPairing = Promise.resolve();
function launch(session: LooiPairingSession) {
  previousPairing = previousPairing.catch(() => {}).then(() => session.start());
}
export function LooiPairingPanel({ onBusy }: { onBusy?: (busy: boolean) => void }) {
  const [session, setSession] = useState(makeSession);
  const currentSession = useRef(session);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const connected = useSyncExternalStore(subscribeLooiRobotRuntimeState, () => getLooiRobotRuntimeState().connected, () => false);
  const [now, setNow] = useState(Date.now);
  const ownsSpeech = useRef(false);
  const announced = useRef(false);
  const busyCallback = useRef(onBusy); busyCallback.current = onBusy;
  useFocusEffect(useCallback(() => {
    const current = makeSession(); currentSession.current = current; setSession(current); announced.current = getLooiRobotRuntimeState().connected;
    const announce = async () => {
      if (getLooiRobotRuntimeState().connected) return;
      await chineseVoice.stop("正在连接底座");
      if (current.getSnapshot().phase === "cancelled" || AppState.currentState !== "active") return;
      ownsSpeech.current = true;
      await VoskCommandRecognizer.speakChinese("请长按底座触控区约三秒，看到黄色呼吸灯后松手。我会自动搜索连接，也可以点击已变黄开始搜索。").catch(() => {});
    };
    void announce(); launch(current);
    const app = AppState.addEventListener("change", (value) => { if (value !== "active") currentSession.current.cancel(); });
    return () => { app.remove(); currentSession.current.cancel(); if (ownsSpeech.current) { VoskCommandRecognizer.stopChineseSpeech(); ownsSpeech.current = false; } };
  }, []));
  useEffect(() => {
    if (state.phase !== "connected" || announced.current || AppState.currentState !== "active") return;
    announced.current = true; ownsSpeech.current = true;
    void VoskCommandRecognizer.speakChinese("LOOI 已连接，可以和小丫聊天了。").catch(() => {});
  }, [state.phase]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const busy = ["searching", "choosing", "connecting"].includes(state.phase);
  useEffect(() => { busyCallback.current?.(busy); return () => busyCallback.current?.(false); }, [busy]);
  if (connected) return <Text style={styles.success} accessibilityLiveRegion="polite">✓ LOOI 已连接，可以返回表情聊天</Text>;
  const restart = () => {
    if (state.phase === "cancelled") { const next = makeSession(); currentSession.current = next; setSession(next); launch(next); }
    else session.retry();
  };
  return <View style={styles.panel}>
    <Text style={styles.title}>连接 LOOI：长按约 3 秒 → 黄灯呼吸 → 自动连接</Text>
    <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.phase === "connected" ? "连接已断开，确认黄灯后可重新搜索。" : state.notice}</Text>
    <Text style={styles.detail}>{busy ? `正在${state.phase === "connecting" ? "连接" : "搜索"} · 本轮剩余 ${Math.max(0, Math.ceil((state.deadline - now) / 1000))} 秒` : "手机通过蓝牙发现底座，无法直接检测黄灯颜色。"}</Text>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={state.phase === "connecting"} style={styles.primary} onPress={restart}><Text style={styles.primaryText}>{state.phase === "connecting" ? "正在连接，请稍候…" : "已变黄，开始搜索"}</Text></Pressable>
      {busy ? <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => session.cancel()}><Text style={styles.notice}>停止搜索</Text></Pressable> : null}
    </View>
    {state.candidates.map((item) => <Pressable accessibilityRole="button" key={item.id} disabled={state.phase === "connecting"} onPress={() => session.choose(item)} style={styles.secondary}><Text style={styles.notice}>{item.name} · {item.rssi ?? "?"} dBm{item.selected ? " · 上次连接" : ""}</Text></Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 16, gap: 12, borderColor: theme.lineActive, borderWidth: 1, borderRadius: 16 },
  title: { color: theme.text, fontSize: 17, fontWeight: "700" }, notice: { color: theme.text, fontSize: 14, lineHeight: 23 },
  detail: { color: theme.muted, fontSize: 13 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  primary: { padding: 15, borderRadius: 12, backgroundColor: theme.cyan }, primaryText: { color: theme.bg, fontSize: 17, fontWeight: "700" },
  secondary: { padding: 12, borderColor: theme.line, borderWidth: 1, borderRadius: 12 }, success: { color: theme.ok, fontSize: 16, paddingVertical: 12 },
});
