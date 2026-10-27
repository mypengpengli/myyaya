import { useCallback, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { chineseVoice, focusChineseVoiceScreen } from "../voice/chinese-voice-runtime";
import { looiTheme as theme } from "./looi-theme";

export function ChineseVoiceControls({ onTranscript, manageFocus = false }: { onTranscript?: (text: string) => void; manageFocus?: boolean }) {
  const speech = useSyncExternalStore(chineseVoice.subscribe, chineseVoice.getSnapshot, chineseVoice.getSnapshot);
  useFocusEffect(useCallback(() => manageFocus ? focusChineseVoiceScreen() : undefined, [manageFocus]));
  const active = speech.phase === "listening" || speech.phase === "loading" || speech.phase === "speaking";
  return <View style={styles.frame}>
    <View style={styles.row}>
      <Control label={active ? "关闭语音 / 停止朗读" : "开启中文口令"}
        onPress={() => { void (active ? chineseVoice.stop() : chineseVoice.start("wake")); }} />
      <Control label="听写一句话" onPress={() => { void chineseVoice.start("dictation"); }} />
      <Control label="试听中文声音" onPress={() => { void chineseVoice.speak("你好，我是小丫。收到啦！"); }} />
    </View>
    <Text style={styles.notice} accessibilityLiveRegion="polite">{speech.notice || "本地中文语音不需要 Key；开启后说“小丫小丫，前进”"}</Text>
    {speech.partial ? <Text style={styles.partial}>正在听：{speech.partial}</Text> : null}
    {speech.transcript ? <View style={styles.row}>
      <Text selectable style={styles.transcript}>识别：{speech.transcript}</Text>
      {onTranscript ? <Control label="采用这句话" onPress={() => onTranscript(speech.transcript)} /> : null}
    </View> : null}
  </View>;
}
function Control({ label, onPress }: { label: string; onPress(): void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}><Text style={styles.label}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  frame: { paddingHorizontal: 12, paddingVertical: 7, gap: 5 }, row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  button: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.lineActive, borderRadius: 9 },
  label: { color: theme.text, fontSize: 12 }, notice: { color: theme.cyan, fontSize: 12 }, partial: { color: theme.muted, fontSize: 12 },
  transcript: { color: theme.text, fontSize: 12, flexShrink: 1 },
});
