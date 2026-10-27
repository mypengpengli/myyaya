import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChineseVoiceControls } from "@/src/ui/ChineseVoiceControls";
import { isChineseWakeEnabled, setChineseWakeEnabled, subscribeChineseWake } from "@/src/voice/chinese-voice-preferences";
import { chineseVoice, resumeAutomaticChineseVoice } from "@/src/voice/chinese-voice-runtime";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export default function VoiceSettings() {
  const router = useRouter();
  const enabled = useSyncExternalStore(subscribeChineseWake, isChineseWakeEnabled, isChineseWakeEnabled);
  const [advanced, setAdvanced] = useState(false);
  const [notice, setNotice] = useState("");
  const preview = async () => {
    setNotice("");
    try {
      await chineseVoice.speak("你好，我是小丫，很高兴见到你。");
      const result = chineseVoice.getSnapshot();
      if (result.phase === "error") setNotice(result.notice);
      resumeAutomaticChineseVoice();
    } catch { setNotice("请检查系统中文音色是否可用。"); }
  };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>语音与声音</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/menu")}><Text style={styles.link}>返回菜单</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.row}><Text style={styles.label}>语音唤醒</Text><Switch accessibilityLabel="自动开启中文语音唤醒" value={enabled} onValueChange={setChineseWakeEnabled} /></View>
      <Text style={styles.detail}>返回表情页后自动监听“小丫小丫”。App 进入后台或休眠时暂停，回来后自动恢复。“停止”无需唤醒。</Text>
      <Text style={styles.label}>声音：手机系统中文音色</Text>
      <Pressable accessibilityRole="button" onPress={() => void preview()} style={styles.button}>
        <Text style={styles.link}>试听声音</Text>
      </Pressable>
      {notice ? <Text style={styles.detail}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)} style={styles.button}><Text style={styles.link}>{advanced ? "收起语音诊断" : "语音诊断"}</Text></Pressable>
      {advanced ? <ChineseVoiceControls manageFocus={false} /> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: theme.text, fontSize: 22 }, content: { padding: 24, gap: 20 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: theme.text, fontSize: 17 }, detail: { color: theme.muted, fontSize: 14, lineHeight: 23 }, link: { color: theme.cyan, fontSize: 15 },
  button: { paddingVertical: 12, alignSelf: "flex-start" },
});
