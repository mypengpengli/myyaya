import { useMemo } from "react";
import { Alert, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { looiTheme as theme } from "@/src/ui/looi-theme";
import { useAppMode } from "@/src/setup/use-app-mode";
import { useUiText } from "@/src/i18n/use-ui-text";
import { selectPhotosIntoCurrentDiscussion } from "@/src/vision/photo-picker-context";
import { subscribeMainScreenFocused } from "@/src/core/main-screen-presence";

export default function CompanionMenu() {
  const router = useRouter();
  const appMode = useAppMode();
  const compact = useWindowDimensions().height < 500;
  const { t } = useUiText();
  const choosePhotos = () => {
    // The photo service restores a face conversation after the system picker.
    // Re-enter that route before starting the service, keeping audio ownership valid.
    const unsubscribe = subscribeMainScreenFocused((focused) => {
      if (!focused) return;
      unsubscribe(); clearTimeout(timeout);
      void selectPhotosIntoCurrentDiscussion().catch(() => Alert.alert(t("home.photoPickerErrorTitle"), t("home.photoPickerErrorBody")));
    });
    const timeout = setTimeout(unsubscribe, 10_000);
    router.replace("/");
  };
  const close = () => router.replace("/");
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dx > 30 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_, gesture) => { if (gesture.dx > 65) close(); },
  }), [router]);
  const items = [
    { title: "连接 LOOI", detail: "连接与授权", icon: "◉", path: "/onboarding?step=robot" },
    { title: "语音与声音", detail: "唤醒与音色", icon: "♪", path: "/voice-settings" },
    { title: "模型连接", detail: "自己的中转站", icon: "✦", path: "/model-settings" },
    { title: "联网搜索", detail: "Tavily 连接与修改", icon: "⌕", path: "/search-settings" },
    { title: "小丫的技能", detail: "已学会的做法与步骤", icon: "◇", path: "/skills" },
    { title: "作品与录像", detail: "查看或重新播放", icon: "▧", path: "/artifacts" },
    { title: "设置", detail: "外观、服务与更新", icon: "⚙", path: "/settings" },
    { title: "任务记录", detail: "查看进度与结果", icon: "▤", path: "/tasks" },
  ];
  return <SafeAreaView style={styles.safe} {...swipe.panHandlers}>
    <View style={styles.header}><Text style={styles.title}>小丫</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭菜单，返回表情" onPress={close}><Text style={styles.close}>×</Text></Pressable>
    </View>
    <View style={styles.grid}>{items.map((item) => <Pressable key={item.path} accessibilityRole="button"
      onPress={() => router.push(item.path as never)} style={[styles.tile, compact && styles.compactTile]}>
      <Text style={styles.icon}>{item.icon}</Text><Text style={styles.label}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text>
    </Pressable>)}
      {appMode === "legacy_realtime" ? <Pressable accessibilityRole="button" accessibilityLabel={t("home.choosePhotosA11y")} onPress={choosePhotos} style={[styles.tile, compact && styles.compactTile]}>
        <Text style={styles.icon}>▧</Text><Text style={styles.label}>选择照片</Text>
      </Pressable> : null}
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 22 },
  title: { color: theme.text, fontSize: 24, fontWeight: "600" }, close: { color: theme.muted, fontSize: 34, paddingHorizontal: 14 },
  grid: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, padding: 20, flexWrap: "wrap" },
  tile: { width: "21%", minWidth: 120, paddingVertical: 22, alignItems: "center", gap: 10, borderRadius: 28, backgroundColor: theme.rail },
  compactTile: { paddingVertical: 14, gap: 8 },
  icon: { fontSize: 32, color: theme.cyan }, label: { color: theme.text, fontSize: 17 }, detail: { color: theme.muted, fontSize: 11 },
});
