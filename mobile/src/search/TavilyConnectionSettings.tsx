import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { clearTavilyKey, normalizeTavilyKey, readTavilyKey, saveTavilyKey } from "./tavily-config";
import { searchWeb } from "./tavily-search";
import { looiTheme as theme } from "../ui/looi-theme";

export function TavilyConnectionSettings() {
  const [input, setInput] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const mounted = useRef(true), request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    void readTavilyKey().then((value) => { if (mounted.current) setSavedKey(value); })
      .catch(() => { if (mounted.current) setNotice("无法读取安全存储，请重新填写。"); })
      .finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  const run = async (action: "save" | "test" | "clear") => {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      if (action === "clear") {
        await clearTavilyKey();
        if (mounted.current) { setInput(""); setSavedKey(null); setNotice("已删除本机 Tavily Key。"); }
        return;
      }
      const key = normalizeTavilyKey(input.trim() || savedKey || "");
      // Save independently of network success, so temporary outages never lose setup.
      await saveTavilyKey(key);
      if (!mounted.current) return;
      setInput(""); setSavedKey(key); setNotice("Key 已安全保存；实际搜索时会校验连接，也可点击测试连接。");
      if (action === "test") {
        const controller = new AbortController(); request.current = controller;
        setNotice("Key 已保存，正在测试联网搜索…");
        const result = await searchWeb({ query: "Tavily 官方搜索文档" }, controller.signal, key);
        if (mounted.current) setNotice(`连接正常，收到 ${result.sources.length} 条来源。Key 已安全保存。`);
      }
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error && /^(请填写|联网搜索|Tavily)/.test(error.message)
        ? error.message : "安全存储失败，请重试。");
    } finally { request.current = null; if (mounted.current) setBusy(false); }
  };
  return <View style={styles.card}>
    <Text style={styles.title}>联网搜索 · Tavily（选填）</Text>
    <Text style={styles.detail}>想让小丫查最新资料，可填写自己的 Tavily Key。也可以稍后从左滑菜单或设置中配置；不影响普通对话。</Text>
    <TextInput accessibilityLabel="Tavily API Key" secureTextEntry autoCapitalize="none" autoCorrect={false}
      editable={!busy} value={input} onChangeText={setInput} placeholder={savedKey ? "已安全保存；留空继续使用" : "填写 Tavily API Key"}
      placeholderTextColor={theme.muted} style={styles.input} />
    <Text style={styles.detail}>{savedKey ? "已保存到这台手机的安全存储" : "尚未配置联网搜索"} · 保存不会产生搜索请求，测试连接会使用一次搜索额度。</Text>
    <View style={styles.actions}>
      <Action label="保存" disabled={busy} onPress={() => void run("save")} />
      <Action label={busy ? "处理中…" : "保存并测试连接"} disabled={busy} onPress={() => void run("test")} />
      {savedKey ? <Action label="删除本机 Key" disabled={busy} onPress={() => void run("clear")} /> : null}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.detail}>{notice}</Text> : null}
  </View>;
}
function Action({ label, disabled, onPress }: { label: string; disabled: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.link}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ card: { padding: 18, gap: 14, borderColor: theme.line, borderWidth: 1, borderRadius: 20, marginTop: 12 },
  title: { color: theme.text, fontSize: 18 }, detail: { color: theme.muted, fontSize: 13, lineHeight: 22 },
  input: { color: theme.text, borderColor: theme.muted, borderWidth: 1, borderRadius: 12, padding: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, button: { padding: 12, borderColor: theme.line, borderWidth: 1, borderRadius: 12 }, link: { color: theme.cyan, fontSize: 14 } });
