import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { looiTheme } from "../ui/looi-theme";
import {
  clearHermesConnection, DEFAULT_HERMES_ORIGIN, HERMES_MODEL_ALIAS, probeHermesConnection,
  readHermesConnection, resolveHermesConnection, saveHermesConnection, type HermesConnection,
} from "./connection";

export function HermesConnectionSettings() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_HERMES_ORIGIN);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<HermesConnection | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void readHermesConnection().then((connection) => {
      if (!mounted.current) return;
      setSaved(connection);
      if (connection) setBaseUrl(connection.baseUrl);
    }).catch(() => {
      if (mounted.current) setMessage("无法读取已保存的连接，请重新填写。");
    }).finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; };
  }, []);

  const run = async (action: "save" | "test" | "clear") => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (action === "clear") {
        await clearHermesConnection();
        if (mounted.current) { setSaved(null); setToken(""); setMessage("已删除本机保存的 Token。"); }
        return;
      }
      const connection = resolveHermesConnection(baseUrl, token, saved);
      await saveHermesConnection(connection);
      if (mounted.current) { setSaved(connection); setBaseUrl(connection.baseUrl); setToken(""); }
      if (action === "save") {
        if (mounted.current) setMessage("已保存，后续连接自动读取；Token 不会显示在界面中。");
        return;
      }
      const result = await probeHermesConnection(connection);
      if (!mounted.current) return;
      setMessage(result.passed
        ? "连接正常：HTTPS、鉴权、模型别名及 Runs 提交/查询/进度/停止能力均通过。未提交任务。"
        : `连接检查未全部通过：健康 ${result.health}，无 Token ${result.modelsWithoutToken}，鉴权 ${result.modelsWithToken}，能力 ${result.capabilities}。${result.modelsWithToken === 401 ? "请检查 Token。" : "请核对模型别名与 Runs 能力。"}`);
    } catch (error) {
      // Validation errors are ours; network/native errors must not expose headers or tokens.
      const validation = error instanceof Error && /^(请输入|服务地址须|请仅填写|首次连接)/.test(error.message);
      if (mounted.current) setMessage(validation ? error.message : "连接或安全存储失败，请检查网络、服务地址和 Token 后重试。");
    } finally { if (mounted.current) setBusy(false); }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>Hermes 服务器连接</Text>
    <Text style={styles.help}>首次填写一次 Token，之后保存在本机安全存储中。此处用于检查连接，办公派单功能待接入。</Text>
    <TextInput accessibilityLabel="Hermes 服务地址" value={baseUrl} onChangeText={setBaseUrl} editable={!busy}
      autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
    <TextInput accessibilityLabel="Hermes API Token" value={token} onChangeText={setToken} editable={!busy}
      placeholder={saved ? "已保存 Token；填写新值可替换" : "填写独立的 Hermes API Token"}
      placeholderTextColor={looiTheme.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} />
    <Text style={styles.help}>模型别名：{HERMES_MODEL_ALIAS} · {saved ? "Token 已保存" : "Token 尚未保存"}</Text>
    <View style={styles.actions}>
      <Button label="保存" disabled={busy} onPress={() => void run("save")} />
      <Button label={busy ? "处理中…" : "保存并测试连接"} disabled={busy} onPress={() => void run("test")} />
      {saved ? <Button label="删除本机 Token" disabled={busy} onPress={() => void run("clear")} /> : null}
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.help}>{message}</Text> : null}
  </View>;
}

function Button({ label, disabled, onPress }: { label: string; disabled: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && { opacity: 0.45 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, marginTop: 12, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 16 },
  title: { color: looiTheme.text, fontSize: 18, fontWeight: "700" },
  help: { color: looiTheme.muted, fontSize: 13, lineHeight: 20 },
  input: { color: looiTheme.text, borderWidth: 1, borderColor: looiTheme.line, borderRadius: 12, padding: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { borderWidth: 1, borderColor: looiTheme.cyan, borderRadius: 12, padding: 10 },
  buttonText: { color: looiTheme.text, fontSize: 13, fontWeight: "600" },
});
