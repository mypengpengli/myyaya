import { ChineseCommandGate, compactChinese, isChineseStop, splitChineseWake, type ChineseRobotCommand } from "./chinese-command";
import { CONVERSATION_WINDOW_MS, type ConversationReporter } from "./conversation-feedback";
import type { ViewerVoice } from "./viewer-voice";

type RecognitionEvent = { sessionId: number; text: string; partial: boolean; rms16?: number; droppedChunks?: number; processingMs?: number };

export type ChineseSpeechState = {
  phase: "off" | "loading" | "listening" | "thinking" | "speaking" | "error";
  mode: "wake" | "dictation"; partial: string; transcript: string; notice: string;
  captureActive: boolean; awake: boolean; listeningUntil: number; interim: string; acceptedText?: string;
};
export interface ChineseSpeechNative {
  prepareChinese(): Promise<{ sessionId: number }>;
  startChineseCapture(): Promise<{ running: boolean }>;
  stopChineseCapture(): Promise<void>;
  speakChinese(text: string): Promise<void>;
  stopChineseSpeech(): void;
  addListener(name: "onCommandResult", listener: (event: RecognitionEvent) => void): { remove(): void };
  addListener(name: "onRecognizerError", listener: (event: { message: string }) => void): { remove(): void };
}

/** One owner, ordered native transitions and immediate invalidation on blur/stop. */
export class ChineseVoiceSession {
  private state: ChineseSpeechState = { phase: "off", mode: "wake", partial: "", transcript: "", notice: "", captureActive: false, awake: false, listeningUntil: 0, interim: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private gate = new ChineseCommandGate();
  private subscriptions: { remove(): void }[] = [];
  private sessionId = 0;
  private conversationUntil = 0;
  private windowTimer?: ReturnType<typeof setTimeout>;
  private turn = 0;
  private continuation?: string;
  private continuationTimer?: ReturnType<typeof setTimeout>;
  private response?: AbortController;
  private responseFeedback?: ConversationReporter;
  private speakingText = "";
  private capturePaused = false;
  private lastInputAt = 0;
  constructor(private readonly native: ChineseSpeechNative,
    private readonly permission: () => Promise<boolean>, private readonly allowed: () => boolean,
    private readonly execute: (command: ChineseRobotCommand) => Promise<string>,
    private readonly stopHardware: () => Promise<void> = async () => {},
    private readonly converse?: (text: string, signal: AbortSignal, feedback?: ConversationReporter) => Promise<string>,
    private readonly handlePhotoVoice?: (command: string) => boolean,
    private readonly photoWaitHint?: () => string | undefined,
    private readonly viewerVoice?: ViewerVoice,
    private readonly observe?: (event: string, details: Record<string, number | string | boolean | undefined>) => void) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChineseSpeechState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  private enqueue(work: () => Promise<void>) { this.queue = this.queue.then(work, work).catch(() => {}); return this.queue; }
  private current(generation: number) { return generation === this.generation && this.allowed(); }
  private removeListeners() { this.subscriptions.forEach((item) => item.remove()); this.subscriptions = []; }
  private closeWindow() {
    clearTimeout(this.windowTimer); this.windowTimer = undefined; this.conversationUntil = 0; this.gate.reset();
    this.clearContinuation();
    this.viewerVoice?.reset();
    this.update({ awake: false, listeningUntil: 0 });
  }
  private openWindow() {
    clearTimeout(this.windowTimer); this.conversationUntil = Date.now() + CONVERSATION_WINDOW_MS; this.gate.open(Date.now());
    this.update({ awake: true, listeningUntil: this.conversationUntil });
    const generation = this.generation;
    this.windowTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      if (this.response || this.state.phase === "speaking") { this.openWindow(); return; }
      this.closeWindow(); this.update({ partial: "", notice: "等待唤醒，请说“小丫小丫”" });
    }, CONVERSATION_WINDOW_MS);
  }
  start(mode: "wake" | "dictation" = "wake"): Promise<void> {
    if (this.capturePaused) return Promise.resolve();
    const generation = ++this.generation;
    this.cancelResponse(); this.closeWindow();
    this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    this.update({ phase: "loading", mode, captureActive: false, interim: "", partial: "", notice: "正在准备中文收音，准备好后才能唤醒" });
    return this.enqueue(async () => {
      try {
        await this.native.stopChineseCapture();
        if (!this.current(generation)) return;
        if (!await this.permission()) throw new Error("麦克风权限未允许，请在系统设置中允许小丫使用麦克风");
        if (!this.current(generation)) return;
        const model = await this.native.prepareChinese();
        if (!this.current(generation)) return;
        this.sessionId = model.sessionId;
        this.subscriptions = [
          this.native.addListener("onCommandResult", (event) => {
            if (!this.capturePaused && this.current(generation) && event.sessionId === this.sessionId &&
                ["listening", "thinking", "speaking"].includes(this.state.phase)) this.onResult(event);
          }),
          this.native.addListener("onRecognizerError", () => {
            if (this.current(generation)) {
              void this.stop("离线识别发生错误，请重新开启中文语音");
              this.update({ phase: "error" });
            }
          }),
        ];
        const capture = await this.native.startChineseCapture();
        if (!this.current(generation)) { await this.native.stopChineseCapture(); return; }
        if (!capture?.running) throw new Error("麦克风没有成功启动，请重新开启语音");
        this.update({ phase: "listening", captureActive: true, notice: mode === "wake" ? "等待唤醒，请说“小丫小丫”" : "正在听写一句话" });
      } catch (error) {
        if (generation === this.generation) {
          this.removeListeners(); await this.native.stopChineseCapture().catch(() => {});
          this.update({ phase: "error", captureActive: false, awake: false, notice: error instanceof Error ? error.message : "中文语音启动失败" });
        }
      }
    });
  }
  stop(notice = "中文语音已关闭"): Promise<void> {
    this.cancelResponse(); this.closeWindow();
    ++this.generation; this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    void this.stopHardware().catch(() => {});
    this.update({ phase: "off", captureActive: false, partial: "", interim: "", notice });
    return this.enqueue(async () => { await this.native.stopChineseCapture().catch(() => {}); });
  }
  speak(text: string): Promise<void> {
    this.cancelResponse(); this.closeWindow();
    const generation = ++this.generation;
    void this.stopHardware().catch(() => {});
    this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    this.update({ phase: "speaking", captureActive: false, partial: "", notice: "正在使用系统中文离线音色朗读" });
    return this.enqueue(async () => {
      await this.native.stopChineseCapture().catch(() => {});
      if (!this.current(generation)) return;
      try { await this.native.speakChinese(text); if (this.current(generation)) this.update({ phase: "off", notice: "朗读结束；可重新开启中文语音" }); }
      catch (error) { if (this.current(generation)) this.update({ phase: "error", notice: error instanceof Error ? error.message : "请安装系统中文离线音色" }); }
    });
  }
  private onResult(event: RecognitionEvent) {
    if (!event.text.trim()) {
      if (!event.partial && this.state.partial) {
        this.viewerVoice?.reset();
        const retry = this.state.phase === "listening" && (this.state.awake || this.state.mode === "dictation");
        if (retry && this.state.mode === "wake") this.openWindow();
        this.update({ partial: "", ...(retry ? { notice: "这句没听清，请再说一次" } : {}) });
      }
      return;
    }
    const addressed = splitChineseWake(event.text);
    const command = compactChinese(addressed.command);
    // AEC is enabled natively. This additional guard prevents an exact fragment
    // of our own spoken reply from becoming a wake/STOP command on weak devices.
    if (this.speakingText && !isChineseStop(event.text) && this.speakingText.includes(compactChinese(event.text))) return;
    this.lastInputAt = Date.now();
    if (event.partial) {
      if (this.continuation) this.waitForContinuation();
      this.update({ partial: this.continuation ? this.continuation + event.text : event.text });
      if (this.state.mode === "wake" && (addressed.addressed || this.state.awake && this.state.phase === "listening")) this.openWindow();
    }
    else {
      this.update({ transcript: event.text, partial: "" });
      if (this.state.awake || addressed.addressed) this.observe?.("recognized", {
        sessionId: this.sessionId, characters: event.text.length, rms16: event.rms16, droppedChunks: event.droppedChunks, processingMs: event.processingMs,
      });
    }
    const result = this.gate.accept(event.text, event.partial, Date.now());
    if (this.state.mode === "dictation" && result.command?.kind !== "stop") {
      if (!event.partial) void this.stop("已识别，请检查文字再发送；听写不会自动执行动作");
      return;
    }
    if (this.state.mode === "wake" && !result.command && (addressed.addressed || this.state.awake)) {
      if (!event.partial && this.handlePhotoVoice?.(command)) {
        this.clearContinuation();
        this.viewerVoice?.reset();
        this.openWindow();
        return;
      }
      const notice = this.viewerVoice?.hear(command, event.partial);
      if (notice) {
        this.openWindow();
        if (this.responseFeedback) this.responseFeedback({ kind: "stage", text: notice });
        else if (this.state.phase === "listening") {
          if (this.speakingText) this.interrupt();
          void this.sayWhileListening(notice);
        } else this.update({ notice });
        return;
      }
    }
    if (result.command) {
      // A direct physical instruction supersedes any pending model/tool action.
      this.interrupt(result.command.kind !== "stop");
      const generation = this.generation;
      const actionTurn = this.turn;
      this.observe?.("local-action-started", { turn: actionTurn, action: result.command.kind });
      const finish = (notice: string) => {
        this.observe?.("local-action-result", { turn: actionTurn, notice });
        if (this.current(generation) && this.turn === actionTurn) {
          if (result.command?.kind === "stop") this.update({ notice });
          else void this.sayWhileListening(notice);
        }
      };
      void this.execute(result.command).then(finish, error => finish(error instanceof Error ? error.message : "动作执行失败"));
    } else if (this.converse && !event.partial) {
      if (addressed.addressed) {
        this.interrupt();
        if (command) this.acceptUtterance(addressed.command);
        else void this.sayWhileListening("我在听");
      } else if (this.state.phase === "listening" && Date.now() < this.conversationUntil) {
        if (this.speakingText) this.interrupt();
        this.acceptUtterance(event.text);
      }
    } else if (result.wake) { this.openWindow(); this.update({ notice: "已唤醒，正在听你说" }); }
  }
  private clearContinuation() {
    clearTimeout(this.continuationTimer);
    this.continuation = undefined;
  }
  private waitForContinuation() {
    clearTimeout(this.continuationTimer);
    this.continuationTimer = setTimeout(() => {
      if (!this.continuation) return;
      if (this.state.partial && Date.now() - this.lastInputAt < 4000) {
        this.waitForContinuation();
        return;
      }
      this.clearContinuation();
      if (this.state.phase === "listening") {
        this.update({ partial: "" });
        void this.sayWhileListening("想把这张照片怎么改？请说完整要求。");
      }
    }, 2200);
  }
  private acceptUtterance(text: string) {
    const whole = (this.continuation ?? "") + text;
    this.clearContinuation();
    if (/^(?:请|麻烦)?(?:你)?(?:帮我)?把(?:这|刚才那)张(?:照片|图片)(?:给我)?$/u.test(compactChinese(whole))) {
      this.continuation = whole;
      this.openWindow();
      this.update({ notice: "我在听，请继续说怎么改" });
      this.waitForContinuation();
      return;
    }
    this.beginConversation(whole);
  }
  private cancelResponse() {
    this.clearContinuation();
    this.turn++;
    this.response?.abort();
    this.response = undefined;
    this.responseFeedback = undefined;
    this.speakingText = "";
    this.viewerVoice?.reset();
  }
  /** Recording owns the microphone until its manual stop button is pressed. */
  async pauseCaptureForRecording(): Promise<() => Promise<void>> {
    const generation = this.generation;
    const hadCapture = this.state.captureActive;
    this.capturePaused = true;
    this.clearContinuation();
    this.viewerVoice?.reset();
    this.update({ captureActive: false });
    let failed = false;
    await this.enqueue(async () => { try { await this.native.stopChineseCapture(); } catch { failed = true; } });
    if (failed) { this.capturePaused = false; throw new Error("录像前无法释放麦克风，请重试"); }
    let released = false;
    return async () => {
      if (released) return; released = true;
      const paused = this.capturePaused;
      this.capturePaused = false;
      if (!this.current(generation) || !paused) return;
      if (hadCapture) await this.enqueue(async () => {
        if (!this.current(generation)) return;
        try {
          const capture = await this.native.startChineseCapture();
          if (!capture?.running) throw new Error("麦克风没有成功恢复");
          if (this.current(generation)) this.update({ captureActive: true });
        } catch { if (this.current(generation)) this.update({ phase: "error", captureActive: false, notice: "录像结束后收音未恢复，请重新开启语音" }); }
      });
    };
  }
  isCapturePaused(): boolean { return this.capturePaused; }
  /** Announcements wait for idle; never abort a user turn, a photo review or recording. */
  async announce(text: string): Promise<boolean> {
    if (!this.allowed() || !this.state.captureActive || this.state.phase !== "listening" || this.capturePaused || this.speakingText || this.response || this.state.partial || Date.now() - this.lastInputAt < 1500) return false;
    const generation = this.generation, turn = this.turn;
    this.speakingText = compactChinese(text);
    this.update({ phase: "speaking", notice: "后台任务有结果了" });
    try { await this.native.speakChinese(text); }
    catch { if (this.current(generation) && this.turn === turn) return false; }
    finally {
      if (this.current(generation) && this.turn === turn) {
        this.speakingText = ""; this.openWindow();
        this.update({ phase: "listening", notice: "我在听" });
      }
    }
    // If a user interrupted after speech started, avoid repeatedly announcing it.
    return true;
  }
  /** Face tap or local STOP cancels model/TTS immediately, retaining microphone ownership. */
  interrupt(openWindow = true): void {
    this.cancelResponse(); this.native.stopChineseSpeech();
    if (openWindow) this.openWindow(); else this.closeWindow();
    if (["thinking", "speaking", "listening"].includes(this.state.phase)) this.update({ phase: "listening", partial: "", interim: "", notice: openWindow ? "我在听" : "已停止，等待唤醒" });
  }
  private async sayWhileListening(text: string) {
    const turn = this.turn, generation = this.generation;
    this.speakingText = compactChinese(text);
    this.update({ phase: "listening", notice: text });
    try { await this.native.speakChinese(text); } catch { /* Keep listening if system TTS is unavailable. */ }
    if (this.current(generation) && this.turn === turn) {
      this.speakingText = ""; this.openWindow();
      this.update({ phase: "listening", notice: text });
    }
  }
  private beginConversation(text: string) {
    this.cancelResponse();
    const turn = this.turn, generation = this.generation;
    const controller = new AbortController(); this.response = controller;
    const current = () => this.current(generation) && this.turn === turn && !controller.signal.aborted;
    this.observe?.("conversation-submitted", { turn, characters: text.length });
    this.openWindow(); this.update({ phase: "thinking", acceptedText: text, partial: "", interim: "", notice: "已收到，正在处理" });
    let speechQueue = Promise.resolve(), streamed = "", message = -1, lastFeedbackAt = Date.now();
    const stages = new Set<string>();
    const say = (value: string, final = false, stillRelevant?: () => boolean) => {
      speechQueue = speechQueue.then(async () => {
        if (!current() || (stillRelevant && !stillRelevant())) return;
        const audible = value.replace(/https?:\/\/\S+/gu, "链接").replace(/[`*_#]/gu, "").trim();
        if (!audible) return;
        this.observe?.("conversation-tts", { turn, final, characters: audible.length });
        this.speakingText = compactChinese(audible);
        this.update({ phase: final ? "speaking" : "thinking", interim: audible, notice: final ? "小丫在说话" : audible });
        try { await this.native.speakChinese(audible); } catch { /* Text and tools remain usable if TTS fails. */ }
        if (current()) { this.speakingText = ""; this.update({ interim: "" }); }
      });
    };
    const feedback: ConversationReporter = (value) => {
      if (!current()) return;
      lastFeedbackAt = Date.now();
      if (value.kind === "assistant") {
        if (message !== value.message) { message = value.message; streamed = ""; }
        streamed += value.text; say(value.text);
      } else if (!stages.has(value.text)) { stages.add(value.text); say(value.text); }
    };
    this.responseFeedback = feedback;
    let heartbeat: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!current()) return;
      if (Date.now() - lastFeedbackAt >= 20_000) {
        const hint = this.photoWaitHint?.();
        const reminder = hint;
        if (reminder && !stages.has(reminder)) {
          stages.add(reminder);
          const feedbackAt = lastFeedbackAt;
          say(reminder, false, () => !finished && feedbackAt === lastFeedbackAt && hint === this.photoWaitHint?.());
        }
      }
      heartbeat = setTimeout(tick, 20_000);
    };
    heartbeat = setTimeout(tick, 20_000);
    let finished = false;
    const clearFeedbackTimers = () => { finished = true; clearTimeout(heartbeat); };
    controller.signal.addEventListener("abort", clearFeedbackTimers, { once: true });
    void (async () => {
      try {
        const reply = await this.converse!(text, controller.signal, feedback);
        clearFeedbackTimers();
        if (!current()) return;
        const prefix = streamed.trimStart();
        const spokenPrefix = [...stages, prefix].filter(item => item && reply.startsWith(item)).sort((a, b) => b.length - a.length)[0] ?? "";
        const remaining = reply.slice(spokenPrefix.length);
        if (remaining.trim()) say(remaining, true);
        await speechQueue;
        if (!current()) return;
        this.openWindow(); this.update({ phase: "listening", interim: "", notice: "我在听" });
      } catch (error) {
        clearFeedbackTimers();
        if (!current()) return;
        const notice = error instanceof Error ? error.message : "对话暂时不可用";
        say(notice, true); await speechQueue;
        if (!current()) return;
        this.openWindow(); this.update({ phase: "listening", interim: "", notice });
      } finally {
        clearFeedbackTimers(); controller.signal.removeEventListener("abort", clearFeedbackTimers);
        if (this.turn === turn) { this.response = undefined; this.responseFeedback = undefined; this.speakingText = ""; }
      }
    })();
  }
}
