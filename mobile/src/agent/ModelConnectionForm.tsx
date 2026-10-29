import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { fetch } from "expo/fetch";
import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_NEWAPI_URL, DEFAULT_VIDEO_MODEL, readNewApiConfig, saveNewApiConfig, validateNewApiConfig } from "@/src/agent/newapi-config";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export function ModelConnectionForm({ onSaved }: { onSaved?: () => void }) {
  const [url, setUrl] = useState(DEFAULT_NEWAPI_URL), [model, setModel] = useState(DEFAULT_CHAT_MODEL);
  const [videoModel, setVideoModel] = useState(DEFAULT_VIDEO_MODEL);
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [key, setKey] = useState(""), [savedKey, setSavedKey] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void readNewApiConfig().then((config) => {
    if (active && config) { setUrl(config.baseUrl); setModel(config.model); setImageModel(config.imageModel || DEFAULT_IMAGE_MODEL); setVideoModel(config.videoModel || DEFAULT_VIDEO_MODEL); setSavedKey(config.apiKey); }
  }).catch(() => { if (active) setNotice("无法读取安全存储"); }); return () => { active = false; }; }, []);
  const save = async () => {
    if (busy) return; setBusy(true); setNotice("正在验证模型连接…");
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const config = validateNewApiConfig({ version: 1, baseUrl: url, model, imageModel, videoModel, apiKey: key || savedKey });
      const response = await fetch(config.baseUrl + "/chat/completions", { method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "User-Agent": "myyaya/2.1.169" },
        body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "只回复：连接成功" }], max_tokens: 20 }) });
      if (!response.ok) throw new Error(`连接失败（HTTP ${response.status}）`);
      const data = await response.json();
      if (typeof data.choices?.[0]?.message?.content !== "string") throw new Error("模型没有返回有效文本");
      await saveNewApiConfig(config); setSavedKey(config.apiKey); setKey(""); setNotice("对话连接成功，三个模型 ID 已保存。图片和视频将在生成时验证；本次没有提交生成任务。"); onSaved?.();
    } catch (error) { setNotice(error instanceof Error && /^(请填写|连接失败|模型没有)/.test(error.message) ? error.message : "连接失败或超时，请检查地址、Key 和网络"); }
    finally { clearTimeout(timeout); setBusy(false); }
  };
  return <View style={styles.body}>
      <Text style={styles.label}>中转站地址</Text><TextInput accessibilityLabel="中转站地址" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} style={styles.input} />
      <Text style={styles.label}>API Key</Text><TextInput accessibilityLabel="模型 API Key" secureTextEntry autoCapitalize="none" autoCorrect={false} value={key} onChangeText={setKey} placeholder={savedKey ? "已安全保存；留空继续使用" : "填写自己的 Key"} placeholderTextColor={theme.muted} style={styles.input} />
      <Text style={styles.label}>对话模型</Text><TextInput accessibilityLabel="对话模型" autoCapitalize="none" autoCorrect={false} value={model} onChangeText={setModel} style={styles.input} />
      <Text style={styles.label}>图片模型（生图 / 改图）</Text><TextInput accessibilityLabel="图片模型" autoCapitalize="none" autoCorrect={false} value={imageModel} onChangeText={setImageModel} style={styles.input} />
      <Text style={styles.label}>视频模型</Text><TextInput accessibilityLabel="视频模型" autoCapitalize="none" autoCorrect={false} value={videoModel} onChangeText={setVideoModel} style={styles.input} />
      <Text style={styles.detail}>填写中转站的模型 ID。更换同系列模型后，后续新任务使用新 ID，已经提交的任务保留原 ID。Key 仅保存在这台手机的安全存储中。</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={styles.button}><Text style={styles.link}>{busy ? "连接中…" : "验证并保存"}</Text></Pressable>
      {savedKey && onSaved ? <Pressable accessibilityRole="button" disabled={busy} onPress={onSaved} style={styles.button}><Text style={styles.link}>使用已保存的连接</Text></Pressable> : null}
      <Text style={styles.detail}>{notice}</Text>
  </View>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 22, color: theme.text }, body: { padding: 24, gap: 12 }, label: { color: theme.text, fontSize: 16 },
  input: { borderColor: theme.muted, borderWidth: 1, borderRadius: 12, color: theme.text, padding: 12 },
  detail: { color: theme.muted, lineHeight: 22 }, link: { color: theme.cyan, fontSize: 16 }, button: { paddingVertical: 16 } });
