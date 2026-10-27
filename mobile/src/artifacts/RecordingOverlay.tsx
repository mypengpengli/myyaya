import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView } from "expo-camera";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { canMountRecordingCamera, failPhoneRecording, getPhoneRecording, recordingCameraReady, stopPhoneRecording, subscribePhoneRecording } from "./phone-recording";

export function RecordingOverlay() {
  const state = useSyncExternalStore(subscribePhoneRecording, getPhoneRecording, getPhoneRecording);
  const camera = useRef<CameraView>(null);
  useEffect(() => {
    if (!["preparing", "recording", "saving"].includes(state.phase)) return;
    const hold = () => holdAmbientMotionFor(6000, "phone-recording");
    hold(); const timer = setInterval(hold, 2000); return () => clearInterval(timer);
  }, [state.phase]);
  useEffect(() => {
    const app = AppState.addEventListener("change", (value) => { if (value !== "active") void stopPhoneRecording(); });
    return () => { app.remove(); void stopPhoneRecording(); };
  }, []);
  if (!["preparing", "recording", "saving"].includes(state.phase) || !canMountRecordingCamera()) return null;
  return <View style={styles.overlay}>
    <CameraView ref={camera} style={styles.camera} mode="video" mute={false} facing={state.camera} videoQuality="720p"
      onMountError={() => failPhoneRecording(state.id)}
      onCameraReady={() => void recordingCameraReady(state.id, () => camera.current!.recordAsync({ maxDuration: 600, maxFileSize: 200 * 1024 * 1024 }), () => camera.current?.stopRecording())} />
    <Text style={styles.notice}>{state.notice}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="停止录像" onPress={() => void stopPhoneRecording()} style={styles.stop}><Text style={styles.text}>停止录像</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ overlay: { position: "absolute", top: "12%", left: "5%", right: "20%", bottom: "12%", borderRadius: 20, overflow: "hidden", backgroundColor: "#101726" },
  camera: { flex: 1 }, notice: { position: "absolute", top: 10, left: 10, color: "white", fontSize: 12, backgroundColor: "#101726bb", padding: 8 },
  stop: { position: "absolute", bottom: 10, right: 10, borderRadius: 14, padding: 10, backgroundColor: "#9e2938" }, text: { color: "white", fontSize: 14 } });
