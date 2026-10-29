import { useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { getSkillService } from "@/src/skills/skill-runtime";
import { skillMarkdown } from "@/src/skills/skill-service";
import { phoneTools } from "@/src/agent/phone-tools";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export default function SkillLibrary() {
  const router = useRouter(), service = getSkillService();
  const skills = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
  const [expanded, setExpanded] = useState<string>(), [notice, setNotice] = useState("");
  const available = phoneTools.map((tool) => tool.name);
  const change = (action: () => void) => { try { action(); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "技能保存失败"); } };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>小丫的技能</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/menu")}><Text style={styles.link}>返回菜单</Text></Pressable></View>
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.help}>可以说“把刚才成功的做法总结成技能”或“教你一个流程，以后这样做”。下次任务匹配时，小丫会按需读取步骤；重开 App 后仍保留。</Text>
      {notice ? <Text style={styles.help}>{notice}</Text> : null}
      {!skills.length ? <Text style={styles.empty}>还没有保存技能。先完成一个流程，再让小丫总结学习。</Text> : null}
      {skills.map((skill) => {
        const version = skill.current, missing = service.missingTools(skill, available), open = expanded === skill.name;
        return <View key={skill.name} style={styles.card}>
          <Text style={styles.name}>{version.title}</Text>
          <Text style={styles.help}>{version.description}</Text>
          <Text style={styles.meta}>v{version.revision} · {skill.enabled ? "已启用" : "已停用"} · 已加载 {skill.uses} 次 · {version.source === "experience" ? "经验整理" : "用户教给"}</Text>
          {version.triggers.length ? <Text style={styles.help}>触发短语：{version.triggers.join("、")}</Text> : null}
          {missing.length ? <Text style={styles.help}>暂缺工具：{missing.join("、")}，补齐前不会自动使用。</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => setExpanded(open ? undefined : skill.name)}><Text style={styles.link}>{open ? "收起步骤" : "查看步骤"}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => change(() => { service.setEnabled(skill.name, !skill.enabled); })}><Text style={styles.link}>{skill.enabled ? "停用技能" : "启用技能"}</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => void Share.share({ title: version.title, message: skillMarkdown(version) }).catch(() => setNotice("未能分享技能"))}><Text style={styles.link}>分享 SKILL.md 内容</Text></Pressable>
          </View>
          {open ? <View style={styles.steps}>
            <Text selectable style={styles.help}>{skillMarkdown(version)}</Text>
            <Text style={styles.meta}>依赖工具：{version.requiredTools.join("、") || "无"}</Text>
            {version.evidenceTools.length ? <Text style={styles.meta}>成功调用依据：{version.evidenceTools.map((name) => name === "assistant_reply" ? "已完成的对话输出" : name).join("、")}</Text> : null}
            <Text style={styles.meta}>“经验整理”表示有工具调用依据，不代表所有场景都经过验证。</Text>
            {skill.history.slice().reverse().map((previous) => <Pressable key={previous.revision} accessibilityRole="button"
              onPress={() => change(() => { service.restore(skill.name, previous.revision); })} style={styles.history}>
              <Text style={styles.link}>恢复 v{previous.revision} 的步骤</Text></Pressable>)}
          </View> : null}
        </View>;
      })}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.text, fontSize: 22 }, body: { padding: 24, gap: 18, paddingBottom: 42 }, card: { padding: 20, borderRadius: 18, gap: 12, backgroundColor: theme.bgRaised },
  name: { color: theme.text, fontSize: 19 }, help: { color: theme.muted, lineHeight: 24, fontSize: 15 }, meta: { color: theme.muted, fontSize: 12, lineHeight: 20 },
  link: { color: theme.cyan, fontSize: 15, paddingVertical: 8 }, empty: { color: theme.text, paddingVertical: 24 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 26 },
  steps: { gap: 12, borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 16 }, history: { alignSelf: "flex-start" } });
