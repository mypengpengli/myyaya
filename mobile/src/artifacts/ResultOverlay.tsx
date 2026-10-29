import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { resultPresentation as presentation, presentationHint, type PresentationItem } from "./presentation";
import { videoControl } from "./video-control";
import { DocumentResult } from "./DocumentResult";
import { findArtifact, selectArtifact } from "./artifact-store";

function VideoResult({ item }: { item: PresentationItem }) {
  const player = useVideoPlayer(item.uri, (instance) => { instance.loop = false; instance.play(); });
  useEffect(() => {
    const releaseControl = videoControl.bind(item.id, player);
    player.timeUpdateEventInterval = 0.25;
    let last = 0;
    const subscriptions = [player.addListener("playToEnd", () => presentation.videoEnded(item.id)),
      player.addListener("playingChange", ({ isPlaying }) => { if (isPlaying) presentation.videoResumedOrSeeking(item.id); }),
      player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") presentation.loaded(item.id);
        else if (status === "loading" || status === "error") presentation.loadingOrFailed(item.id);
      }),
      player.addListener("timeUpdate", ({ currentTime }) => {
        if (Math.abs(currentTime - last) > 1 || currentTime < last) presentation.videoResumedOrSeeking(item.id);
        last = currentTime;
      })];
    if (player.status === "readyToPlay") presentation.loaded(item.id);
    const app = AppState.addEventListener("change", (state) => { if (state !== "active") player.pause(); });
    return () => { releaseControl(); subscriptions.forEach((subscription) => subscription.remove()); app.remove(); };
  }, [player, item.id]);
  return <VideoView player={player} nativeControls contentFit="contain" surfaceType="textureView" style={styles.content} />;
}
export function ResultOverlay() {
  const state = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (state.active) { const item = findArtifact(state.active.id); if (item) selectArtifact(item); } }, [state.active?.id]);
  useEffect(() => {
    presentation.suspend(AppState.currentState !== "active");
    const app = AppState.addEventListener("change", (value) => presentation.suspend(value !== "active"));
    const timer = setInterval(() => { presentation.tick(); setNow(Date.now()); }, 250);
    return () => { app.remove(); clearInterval(timer); };
  }, []);
  if (!state.active) return null;
  const item = state.active;
  return <View style={styles.overlay} onTouchStart={() => presentation.interact()}>
    {item.kind === "video" ? <VideoResult key={item.id} item={item} /> : item.kind === "image" ?
      <Image key={item.id} source={{ uri: item.uri }} resizeMode="contain" style={styles.content}
        onLoad={() => presentation.loaded(item.id)} onError={() => presentation.loadingOrFailed(item.id)} /> :
      <DocumentResult key={item.id} item={item} />}
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel={state.pinned ? "取消固定" : "固定结果"} onPress={() => presentation.pin()} style={styles.button}><Text style={styles.text}>{state.pinned ? "已固定" : "固定"}</Text></Pressable>
      <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭结果" onPress={() => presentation.close(false)} style={styles.button}><Text style={styles.text}>×</Text></Pressable>
    </View>
    <Text style={[styles.countdown, item.kind === "video" && styles.videoCountdown]}>{presentationHint(state, now)}</Text>
  </View>;
}
const styles = StyleSheet.create({ overlay: { position: "absolute", top: "8%", bottom: "10%", left: "5%", right: "18%", backgroundColor: "#0b111b", borderRadius: 20, overflow: "hidden" },
  content: { width: "100%", height: "100%" }, document: { flex: 1, marginTop: 60, padding: 24 }, text: { color: "#edf4ff", fontSize: 17, lineHeight: 26 },
  top: { position: "absolute", left: 8, right: 8, top: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  button: { backgroundColor: "#172334ee", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 }, title: { color: "#b1bdcf", flex: 1, fontSize: 12 },
  countdown: { position: "absolute", bottom: 10, right: 10, color: "#edf4ff", fontSize: 12, backgroundColor: "#172334dd", borderRadius: 8, padding: 7 },
  videoCountdown: { bottom: 64 } });
