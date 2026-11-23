import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Vosk from "../../modules/vosk-command-recognizer";
import { CameraView } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { photoCapture } from "./phone-camera";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

export function PhotoCaptureOverlay() {
  const camera = useRef<CameraView>(null);
  const state = useSyncExternalStore(photoCapture.subscribe, photoCapture.getSnapshot, photoCapture.getSnapshot);
  useEffect(() => {
    const app = AppState.addEventListener("change", (value) => { if (value !== "active") photoCapture.cancel(); });
    return () => { app.remove(); photoCapture.cancel(); };
  }, []);
  useEffect(() => {
    if (state.phase === "idle") return;
    const hold = () => { holdAmbientMotionFor(6000, "photo-review"); holdSocialAttentionMotionFor(6000, "photo-review"); };
    hold(); const timer = setInterval(hold, 2000); return () => clearInterval(timer);
  }, [state.phase]);
  const photoCommandsActive = state.phase === "framing" || state.phase === "review";
  useEffect(() => {
    if (!photoCommandsActive) return;
    void Vosk.setChinesePhotoMode(true).catch(() => {});
    return () => { void Vosk.setChinesePhotoMode(false).catch(() => {}); };
  }, [photoCommandsActive]);
  if (state.phase === "idle") return null;
  return <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.panel}>
    <View style={styles.picture}>{state.phase === "framing" || state.phase === "capturing" ?
      <CameraView key={state.id} ref={camera} style={StyleSheet.absoluteFill} facing={state.camera} mode="picture"
        onMountError={() => photoCapture.cameraFailed(state.id)}
        onCameraReady={() => photoCapture.cameraReady(state.id, async () => {
          const image = await camera.current?.takePictureAsync({ base64: true, quality: 0.8 });
          if (!image) throw new Error("未取得照片");
          try {
            if (!image.base64) throw new Error("未取得照片数据");
            return { mimeType: "image/jpeg", base64: image.base64, width: image.width, height: image.height,
              timestampMs: Date.now(), cameraFacing: state.camera, cameraId: null, autofocusMode: 0, flashAvailable: false,
              aeState: null, awbState: null, afState: null, exposureTimeMs: null, sensitivityIso: null, lowLightLikely: false };
          } finally { if (image.uri) await FileSystem.deleteAsync(image.uri, { idempotent: true }).catch(() => {}); }
        })} /> : state.photo ? <Image resizeMode="contain" style={StyleSheet.absoluteFill} source={{ uri: `data:${state.photo.mimeType};base64,${state.photo.base64}` }} /> : null}</View>
    <Text accessibilityLiveRegion="polite" style={styles.notice}>{state.notice}</Text>
    <View style={styles.actions}>
      <Button label={state.phase === "framing" ? "确定拍摄" : "确定保存"} disabled={state.phase === "framing" ? !state.ready : state.phase !== "review" || !state.photo} onPress={() => void photoCapture.confirm()} />
      <Button label="重拍" disabled={state.phase !== "review"} onPress={() => photoCapture.retake()} />
      <Button label="取消拍照" disabled={state.phase === "saving"} onPress={() => photoCapture.cancel()} />
    </View>
  </Animated.View>;
}
function Button({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.4 }]}><Text style={styles.text}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ panel: { position: "absolute", left: "43%", right: "5%", top: "8%", bottom: "10%", backgroundColor: "#0b111b", borderRadius: 20, padding: 12, gap: 8 },
  picture: { flex: 1, backgroundColor: "#04090f", borderRadius: 12, overflow: "hidden" }, notice: { color: "#b1bdcf", fontSize: 12 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 12 }, button: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: "#172334" }, text: { color: "#edf4ff", fontSize: 15 } });
