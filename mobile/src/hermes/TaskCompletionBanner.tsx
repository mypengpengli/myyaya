import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { getHermesTaskService } from "./task-runtime";
import { terminalRun } from "./run-protocol";

export function TaskCompletionBanner() {
  const router = useRouter(), segments = useSegments(), service = getHermesTaskService();
  const tasks = useSyncExternalStore(service.subscribe, service.list, service.list);
  const task = tasks.find((item) => terminalRun(item.status) && item.delivery && !item.delivery.dismissed);
  if (!task || segments.some((part) => String(part) === "tasks") || segments[0] === "onboarding") return null;
  const label = task.status === "completed" ? task.delivery?.files === "pending" ? "任务完成，正在接收文件" : task.delivery?.files === "failed" ? "任务完成，文件接收需要重试" : "后台任务已完成" : "后台任务有新结果";
  return <View style={styles.banner}>
    <Pressable accessibilityRole="button" onPress={() => { service.updateDelivery(task.id, { dismissed: true }); router.navigate({ pathname: "/tasks", params: { taskId: task.id } }); }} style={styles.body}>
      <Text style={styles.title}>{label}</Text><Text numberOfLines={1} style={styles.detail}>{task.input} · 点此查看</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="关闭任务通知" onPress={() => service.updateDelivery(task.id, { dismissed: true, notified: true })}><Text style={styles.close}>×</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ banner: { position: "absolute", top: 20, left: "6%", width: "65%", padding: 12, borderRadius: 14, backgroundColor: "#172334f0", flexDirection: "row", alignItems: "center", gap: 10 }, body: { flex: 1 }, title: { color: "#4bd8f5", fontSize: 14 }, detail: { color: "#c3cfde", fontSize: 12, marginTop: 4 }, close: { color: "#c3cfde", fontSize: 28, paddingHorizontal: 12 } });
