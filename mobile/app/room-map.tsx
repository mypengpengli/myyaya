import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { NavigationProbeSettings } from "@/src/navigation/NavigationProbeSettings";
import { looiTheme as theme } from "@/src/ui/looi-theme";

export default function RoomMapPage() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <Text style={styles.title}>房间地图</Text>
      <Pressable accessibilityRole="button" onPress={() => router.replace("/menu")}>
        <Text style={styles.link}>返回菜单</Text>
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.body}>
      <NavigationProbeSettings />
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: { padding: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: theme.text, fontSize: 22 }, link: { color: theme.cyan, fontSize: 16, padding: 8 },
  body: { paddingHorizontal: 24, paddingBottom: 28 },
});
