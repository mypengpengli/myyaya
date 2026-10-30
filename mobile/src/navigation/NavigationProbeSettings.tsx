import { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Pressable, StyleSheet, Text, View } from "react-native";
import {
  getNavigationProbeStatus, openNativeNavigationProbe,
  type NavigationProbeStatus,
} from "../../modules/navigation-probe";
import { withExternalActivityLease } from "../core/background-process-exit";
import { pauseSocialCamera } from "../core/social-attention";
import { stopLooiMotion } from "../device-tools/looi-robot";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { looiTheme as theme } from "../ui/looi-theme";

let probeOpening = false;

export function NavigationProbeSettings() {
  const [status, setStatus] = useState<NavigationProbeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    try { setStatus(await getNavigationProbeStatus()); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = async () => {
    if (probeOpening) return;
    probeOpening = true;
    setBusy(true);
    try {
      await withExternalActivityLease("navigation-probe", async () => {
        const releaseCamera = await pauseSocialCamera();
        const { pauseAppRuntime, resumeAppRuntime } = await import("../core/app-bootstrap");
        try {
          // Also stop/disconnect BLE and release voice/background character motion.
          // The probe has no motor interface and never sends reverse/turn commands.
          await stopLooiMotion("navigation-probe");
          await pauseAppRuntime();
          recordDiagnosticEvent("navigation", "visual-probe-opened", { motorControl: false });
          const report = await openNativeNavigationProbe();
          setMessage(report ? "本次采集已结束，可再次打开或在探针中导出记录。" : "已退出视觉探针。");
          recordDiagnosticEvent("navigation", "visual-probe-closed", { hasReport: Boolean(report) });
        } finally {
          releaseCamera();
          if (AppState.currentState === "active") await resumeAppRuntime();
        }
      });
    } catch (error) {
      Alert.alert("视觉探针", error instanceof Error ? error.message : String(error));
    } finally {
      probeOpening = false;
      setBusy(false);
      void refresh();
    }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>房间地图 · 视觉探针</Text>
    <Text style={styles.text}>先验证手机的定位、轨迹和后摄深度。本阶段不会自动移动，也不会保存可导航的房间地图。</Text>
    <Text style={styles.text}>{status ? (status.serviceInstalled ? `AR 服务：${status.serviceVersion || "已安装"}` : "AR 服务：尚未安装，打开探针可查看安装指引") : "正在检查 AR 服务…"}</Text>
    <Text style={styles.text}>后续采用后摄朝向行驶的倒车方案，到点停车后再转向面对用户；该行驶策略仍待标定。</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="打开房间视觉探针" disabled={busy} onPress={() => void open()} style={styles.button}>
      <Text style={styles.label}>{busy ? "视觉探针运行中…" : "打开视觉探针"}</Text>
    </Pressable>
    {message ? <Text style={styles.text}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 18, borderRadius: 18, backgroundColor: theme.rail, marginVertical: 16 },
  title: { color: theme.text, fontSize: 19, fontWeight: "600" },
  text: { color: theme.muted, fontSize: 14, lineHeight: 21 },
  button: { backgroundColor: theme.cyan, alignSelf: "flex-start", padding: 14, borderRadius: 12 },
  label: { color: theme.bg, fontSize: 16, fontWeight: "600" },
});
