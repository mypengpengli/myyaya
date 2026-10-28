import { useCallback, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { PermissionsAndroid, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearSavedLooiRobot } from "@/src/device-tools/looi-robot-autoconnect";
import { LooiPairingPanel } from "@/src/setup/LooiPairingPanel";
import { getLooiRobotRuntimeState, stopLooiMotion, subscribeLooiRobotRuntimeState, clearLooiNearEdgeAfterManualReposition } from "@/src/device-tools/looi-robot";
import { executeChineseRobotCommand } from "@/src/device-tools/chinese-robot-control";
import type { ChineseRobotCommand } from "@/src/voice/chinese-command";
import { ChineseVoiceControls } from "@/src/ui/ChineseVoiceControls";
import { looiTheme as theme } from "@/src/ui/looi-theme";
import { holdAmbientMotionFor } from "@/src/core/ambient-motion";
import { holdSocialAttentionMotionFor } from "@/src/core/social-attention";
import { markRobotInteraction } from "@/src/core/robot-inactivity";
import { useUserStore } from "@/src/store/user";

const actions: [string, ChineseRobotCommand][] = [
  ["前进 0.45 秒", { kind: "move", direction: "forward" }], ["后退 0.45 秒", { kind: "move", direction: "back" }],
  ["左转 ≈90°", { kind: "turn", direction: "left", degrees: 90 }], ["右转 ≈90°", { kind: "turn", direction: "right", degrees: 90 }],
  ["掉头 ≈180°", { kind: "turn", direction: "right", degrees: 180 }], ["抬头", { kind: "head", direction: "up" }],
  ["低头", { kind: "head", direction: "down" }], ["头部回正", { kind: "head", direction: "center" }], ["点头", { kind: "nod" }],
  ["跳舞", { kind: "dance" }], ["开灯", { kind: "light", enabled: true }], ["关灯", { kind: "light", enabled: false }],
];
export default function RobotScreen() {
  const router = useRouter();
  const cameraAttention = useUserStore((state) => state.preferences.cameraAttentionEnabled);
  const [runtime, setRuntime] = useState(getLooiRobotRuntimeState);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("每个动作都会自动停止。转向角度按时间估算，实际角度受地面和电量影响。");
  const operation = useRef(false);
  const active = useRef(false);
  const lease = useRef(0);
  useFocusEffect(useCallback(() => {
    active.current = true;
    const hold = () => { holdAmbientMotionFor(6000, "robot-control-screen"); holdSocialAttentionMotionFor(6000, "robot-control-screen"); };
    hold(); const timer = setInterval(hold, 2000);
    const unsubscribe = subscribeLooiRobotRuntimeState(() => { if (active.current) setRuntime(getLooiRobotRuntimeState()); });
    setRuntime(getLooiRobotRuntimeState());
    return () => { active.current = false; lease.current++; clearInterval(timer); unsubscribe(); void stopLooiMotion("robot-screen-blur").catch(() => {}); };
  }, []));
  const run = async (work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); markRobotInteraction("robot-control-screen");
    try { await work(); }
    catch (error) { if (active.current) setNotice(error instanceof Error ? error.message : "操作失败，请检查蓝牙、权限和底座状态"); }
    finally { operation.current = false; if (active.current) { setBusy(false); setRuntime(getLooiRobotRuntimeState()); } }
  };
  const stop = () => {
    lease.current++;
    void executeChineseRobotCommand({ kind: "stop" }).then((message) => { if (active.current) setNotice(message); })
      .catch(() => { if (active.current) setNotice("停止指令写入失败，请检查蓝牙连接和底座实际状态"); });
  };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>小丫 · 底座控制</Text>
      <Button label="执行任务" onPress={() => router.replace("/tasks")} /><Button label="返回表情" onPress={() => router.replace("/")} />
      <Pressable accessibilityRole="button" accessibilityLabel="立即停止底座" onPress={stop} style={styles.stop}><Text style={styles.stopText}>■ 立即停止</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.status}>{runtime.connected ? "蓝牙已连接" : runtime.connecting ? "正在连接" : "底座未连接"} · {runtime.motionActive ? "动作进行中" : "当前静止"}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
      <LooiPairingPanel onBusy={setPairingBusy} />
      <View style={styles.row}><Button label="断开并忘记底座" disabled={busy || pairingBusy} onPress={() => void run(async () => {
        lease.current++; await clearSavedLooiRobot(); if (active.current) setNotice("已断开并忘记保存的底座；重新进入此页可再次配对");
      })} /></View>
      <View style={styles.grid}>{actions.map(([label, command]) => <Button key={label} label={label} disabled={busy || pairingBusy || !runtime.connected}
        onPress={() => void run(async () => { const message = await executeChineseRobotCommand(command); if (active.current) setNotice(message); })} />)}</View>
      <Text style={styles.detail}>传感器：悬崖 {runtime.sensors.cliffSafe === null ? "未知" : runtime.sensors.cliffSafe ? "地面安全" : "检测到边缘"} · 前方距离 {runtime.sensors.tofDistanceMm === null ? "未知 / 无目标" : `${runtime.sensors.tofDistanceMm} mm`} · 驱动通道 {runtime.driveControlReady ? "已就绪" : "等待校验"}</Text>
      <Text selectable style={styles.detail}>保护状态：{runtime.safety.lastMotionBlockReason ?? runtime.safety.reason ?? "无阻断"} · 最近停止：{runtime.safety.lastSafetyStopReason ?? "无"}</Text>
      {runtime.lastError ? <Text selectable style={styles.notice}>{runtime.lastError}</Text> : null}
      {runtime.nearEdge.front || runtime.nearEdge.rear ? <Button label="已手动移到安全地面，重新检查边缘锁存" onPress={() => void run(async () => {
        clearLooiNearEdgeAfterManualReposition(); if (active.current) setNotice("已根据传感器状态检查边缘锁存");
      })} /> : null}
      <Text style={styles.detail}>语音口令：小丫小丫，前进 / 后退 / 左转 / 右转 / 掉头 / 抬头 / 低头 / 点头 / 跳舞 / 开灯 / 关灯。唤醒后 15 秒内可连续下达口令；“停止”无需唤醒。每次移动自动停止，保留社区悬崖、障碍和 BLE 超时保护。</Text>
      <Button label={cameraAttention ? "关闭人脸注视" : "开启人脸注视"} onPress={() => void run(async () => {
        if (!cameraAttention && await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA) !== PermissionsAndroid.RESULTS.GRANTED) {
          setNotice("未允许相机权限，人脸注视无法开启"); return;
        }
        useUserStore.getState().updatePreferences({ cameraAttentionEnabled: !cameraAttention });
        setNotice(cameraAttention ? "人脸注视已关闭" : "人脸注视已开启：返回表情页，点击表情开始互动；复用本地检测和转头注视，不会向前跟随行走");
      })} />
      <ChineseVoiceControls />
    </ScrollView>
  </SafeAreaView>;
}
function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.4 }]}><Text style={styles.label}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  title: { flex: 1, color: theme.text, fontSize: 19, fontWeight: "700" }, content: { gap: 14, padding: 16 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" }, grid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  button: { padding: 12, borderRadius: 10, borderColor: theme.lineActive, borderWidth: 1, alignSelf: "flex-start" }, label: { color: theme.text, fontSize: 14 },
  stop: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, backgroundColor: "#a51f36" }, stopText: { color: "white", fontSize: 16, fontWeight: "700" },
  status: { color: theme.cyan, fontSize: 16 }, notice: { color: theme.warn, lineHeight: 22 }, detail: { color: theme.muted, lineHeight: 21, fontSize: 13 },
});
