import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ModelConnectionForm } from "@/src/agent/ModelConnectionForm";
import { looiTheme as theme } from "@/src/ui/looi-theme";
export default function ModelSettings() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>模型连接</Text>
      <Pressable onPress={() => router.replace("/menu")}><Text style={styles.link}>返回菜单</Text></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled"><ModelConnectionForm /></ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20,
  flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, title: { fontSize: 22, color: theme.text }, link: { color: theme.cyan, fontSize: 16 } });
