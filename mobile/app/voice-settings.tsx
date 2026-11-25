import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, PermissionsAndroid, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { ChineseVoiceControls } from "@/src/ui/ChineseVoiceControls";
import { isChineseWakeEnabled, setChineseWakeEnabled, subscribeChineseWake, getChineseAsrMode, setChineseAsrMode, getChineseEndSilence, setChineseEndSilence } from "@/src/voice/chinese-voice-preferences";
import { chineseVoice, resumeAutomaticChineseVoice } from "@/src/voice/chinese-voice-runtime";
import Vosk from "../modules/vosk-command-recognizer";
import * as FileSystem from "expo-file-system/legacy";
import { compareSpeechSample } from "@/src/voice/speech-sample";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export default function VoiceSettings() {
  const router = useRouter();
  const enabled = useSyncExternalStore(subscribeChineseWake, isChineseWakeEnabled, isChineseWakeEnabled);
  const asrMode = useSyncExternalStore(subscribeChineseWake, getChineseAsrMode, getChineseAsrMode);
  const silence = useSyncExternalStore(subscribeChineseWake, getChineseEndSilence, getChineseEndSilence);
  const [advanced, setAdvanced] = useState(false);
  const [notice, setNotice] = useState("");
  const [compare, setCompare] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [sampleResult, setSampleResult] = useState("");
  const sample = useRef<AbortController | null>(null);
  useFocusEffect(useCallback(() => () => sample.current?.abort(), []));
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state !== "active") sample.current?.abort();
    });
    return () => { listener.remove(); sample.current?.abort(); };
  }, []);
  const diagnose = async () => {
    if (sample.current) return;
    const run = new AbortController();
    sample.current = run;
    setSampling(true);
    setSampleResult("正在准备收音");
    let started = false;
    let uri: string | undefined;
    let release: (() => Promise<void>) | undefined;
    try {
      if (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) !== PermissionsAndroid.RESULTS.GRANTED) {
        throw new Error("请允许麦克风权限");
      }
      if (run.signal.aborted) return;
      release = await chineseVoice.pauseCaptureForRecording();
      if (run.signal.aborted) return;
      started = true;
      await Vosk.startChineseSample();
      if (!run.signal.aborted) {
        setSampleResult("请现在说一句话，正在收音（6 秒）");
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); run.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, 6000);
          run.signal.addEventListener("abort", finish, { once: true });
        });
      }
      if (run.signal.aborted) return;
      const local = await Vosk.finishChineseSample(true);
      started = false;
      if (!local) throw new Error("没有收到语音样本");
      uri = local.uri;
      if (run.signal.aborted) return;
      const db = local.rms > 0 ? (20 * Math.log10(local.rms / 32768)).toFixed(1) : "静音";
      const summary = `本机（${local.decodeMs} 毫秒）：${local.text || "未识别到文字"}\n采样 ${local.durationMs} 毫秒 · 电平 ${db} dBFS · 削顶 ${local.clipped} 样本\n解码丢块 ${local.droppedChunks} · 噪声电平 ${local.noiseDbfs.toFixed(1)} dBFS · 电平对比约 ${local.levelContrastDb.toFixed(1)} dB（非标准信噪比）`;
      setSampleResult(summary);
      if (compare) {
        const remote = await compareSpeechSample(uri, run.signal).catch(error => error.message as string);
        if (!run.signal.aborted) setSampleResult(summary + "\n" + remote);
      }
    } catch (error) { if (!run.signal.aborted) setSampleResult(error instanceof Error ? error.message : "语音采样失败"); }
    finally {
      if (started) await Vosk.finishChineseSample(false).catch(() => {});
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      await release?.().catch(() => {});
      sample.current = null;
      setSampling(false);
    }
  };
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
      <View style={styles.row}><Text style={styles.label}>自由对话使用中转识别</Text>
        <Switch value={asrMode === "relay"} onValueChange={value => setChineseAsrMode(value ? "relay" : "local")} disabled={sampling} />
      </View>
      <Text style={styles.detail}>唤醒后的自由对话发送到已配置中转的 TeleSpeechASR，失败采用本机结果。停止和拍照选择由本机响应。</Text>
      <Text style={styles.label}>说完后等多久再处理</Text>
      <View style={styles.row}>{[1.1, 1.8, 2.5].map(value =>
        <Pressable key={value} disabled={sampling} accessibilityRole="radio" accessibilityState={{checked:silence===value}}
          onPress={() => setChineseEndSilence(value)} style={styles.button}>
          <Text style={styles.link}>{silence===value ? "✓ " : ""}{value} 秒</Text>
        </Pressable>)}</View>
      <Text style={styles.label}>声音：手机系统中文音色</Text>
      <Pressable disabled={sampling} accessibilityRole="button" onPress={() => void preview()} style={styles.button}>
        <Text style={styles.link}>试听声音</Text>
      </Pressable>
      {notice ? <Text style={styles.detail}>{notice}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)} style={styles.button}><Text style={styles.link}>{advanced ? "收起语音诊断" : "语音诊断"}</Text></Pressable>
      {advanced ? <>
        <View style={styles.row}><Text style={styles.label}>用中转识别同一段录音</Text>
          <Switch accessibilityLabel="中转语音对照" disabled={sampling} value={compare} onValueChange={setCompare} />
        </View>
        <Text style={styles.detail}>每次采样 6 秒。开启对照会把本段录音发送到已配置的中转站。</Text>
        <Pressable disabled={sampling} accessibilityRole="button" onPress={() => void diagnose()} style={styles.button}>
          <Text style={styles.link}>{sampling ? "正在采样或识别…" : "采样一句话"}</Text>
        </Pressable>
        {sampleResult ? <Text selectable style={styles.detail}>{sampleResult}</Text> : null}
        {!sampling ? <ChineseVoiceControls manageFocus={false} /> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: theme.text, fontSize: 22 }, content: { padding: 24, gap: 20 }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { color: theme.text, fontSize: 17 }, detail: { color: theme.muted, fontSize: 14, lineHeight: 23 }, link: { color: theme.cyan, fontSize: 15 },
  button: { paddingVertical: 12, alignSelf: "flex-start" },
});
