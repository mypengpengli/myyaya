import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { listArtifacts, presentArtifact } from "@/src/artifacts/artifact-store";
import { getMediaJobs } from "@/src/artifacts/media-jobs";
import { looiTheme as theme } from "@/src/ui/looi-theme";
const labels = { submitting: "正在提交", running: "正在生成", completed: "已保存", failed: "生成失败", unknown: "结果待核对" };
export default function Artifacts() {
  const router = useRouter(), service = getMediaJobs();
  const jobs = useSyncExternalStore(service.subscribe, service.list, service.list);
  const [items, setItems] = useState(listArtifacts);
  useFocusEffect(useCallback(() => { setItems(listArtifacts()); }, []));
  useEffect(() => { setItems(listArtifacts()); }, [jobs]);
  const open = (id: string) => { presentArtifact(id); router.replace("/"); };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>作品与录像</Text><Pressable onPress={() => router.replace("/menu")}><Text style={styles.link}>返回菜单</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.body}>
      {jobs.filter((job) => job.status !== "completed").map((job) => <View key={job.id} style={styles.card}>
        <Text style={styles.text}>{labels[job.status]} · {job.kind === "video" ? "视频" : "图片"}</Text>
        <Text style={styles.detail}>{job.prompt}</Text><Text style={styles.detail}>{job.notice}</Text>
      </View>)}
      {items.map((item) => <Pressable accessibilityRole="button" key={item.id} style={styles.card} onPress={() => open(item.id)}>
        <Text style={styles.text}>{item.title}</Text><Text style={styles.detail}>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.kind === "video" ? "录像 / 视频" : item.kind === "image" ? "图片" : "文档"}{item.parentId ? " · 修改版本" : ""}</Text>
      </Pressable>)}
      {!items.length && !jobs.length ? <Text style={styles.detail}>拍摄、生成的作品会保存在这里。关闭预览后仍可重新打开。</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: theme.text, fontSize: 22 }, link: { color: theme.cyan, fontSize: 16 }, body: { padding: 24, gap: 14 },
  card: { padding: 18, borderRadius: 16, backgroundColor: theme.rail, gap: 8 }, text: { color: theme.text, fontSize: 16 }, detail: { color: theme.muted, fontSize: 12, lineHeight: 20 } });
