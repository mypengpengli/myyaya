import { BasePerceiver } from "../core/perceiver";
import { getRuntimeProfile } from "../core/runtime-profile";
import { isRealtimeConversationMode, useUserStore } from "../store/user";
import { getVoiceModule } from "../voice/lazy-services";
import { isLegacyVoiceReady } from "../setup/setup-readiness";
import { getAppMode, subscribeAppMode } from "../setup/setup-storage";

type LegacyVoice = Awaited<ReturnType<typeof getVoiceModule>>["voicePerceiver"];

/** Keep all native voice ownership changes ordered, including lazy startup. */
export class VoiceRuntime extends BasePerceiver {
  name = "voice";
  private loaded = false;
  private unsubscribeVoice: (() => void) | null = null;
  private observationGeneration = -1;
  private lifecycleGeneration = 0;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private cleanupQueue: Promise<void> = Promise.resolve();
  private cachedVoice: LegacyVoice | null = null;

  private isCurrent(generation: number): boolean {
    return generation === this.lifecycleGeneration && getAppMode() === "legacy_realtime";
  }

  private enqueue<T>(task: (generation: number) => Promise<T>, cancelled: T): Promise<T> {
    const generation = this.lifecycleGeneration;
    const queued = this.lifecycleQueue.then(() => this.isCurrent(generation) ? task(generation) : cancelled);
    this.lifecycleQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async canUseLegacyVoice(generation: number): Promise<boolean> {
    const ready = await isLegacyVoiceReady();
    if (!this.isCurrent(generation)) return false;
    if (ready) return true;
    await this.stop();
    return false;
  }

  private async getVoice(generation: number): Promise<LegacyVoice | null> {
    const voicePerceiver = this.cachedVoice ?? (await getVoiceModule()).voicePerceiver;
    this.cachedVoice = voicePerceiver;
    this.loaded = true;
    if (!this.isCurrent(generation)) return null;
    if (this.observationGeneration !== generation) {
      this.unsubscribeVoice?.();
      this.observationGeneration = generation;
      this.unsubscribeVoice = voicePerceiver.onObservation((observation) => {
        if (this.isActive && this.isCurrent(generation)) this.emit(observation);
      });
    }
    return voicePerceiver;
  }

  private async stopLoadedVoice(): Promise<void> {
    this.unsubscribeVoice?.();
    this.unsubscribeVoice = null;
    this.observationGeneration = -1;
    await this.cachedVoice?.stop();
  }

  start(): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation)) return;
      if (this.isActive) return this.syncForGeneration(generation);
      this.isActive = true;
      const prefs = useUserStore.getState().preferences;
      if (!getRuntimeProfile().allowsWakewordAutostart || !prefs.wakeWordEnabled) return;
      const voice = await this.getVoice(generation);
      if (voice) await voice.start();
    }, undefined);
  }

  sync(): Promise<void> {
    return this.enqueue((generation) => this.syncForGeneration(generation), undefined);
  }

  private async syncForGeneration(generation: number): Promise<void> {
    if (!await this.canUseLegacyVoice(generation) || !this.isActive) return;
    const prefs = useUserStore.getState().preferences;
    if (!getRuntimeProfile().allowsWakewordAutostart || !prefs.wakeWordEnabled) {
      if (!this.loaded) return;
      const voice = await this.getVoice(generation);
      if (voice) await voice.syncWakewordRuntime();
      return;
    }
    const voice = await this.getVoice(generation);
    if (!voice) return;
    await voice.start();
    if (!this.isCurrent(generation)) return;
    await voice.syncConversationMode();
    if (this.isCurrent(generation)) await voice.syncWakewordRuntime();
  }

  rearmWakewordAfterNavigation(): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation) || !this.isActive || useUserStore.getState().robotSleeping) return;
      const voice = await this.getVoice(generation);
      if (!voice) return;
      await voice.start();
      if (this.isCurrent(generation)) await voice.rearmWakewordAfterNavigation();
    }, undefined);
  }

  suspendMainScreenConversation(reason = "main-screen-blur"): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!this.loaded) return;
      const { realtimeConversationService } = await import("../voice/realtime-conversation");
      if (this.isCurrent(generation) && realtimeConversationService.isActive) await realtimeConversationService.stop(reason);
    }, undefined);
  }

  resumeMainScreenConversation(source: "navigation-return" | "foreground-resume"): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation) || !this.isActive || useUserStore.getState().robotSleeping) return;
      const voice = await this.getVoice(generation);
      if (!voice) return;
      await voice.start();
      if (!this.isCurrent(generation)) return;
      const [{ realtimeConversationService }, { useConversationStore }, { recordDiagnosticEvent }] = await Promise.all([
        import("../voice/realtime-conversation"), import("../store/conversation"), import("../diagnostics/diagnostic-log"),
      ]);
      if (!this.isCurrent(generation)) return;
      const conversation = useConversationStore.getState();
      const voiceState = useUserStore.getState().voiceState;
      if (realtimeConversationService.isActive || conversation.isListening || conversation.isProcessing || conversation.isSpeaking ||
          voiceState === "processing" || voiceState === "speaking" || voiceState === "verifying") {
        recordDiagnosticEvent("navigation", "main-return-auto-listen-skipped", { source, reason: "conversation-busy" });
        return;
      }
      const conversationMode = useUserStore.getState().preferences.conversationMode;
      recordDiagnosticEvent("navigation", "main-return-auto-listen", { source, conversationMode });
      if (isRealtimeConversationMode(conversationMode)) await voice.resumeRealtimeConversationFromMain(source);
      else await voice.trigger();
    }, undefined);
  }

  stop(): Promise<void> {
    // Invalidate pending starts immediately. Cleanup must preempt long-running
    // trigger/resume/network work: that work may itself need stop to complete.
    // A new start waits only for cleanup, never for the cancelled interaction.
    this.lifecycleGeneration += 1;
    this.isActive = false;
    this.unsubscribeVoice?.();
    this.unsubscribeVoice = null;
    this.observationGeneration = -1;
    const queued = this.cleanupQueue.then(() => this.stopLoadedVoice());
    this.cleanupQueue = queued.then(() => undefined, () => undefined);
    this.lifecycleQueue = this.cleanupQueue;
    return queued;
  }

  trigger(): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation)) return;
      const voice = await this.getVoice(generation);
      if (!voice) return;
      this.isActive = true;
      await voice.start();
      if (this.isCurrent(generation)) await voice.trigger();
    }, undefined);
  }

  interruptAndListen(): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation)) return;
      const voice = await this.getVoice(generation);
      if (!voice) return;
      this.isActive = true;
      await voice.start();
      if (this.isCurrent(generation)) await voice.interruptAndListen("tap");
    }, undefined);
  }

  applyLiveRealtimePreferences(source: string): Promise<boolean> {
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation)) return false;
      const { realtimeConversationService } = await import("../voice/realtime-conversation");
      if (!this.isCurrent(generation) || !realtimeConversationService.isActive) return false;
      realtimeConversationService.applySessionPreferences(source);
      return true;
    }, false);
  }

  prepareIdleCharacterReaction(): Promise<{ ok: boolean; reason: string }> {
    if (getAppMode() === "local") return Promise.resolve({ ok: true, reason: "local-mode" });
    return this.enqueue(async (generation) => {
      if (!await this.canUseLegacyVoice(generation)) return { ok: false, reason: "legacy-setup-required" };
      const voice = await this.getVoice(generation);
      if (!voice) return { ok: false, reason: "runtime-stopped" };
      this.isActive = true;
      await voice.start();
      if (!this.isCurrent(generation)) return { ok: false, reason: "runtime-stopped" };
      return voice.prepareIdleCharacterReaction();
    }, { ok: false, reason: "runtime-stopped" });
  }

  finishListening(): Promise<void> {
    return this.enqueue(async (generation) => {
      if (!this.loaded || !this.isActive) return;
      const voice = await this.getVoice(generation);
      if (voice) await voice.finishListening();
    }, undefined);
  }
}

export const voiceRuntime = new VoiceRuntime();
subscribeAppMode(() => {
  if (getAppMode() === "local") {
    void voiceRuntime.stop().catch((error) => console.warn("[VoiceRuntime] Local-mode cleanup failed:", error));
  }
});
