import { startLooiRobotAutoConnection } from "@/src/device-tools/looi-robot-autoconnect";
import {
  getLooiRobotRuntimeState,
  performLooiCharacterReaction,
} from "@/src/device-tools/looi-robot";
import { voiceRuntime } from "@/src/perceivers/voice-runtime";
import { useAppMode } from "@/src/setup/use-app-mode";
import { ConversationOverlay } from "@/src/ui/ConversationOverlay";
import { ImageOverlay } from "@/src/ui/ImageOverlay";
import { looiTheme } from "@/src/ui/looi-theme";
import { RobotFace } from "@/src/ui/RobotFace";
import { chineseVoice, resumeAutomaticChineseVoice } from "@/src/voice/chinese-voice-runtime";
import { getCompanionProgress, subscribeCompanionProgress } from "@/src/agent/companion-progress";
import { ResultOverlay } from "@/src/artifacts/ResultOverlay";
import { resultPresentation } from "@/src/artifacts/presentation";
import { getPhoneRecording, subscribePhoneRecording } from "@/src/artifacts/phone-recording";
import { executeChineseRobotCommand, isChineseRobotCommandExecuting } from "@/src/device-tools/chinese-robot-control";
import { noteSocialAttentionInteraction } from "@/src/core/social-attention";
import { wakeRobotFromFace } from "@/src/core/sleep-mode";
import { setMainScreenFocused } from "@/src/core/main-screen-presence";
import { useUserStore } from "@/src/store/user";
import { useConversationStore } from "@/src/store/conversation";
import { useUiText } from "@/src/i18n/use-ui-text";
import { recordDiagnosticEvent } from "@/src/diagnostics/diagnostic-log";
import { triggerCharacterReaction } from "@/src/character/character-reaction";
import { classifyFaceTapImmediateRoute } from "@/src/character/face-tap-routing";
import { isDrivingControlSessionActive } from "@/src/voice/driving-control-session";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";



export default function IndexScreen() {
  const appMode = useAppMode();
  const router = useRouter();
  const sleepTapAtRef = useRef(0);
  const idleTapCountRef = useRef(0);
  const idleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFocusedMainOnceRef = useRef(false);
  const robotSleeping = useUserStore((state) => state.robotSleeping);
  const { t } = useUiText();

  useEffect(() => () => {
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = null;
  }, []);

  useEffect(() => {
    startLooiRobotAutoConnection().catch((error) => {
      console.warn("[Home] LOOI robot auto-connect failed:", error);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      setMainScreenFocused(true);
      const returningFromNavigation = hasFocusedMainOnceRef.current;
      hasFocusedMainOnceRef.current = true;
      recordDiagnosticEvent("navigation", "main-focused", {
        reason: returningFromNavigation ? "navigation-return" : "initial",
      });

      if (appMode === "legacy_realtime" && !useUserStore.getState().robotSleeping) {
        if (returningFromNavigation) {
          // Returning from Settings/another in-app route is an attention signal
          // just like fresh launch. Do not require Луи/Макс or a face tap.
          void voiceRuntime.resumeMainScreenConversation("navigation-return").catch((error) => {
            console.warn("[Home] Failed to resume conversation on navigation return:", error);
          });
        } else {
          // Preserve the existing fresh-launch auto-listen timer; only make sure
          // we re-arm voice runtime on focus and its wakeword substrate is healthy.
          void voiceRuntime.rearmWakewordAfterNavigation().catch((error) => {
            console.warn("[Home] Failed to re-arm voice runtime on initial focus:", error);
          });
        }
      }

      return () => {
        setMainScreenFocused(false);
        recordDiagnosticEvent("navigation", "main-blurred");
        // Internal navigation is not Android background. It has its own explicit
        // Realtime ownership boundary so Settings never inherits a live session.
        void voiceRuntime.suspendMainScreenConversation("navigation-main-blur").catch((error) => {
          console.warn("[Home] Failed to suspend Realtime on main blur:", error);
        });
      };
    }, [appMode])
  );

  const runIdlePhysicalReaction = useCallback((reaction: "annoyed" | "angry") => {
    const current = getLooiRobotRuntimeState();
    if (!current.connected || current.motionActive || isDrivingControlSessionActive()) return;
    void performLooiCharacterReaction(reaction).catch((error) => {
      recordDiagnosticEvent("character", "tap-physical-reaction-skipped", {
        reaction,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);

  const handleAwakeFaceTap = useCallback(() => {
    if (appMode === "local" && ["thinking", "speaking"].includes(chineseVoice.getSnapshot().phase)) {
      chineseVoice.interrupt();
      void executeChineseRobotCommand({ kind: "stop" }).catch(() => {});
      return;
    }
    if (appMode === "local") {
      if (getLooiRobotRuntimeState().motionActive || isDrivingControlSessionActive() || isChineseRobotCommandExecuting()) {
        void executeChineseRobotCommand({ kind: "stop" }).catch((error) => {
          console.warn("[Home] Local touch stop failed:", error);
        });
        return;
      }
      noteSocialAttentionInteraction("local-face-tap");
      triggerCharacterReaction("startled", { durationMs: 520, source: "local-face-tap" });
      return;
    }
    const current = getLooiRobotRuntimeState();
    const voiceState = useUserStore.getState().voiceState;
    const conversation = useConversationStore.getState();

    const immediateRoute = classifyFaceTapImmediateRoute({
      motionActive: current.motionActive,
      drivingSessionActive: isDrivingControlSessionActive(),
      conversationProcessing: conversation.isProcessing,
      conversationSpeaking: conversation.isSpeaking,
      voiceState,
    });

    // Hard safety/control ownership and real Classic output/processing states
    // always win immediately. Passive listening deliberately falls through to
    // the burst discriminator so 2+/3+ taps are not swallowed after launch.
    if (immediateRoute !== "burst") {
      recordDiagnosticEvent("character", "face-tap-routed", { route: immediateRoute, voiceState });
      void voiceRuntime.trigger().catch((error) => {
        console.warn("[Home] Face immediate trigger failed:", error);
      });
      return;
    }

    idleTapCountRef.current += 1;
    if (idleTapTimerRef.current) clearTimeout(idleTapTimerRef.current);
    idleTapTimerRef.current = setTimeout(() => {
      idleTapTimerRef.current = null;
      const taps = idleTapCountRef.current;
      idleTapCountRef.current = 0;
      if (taps <= 1) {
        recordDiagnosticEvent("character", "face-tap-routed", { route: "classic-attention", taps, voiceState });
        // Keep single tap = conversation, but give the face a quick startle
        // before the normal attention/listening state takes over. No motor/head
        // noise is generated here, so the microphone capture stays clean.
        triggerCharacterReaction("startled", { durationMs: 520, source: "single-face-tap" });
        void voiceRuntime.trigger().catch((error) => {
          console.warn("[Home] Face attention trigger failed:", error);
        });
        return;
      }

      void (async () => {
        const prepared = await voiceRuntime.prepareIdleCharacterReaction();
        if (!prepared.ok && prepared.reason === "realtime-active") {
          // Realtime listening/speaking must not swallow the Character Layer.
          // A burst first interrupts any current model output, then keeps the
          // same 2-tap annoyed / 3+-tap angry reaction used while Classic is idle.
          await voiceRuntime.trigger().catch((error) => {
            console.warn("[Home] Realtime face burst interrupt failed:", error);
          });
          if (taps === 2) {
            recordDiagnosticEvent("character", "face-tap-routed", { route: "character-annoyed", taps, prepared: "realtime-interrupted" });
            triggerCharacterReaction("annoyed", { durationMs: 1_050, source: "double-face-tap" });
            recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "annoyed" });
            runIdlePhysicalReaction("annoyed");
          } else {
            recordDiagnosticEvent("character", "face-tap-routed", { route: "character-angry", taps, prepared: "realtime-interrupted" });
            triggerCharacterReaction("angry", { durationMs: 1_450, source: "repeated-face-tap" });
            recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "angry" });
            runIdlePhysicalReaction("angry");
          }
          return;
        }
        if (!prepared.ok) {
          recordDiagnosticEvent("character", "face-tap-routed", {
            route: "classic-active-after-burst",
            taps,
            reason: prepared.reason,
          });
          await voiceRuntime.trigger().catch((error) => {
            console.warn("[Home] Face burst fallback trigger failed:", error);
          });
          return;
        }

        if (taps === 2) {
          recordDiagnosticEvent("character", "face-tap-routed", { route: "character-annoyed", taps, prepared: prepared.reason });
          triggerCharacterReaction("annoyed", { durationMs: 1_050, source: "double-face-tap" });
          recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "annoyed" });
          runIdlePhysicalReaction("annoyed");
          return;
        }
        recordDiagnosticEvent("character", "face-tap-routed", { route: "character-angry", taps, prepared: prepared.reason });
        triggerCharacterReaction("angry", { durationMs: 1_450, source: "repeated-face-tap" });
        recordDiagnosticEvent("character", "face-tap-burst", { taps, reaction: "angry" });
        runIdlePhysicalReaction("angry");
      })();
    }, 280);
  }, [appMode, runIdlePhysicalReaction]);

  const speech = useSyncExternalStore(chineseVoice.subscribe, chineseVoice.getSnapshot, chineseVoice.getSnapshot);
  const progress = useSyncExternalStore(subscribeCompanionProgress, getCompanionProgress, getCompanionProgress);
  const presentation = useSyncExternalStore(resultPresentation.subscribe, resultPresentation.getSnapshot, resultPresentation.getSnapshot);
  const recording = useSyncExternalStore(subscribePhoneRecording, getPhoneRecording, getPhoneRecording);
  useFocusEffect(useCallback(() => { if (appMode === "local") resumeAutomaticChineseVoice(); }, [appMode]));
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dx < -30 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_, gesture) => { if (gesture.dx < -65) router.push("/menu"); },
  }), [router]);
  const interactionNotice = speech.notice && !/^(离线监听中|请说一句话)/.test(speech.notice) ? speech.notice : "";
  const caption = ["preparing", "recording", "saving"].includes(recording.phase) ? recording.notice
    : robotSleeping ? (appMode === "local" ? "休息中" : t("home.wakeFromSleep")) : speech.phase === "loading" ? "正在准备…"
    : speech.phase === "thinking" ? progress.label || "正在想怎么回答"
    : speech.phase === "error" ? speech.notice || "语音暂不可用" : speech.phase === "speaking" ? "小丫在说话"
    : speech.partial || (speech.phase === "listening" ? interactionNotice || "小丫 · 我在听" : "小丫");
  return <SafeAreaView style={styles.home} {...swipe.panHandlers}>
    <View style={presentation.active && appMode === "local" ? styles.smallFace : styles.faceStage}>
      <RobotFace mode={presentation.active && appMode === "local" ? "avatar" : "fullscreen"} labelVisible={false}
        onLongPress={() => router.push("/menu")}
        onPress={() => {
          if (robotSleeping) {
            sleepTapAtRef.current = 0;
            void wakeRobotFromFace().catch((error) => console.warn("[Home] Wake failed:", error));
          } else handleAwakeFaceTap();
        }} />
    </View>
    {appMode === "local" || robotSleeping ? <View pointerEvents="none" style={styles.caption}>
      <Text numberOfLines={1} style={styles.captionText}>{caption}</Text>
    </View> : <ConversationOverlay />}
    {!robotSleeping && appMode === "legacy_realtime" ? <ImageOverlay /> : null}
    {appMode === "local" ? <ResultOverlay /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="打开菜单，也可以向左滑动" onPress={() => router.push("/menu")} style={styles.menuHandle}>
      <Text style={styles.handle}>‹</Text>
    </Pressable>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  home: { flex: 1, backgroundColor: looiTheme.bg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  faceStage: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
  smallFace: { position: "absolute", right: "2%", top: "35%", bottom: "35%", width: "15%", alignItems: "center", justifyContent: "center" },
  caption: { position: "absolute", bottom: 8, left: 16, right: 48, alignItems: "flex-start" },
  captionText: { color: looiTheme.muted, fontSize: 10, opacity: 0.65 },
  menuHandle: { position: "absolute", right: 0, top: "38%", bottom: "38%", width: 38, justifyContent: "center", alignItems: "center" },
  handle: { color: looiTheme.muted, fontSize: 25, opacity: 0.35 },
});
