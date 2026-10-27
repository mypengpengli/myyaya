import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getHermesTaskService, retryHermesTask, stopHermesTask, submitNewHermesTask } from "@/src/hermes/task-runtime";
import { terminalRun, type RunStatus } from "@/src/hermes/run-protocol";
import { RobotFace } from "@/src/ui/RobotFace";
import { looiTheme as theme } from "@/src/ui/looi-theme";
import { ChineseVoiceControls } from "@/src/ui/ChineseVoiceControls";
import { chineseVoice } from "@/src/voice/chinese-voice-runtime";

const statusNames: Record<RunStatus, string> = { pending: "待提交 / 待确认", started: "已提交", queued: "排队中", running: "执行中", waiting_for_approval: "等待服务器端审批",
  stopping: "正在停止", completed: "已完成", failed: "执行失败", cancelled: "已取消", interrupted: "服务器中断" };

export default function TasksScreen() {
  const router = useRouter();
  const service = getHermesTaskService();
  const tasks = useSyncExternalStore(service.subscribe, service.list, service.list);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const operation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0];
  const action = async (kind: "submit" | "retry" | "stop") => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setMessage("");
    try {
      if (kind === "submit") {
        const id = await submitNewHermesTask(input);
        if (mounted.current) { setSelectedId(id); setInput(""); }
      } else if (selected) {
        if (kind === "retry") await retryHermesTask(selected.id);
        else await stopHermesTask(selected.id);
      }
    } catch (error) {
      const known = error instanceof Error && /^(请|提交结果)/.test(error.message);
      if (mounted.current) setMessage(known ? error.message : "暂时无法操作，请检查连接或本地存储后重试。");
    } finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.frame} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.main}>
        <View style={styles.header}>
          <Text style={styles.title}>小丫 · 执行任务</Text>
          <Button label="连接设置" onPress={() => router.replace("/settings")} />
          <Button label="返回表情" onPress={() => router.replace("/")} />
        </View>
        <Text style={styles.hint}>把办公、浏览器等任务交给服务器 Hermes；此页显示执行进度和结果。语音接入中。</Text>
        <ScrollView horizontal style={styles.history} contentContainerStyle={styles.historyContent}>
          {tasks.map((task) => <Pressable key={task.id} onPress={() => setSelectedId(task.id)}
            accessibilityRole="button" accessibilityLabel={task.input} style={[styles.chip, selected?.id === task.id && styles.activeChip]}>
            <Text numberOfLines={1} style={styles.chipText}>{task.input.slice(0, 22)}</Text>
            <Text style={styles.hint}>{statusNames[task.status]}</Text>
          </Pressable>)}
        </ScrollView>
        <ScrollView style={styles.process} contentContainerStyle={styles.processContent}>
          {selected ? <>
            <Text selectable style={styles.question}>{selected.input}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.status}>{statusNames[selected.status]}</Text>
            {selected.status === "waiting_for_approval" ? <Text style={styles.notice}>请在服务器端处理工具审批，也可以停止任务。当前手机端不会自动批准。</Text> : null}
            {selected.progress.map((event, index) => <View key={index} style={styles.event}>
              <Text style={styles.eventLabel}>{new Date(event.at).toLocaleTimeString()} · {event.label}</Text>
              {event.detail ? <Text selectable style={styles.body}>{event.detail}</Text> : null}
            </View>)}
            {selected.notice ? <Text style={styles.notice}>{selected.notice}</Text> : null}
            {selected.output ? <Text selectable style={styles.result}>{selected.output}</Text> : null}
            {terminalRun(selected.status) && !selected.output ? <Text style={styles.hint}>此任务没有返回文本结果。</Text> : null}
            {!selected.runId ? <Button label="用原幂等键重试提交" disabled={busy} onPress={() => void action("retry")} /> : null}
            {selected.runId && !terminalRun(selected.status) ? <Button label={selected.status === "stopping" ? "重试停止" : "停止任务"}
              disabled={busy} onPress={() => void action("stop")} /> : null}
            {selected.output ? <Button label="朗读结果" onPress={() => { void chineseVoice.speak(selected.output); }} /> : null}
            <Text selectable style={styles.hint}>任务编号：{selected.runId ?? "尚未确认"} · 返回表情或关闭应用后，服务器任务继续执行。</Text>
          </> : <Text style={styles.empty}>试着输入“运行 pwd，只读检查当前目录，并用中文回答”。</Text>}
        </ScrollView>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text> : null}
        <ChineseVoiceControls onTranscript={setInput} />
        <View style={styles.composer}>
          <TextInput accessibilityLabel="发送给 Hermes 的任务" placeholder="告诉小丫要做什么…" placeholderTextColor={theme.muted}
            value={input} onChangeText={setInput} multiline maxLength={10_000} editable={!busy} style={styles.input} />
          <Button label={busy ? "处理中…" : "发送任务"} disabled={busy || !input.trim()} onPress={() => void action("submit")} />
        </View>
      </View>
      <View style={styles.companion}>
        <Text style={styles.hint}>小丫在这里</Text>
        <View style={styles.avatar}><RobotFace mode="avatar" labelVisible={false} onPress={() => router.replace("/")} /></View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, frame: { flex: 1, flexDirection: "row", gap: 12, padding: 12 },
  main: { flex: 1, gap: 8 }, header: { flexDirection: "row", alignItems: "center", gap: 8 }, title: { flex: 1, color: theme.text, fontSize: 20, fontWeight: "700" },
  hint: { color: theme.muted, fontSize: 12, lineHeight: 18 }, history: { maxHeight: 64, flexGrow: 0 }, historyContent: { gap: 8 },
  chip: { padding: 8, borderWidth: 1, borderColor: theme.line, borderRadius: 10, maxWidth: 230 }, activeChip: { borderColor: theme.cyan }, chipText: { color: theme.text, fontSize: 13 },
  process: { flex: 1, borderWidth: 1, borderColor: theme.line, borderRadius: 16, backgroundColor: theme.bgRaised }, processContent: { padding: 14, gap: 12 },
  question: { color: theme.text, fontSize: 17, fontWeight: "600" }, status: { color: theme.cyan, fontSize: 13 }, event: { gap: 3, borderLeftWidth: 2, borderLeftColor: theme.lineActive, paddingLeft: 9 },
  eventLabel: { color: theme.muted, fontSize: 12 }, body: { color: theme.text, fontSize: 14, lineHeight: 21 }, result: { color: theme.text, fontSize: 16, lineHeight: 25 }, notice: { color: theme.warn, fontSize: 13, lineHeight: 20 },
  empty: { color: theme.muted, fontSize: 16, lineHeight: 26 }, composer: { flexDirection: "row", gap: 10, alignItems: "center" },
  input: { flex: 1, minHeight: 44, maxHeight: 90, color: theme.text, backgroundColor: theme.bgRaised, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.line },
  button: { alignSelf: "flex-start", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.cyan }, buttonText: { color: theme.text, fontSize: 13 }, disabled: { opacity: 0.4 },
  companion: { width: 136, justifyContent: "flex-end", alignItems: "center", gap: 10 }, avatar: { height: 120, width: 136 },
});
