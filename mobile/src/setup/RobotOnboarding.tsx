import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LooiPairingPanel } from "./LooiPairingPanel";
import { getLooiRobotRuntimeState, subscribeLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";
import { useUserStore } from "../store/user";
import { looiTheme as theme } from "../ui/looi-theme";
import { completeRobotOnboarding, hasCompletedRobotOnboarding, setOptionalCapabilitySkipped } from "./setup-storage";
import { openDevicePermissionSettings, readDevicePermissions, requestDevicePermissions, type DevicePermissions } from "./device-permissions";
import { ModelConnectionForm } from "../agent/ModelConnectionForm";
import { TavilyConnectionSettings } from "../search/TavilyConnectionSettings";

export function RobotOnboarding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string }>();
  const [step, setStep] = useState(params.step === "robot" ? 1 : 0);
  const [permissions, setPermissions] = useState<DevicePermissions>({ bluetooth: false, microphone: false, camera: false });
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(() => getLooiRobotRuntimeState().connected);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const operation = useRef(false);
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
    });
    return () => { alive.current = false; subscription.remove(); robotSubscription(); clearInterval(holdTimer); };
  }, [refreshPermissions]);

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
  const finish = () => {
    setOptionalCapabilitySkipped("robot", !connected);
    if (permissions.camera) useUserStore.getState().updatePreferences({ cameraAttentionEnabled: true });
    completeRobotOnboarding();
    router.replace("/");
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Text style={styles.brand}>小丫</Text>
      <Text style={styles.progress}>{["授权", "连接 LOOI", "模型连接", "准备好了"][step]} · {step + 1}/4</Text>
      {existingSetup ? <Action secondary label="返回" disabled={busy} onPress={() => router.replace("/menu")} /> : null}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.title}>{["先认识一下彼此", "连接你的 LOOI", "连接小丫的大脑", connected ? "很高兴见到你" : "先和小丫见个面"][step]}</Text>
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
        <LooiPairingPanel />
        {connected ? <Action label="LOOI 已连接，继续" onPress={() => setStep(2)} /> : null}
        <Action secondary label="检查系统权限" onPress={() => setStep(0)} />
        <Action secondary label="稍后连接，先配置模型" onPress={() => { setMessage(""); setStep(2); }} />
      </> : step === 2 ? <>
        <Text style={styles.subtitle}>填写自己的中转站连接，验证后即可用中文和小丫聊天。</Text>
        <ModelConnectionForm onSaved={() => setStep(3)} />
        <Action secondary label="稍后配置，先查看表情" onPress={() => setStep(3)} />
      </> : <>
        <Text style={styles.subtitle}>平时只显示表情，底部小字提示正在进行的步骤。说“小丫小丫”唤醒，从右向左滑动打开菜单。</Text>
        <Text style={styles.detail}>{connected ? "LOOI 已连接，下次自动重连。" : "可以随时在菜单中的“连接 LOOI”完成连接。"}</Text>
        <TavilyConnectionSettings />
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
