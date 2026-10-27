import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { connectSelectedLooiRobot, scanLooiRobotCandidates, type LooiRobotCandidate } from "../device-tools/looi-robot-autoconnect";
import { disconnectLooiRobot, getLooiRobotRuntimeState, stopLooiMotion, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";
import { useUserStore } from "../store/user";
import { looiTheme as theme } from "../ui/looi-theme";
import { completeRobotOnboarding, hasCompletedRobotOnboarding, setOptionalCapabilitySkipped } from "./setup-storage";
import { openDevicePermissionSettings, readDevicePermissions, requestDevicePermissions, type DevicePermissions } from "./device-permissions";

export function RobotOnboarding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const [step, setStep] = useState(params.step === "robot" ? 1 : 0);
  const [permissions, setPermissions] = useState<DevicePermissions>({ bluetooth: false, microphone: false, camera: false });
  const [devices, setDevices] = useState<LooiRobotCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [connected, setConnected] = useState(() => getLooiRobotRuntimeState().connected);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const operation = useRef(false);
  const scan = useRef<AbortController | null>(null);
  const pendingScan = useRef<Promise<LooiRobotCandidate[]> | null>(null);
  const connecting = useRef(false);
  const existingSetup = hasCompletedRobotOnboarding();

  const refreshPermissions = useCallback(async () => {
    const next = await readDevicePermissions();
    if (alive.current) setPermissions(next);
    return next;
  }, []);
  useEffect(() => {
    alive.current = true;
    const holdMotion = () => { holdAmbientMotionFor(6000, "robot-onboarding"); holdSocialAttentionMotionFor(6000, "robot-onboarding"); };
    holdMotion();
    const holdTimer = setInterval(holdMotion, 2000);
    const robotSubscription = subscribeLooiRobotRuntimeState(() => {
      if (alive.current) setConnected(getLooiRobotRuntimeState().connected);
    });
    void refreshPermissions().catch(() => {});
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermissions().catch(() => {});
      else scan.current?.abort();
    });
    return () => { alive.current = false; scan.current?.abort(); subscription.remove(); robotSubscription(); clearInterval(holdTimer); };
  }, [refreshPermissions]);

  const search = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    scan.current?.abort();
    const controller = new AbortController();
    scan.current = controller;
    setScanning(true); setDevices([]); setMessage("正在搜索附近的 LOOI…");
    try {
      const request = scanLooiRobotCandidates({ signal: controller.signal,
        onCandidates: (items) => { if (alive.current && !controller.signal.aborted) setDevices(items); },
      });
      pendingScan.current = request;
      const found = await request;
      if (alive.current && !controller.signal.aborted) {
        setDevices(found);
        setMessage(found.length ? "轻点你的 LOOI 连接。" : "没有发现 LOOI。请确认底座已开机、靠近手机，并退出官方 App，避免连接被占用。");
      }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "搜索失败，请检查蓝牙和附近设备权限。");
    } finally {
      operation.current = false;
      pendingScan.current = null;
      if (alive.current) setScanning(false);
    }
  }, []);
  useEffect(() => { if (step === 1 && !connected) void search(); return () => { scan.current?.abort(); }; }, [step, connected, search]);

  const grantPermissions = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setMessage("");
    try {
      const next = await requestDevicePermissions();
      if (!alive.current) return;
      setPermissions(next);
      if (next.bluetooth && next.microphone && next.camera) setStep(1);
      else setMessage("有权限尚未允许。可以重新授权，或稍后在设置中开启；对应功能暂时不可用。");
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : "授权未完成，请重试。");
    } finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const connect = async (device: LooiRobotCandidate) => {
    // Wait for scan stop before reusing the Android BLE adapter for GATT.
    if (connecting.current) return;
    connecting.current = true;
    setBusy(true); setMessage(`正在连接 ${device.name}…`);
    try {
      scan.current?.abort();
      await pendingScan.current?.catch(() => {});
      if (!alive.current || AppState.currentState !== "active") return;
      await connectSelectedLooiRobot(device);
      if (!alive.current || AppState.currentState !== "active") {
        await stopLooiMotion("onboarding-left-during-connect").catch(() => {});
        await disconnectLooiRobot().catch(() => {});
        return;
      }
      setConnected(true); setStep(2); setMessage("");
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : "连接失败，请重试。");
    } finally { connecting.current = false; if (alive.current) setBusy(false); }
  };
  const finish = () => {
    setOptionalCapabilitySkipped("robot", !connected);
    if (permissions.camera) useUserStore.getState().updatePreferences({ cameraAttentionEnabled: true });
    completeRobotOnboarding();
    router.replace("/");
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Text style={styles.brand}>小丫</Text>
      <Text style={styles.progress}>{["授权", "连接 LOOI", "准备好了"][step]} · {step + 1}/3</Text>
      {existingSetup ? <Action secondary label="返回" disabled={busy} onPress={() => router.replace("/menu")} /> : null}
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{["先认识一下彼此", "连接你的 LOOI", connected ? "很高兴见到你" : "先和小丫见个面"][step]}</Text>
      {step === 0 ? <>
        <Text style={styles.subtitle}>允许这些权限，小丫才能听见你、看向你，并连接自己的身体。</Text>
        {([["bluetooth", "附近设备", "搜索并连接 LOOI；旧版 Android 会请求位置权限。"],
          ["microphone", "麦克风", "在 App 前台听见“小丫小丫”和你的指令。"],
          ["camera", "摄像头", "本地发现人脸并看向你。"]] as const).map(([key, title, detail]) => <View key={key} style={styles.permission}>
          <View style={{ flex: 1 }}><Text style={styles.deviceName}>{title}</Text><Text style={styles.detail}>{detail}</Text></View>
          <Text style={{ color: permissions[key] ? theme.ok : theme.muted }}>{permissions[key] ? "已允许" : "待授权"}</Text>
        </View>)}
        <Action label={busy ? "等待系统授权…" : "授权并继续"} disabled={busy} onPress={() => void grantPermissions()} />
        {message ? <Action secondary label="前往系统权限设置" disabled={busy} onPress={() => void openDevicePermissionSettings().catch(() => setMessage("请从系统设置打开小丫的权限页面。"))} /> : null}
        <Action secondary label="稍后授权，先连接底座" disabled={busy} onPress={() => { setMessage(""); setStep(1); }} />
      </> : step === 1 ? <>
        <Text style={styles.subtitle}>给底座通电并放在手机旁。长按前方触控区域约 3 秒，看到黄灯呼吸后再搜索。</Text>
        {(scanning || busy) ? <ActivityIndicator color={theme.cyan} /> : null}
        {connected ? <Action label="LOOI 已连接，继续" onPress={() => setStep(2)} /> : null}
        {devices.map((device) => <Action key={device.id} label={`${device.name}    ${device.rssi ?? "—"} dBm`} disabled={busy}
          onPress={() => void connect(device)} />)}
        <Action label={scanning ? "正在搜索…" : "重新搜索"} disabled={scanning || busy} onPress={() => void search()} />
        <Action secondary label="检查系统权限" disabled={busy} onPress={() => setStep(0)} />
        <Action secondary label="稍后连接，先查看表情" disabled={busy || scanning} onPress={() => { setMessage(""); setStep(2); }} />
      </> : <>
        <Text style={styles.subtitle}>平时只显示表情和简短状态。说“小丫小丫”唤醒，从右向左滑动打开菜单。</Text>
        <Text style={styles.detail}>{connected ? "LOOI 已连接，下次自动重连。" : "可以随时在菜单中的“连接 LOOI”完成连接。"}</Text>
        <Action label="和小丫见面" onPress={finish} />
      </>}
      {message ? <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

function Action({ label, onPress, disabled = false, secondary = false }: { label: string; onPress(): void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.action, secondary && styles.secondary, disabled && { opacity: 0.45 }]}>
    <Text style={[styles.actionText, secondary && { color: theme.muted }]}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 16, flexDirection: "row", alignItems: "center", gap: 20 },
  brand: { color: theme.text, fontSize: 22, fontWeight: "700" }, progress: { flex: 1, color: theme.muted },
  content: { width: "100%", maxWidth: 660, alignSelf: "center", gap: 14, padding: 24, paddingBottom: 40 },
  title: { color: theme.text, fontSize: 28, fontWeight: "700" }, subtitle: { color: theme.muted, fontSize: 15, lineHeight: 24 },
  permission: { flexDirection: "row", alignItems: "center", gap: 20, paddingVertical: 12, borderBottomColor: theme.line, borderBottomWidth: 1 },
  deviceName: { color: theme.text, fontSize: 16 }, detail: { color: theme.muted, fontSize: 12, lineHeight: 20 },
  action: { backgroundColor: theme.cyan, borderRadius: 20, padding: 15, alignItems: "center" },
  actionText: { color: theme.bg, fontSize: 15, fontWeight: "600" }, secondary: { backgroundColor: "transparent" },
  message: { color: theme.warn, fontSize: 14, lineHeight: 23 },
});
