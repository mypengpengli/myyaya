import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { syncVoiceRuntime } from "../core/app-bootstrap";
import { looiTheme } from "../ui/looi-theme";
import { setAppMode, type AppMode } from "./setup-storage";
import { useAppMode } from "./use-app-mode";

export function AppModeSelector() {
  const appMode = useAppMode();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectMode = async (next: AppMode) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setAppMode(next);
      if (next === "local") await syncVoiceRuntime();
      else router.replace("/onboarding?step=openai" as never);
    } catch {
      setError("模式切换未完成，请重试；切回本地模式可停止旧版语音。");
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>运行模式</Text>
    <Text style={styles.help}>{appMode === "local"
      ? "本地模式：无需 OpenAI Key，可进入表情、本地记忆和设备设置；不会自动开启麦克风或旧版云端语音。录像和 Pi / NewAPI 尚未接入。"
      : "旧版 Realtime：仅此功能需要 OpenAI Key、本地语音模型和麦克风权限，可能产生 OpenAI 费用。Pi / NewAPI 尚未接入。"}</Text>
    <View style={styles.row}>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityState={{ selected: appMode === "local" }} onPress={() => void selectMode("local")} style={[styles.button, appMode === "local" && styles.selected]}><Text style={styles.label}>本地模式（默认）</Text></Pressable>
      <Pressable disabled={busy} accessibilityRole="button" accessibilityState={{ selected: appMode === "legacy_realtime" }} onPress={() => void selectMode("legacy_realtime")} style={[styles.button, appMode === "legacy_realtime" && styles.selected]}><Text style={styles.label}>配置旧版 OpenAI Realtime</Text></Pressable>
    </View>
    {error ? <Text style={styles.help}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 16 },
  title: { color: looiTheme.text, fontSize: 18, fontWeight: "700" },
  help: { color: looiTheme.muted, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  button: { borderColor: looiTheme.line, borderWidth: 1, borderRadius: 12, padding: 12 },
  selected: { borderColor: looiTheme.cyan, backgroundColor: "rgba(40,213,255,0.08)" },
  label: { color: looiTheme.text, fontSize: 13, fontWeight: "600" },
});
