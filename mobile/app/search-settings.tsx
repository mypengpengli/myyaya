import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { TavilyConnectionSettings } from "@/src/search/TavilyConnectionSettings";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export default function SearchSettings() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>联网搜索</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/menu")} style={styles.back}><Text style={styles.link}>返回菜单</Text></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><TavilyConnectionSettings /></ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.bg }, header: { padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: theme.text, fontSize: 22 }, back: { padding: 10 }, link: { color: theme.cyan, fontSize: 15 }, content: { padding: 20 } });
