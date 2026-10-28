import { ChineseCommandGate, compactChinese, isChineseStop, splitChineseWake, type ChineseRobotCommand } from "./chinese-command";

export type ChineseSpeechState = {
  phase: "off" | "loading" | "listening" | "thinking" | "speaking" | "error";
  mode: "wake" | "dictation"; partial: string; transcript: string; notice: string;
};
export interface ChineseSpeechNative {
  prepareChinese(): Promise<{ sessionId: number }>;
  startChineseCapture(): Promise<unknown>;
  stopChineseCapture(): Promise<void>;
  speakChinese(text: string): Promise<void>;
  stopChineseSpeech(): void;
  addListener(name: "onCommandResult", listener: (event: { sessionId: number; text: string; partial: boolean }) => void): { remove(): void };
  addListener(name: "onRecognizerError", listener: (event: { message: string }) => void): { remove(): void };
}

/** One owner, ordered native transitions and immediate invalidation on blur/stop. */
export class ChineseVoiceSession {
  private state: ChineseSpeechState = { phase: "off", mode: "wake", partial: "", transcript: "", notice: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private gate = new ChineseCommandGate();
  private subscriptions: { remove(): void }[] = [];
  private sessionId = 0;
  private conversationUntil = 0;
  private turn = 0;
  private response?: AbortController;
  private speakingText = "";
  private capturePaused = false;
  private lastInputAt = 0;
  constructor(private readonly native: ChineseSpeechNative,
    private readonly permission: () => Promise<boolean>, private readonly allowed: () => boolean,
    private readonly execute: (command: ChineseRobotCommand) => Promise<string>,
    private readonly stopHardware: () => Promise<void> = async () => {},
    private readonly converse?: (text: string, signal: AbortSignal) => Promise<string>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChineseSpeechState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  private enqueue(work: () => Promise<void>) { this.queue = this.queue.then(work, work).catch(() => {}); return this.queue; }
  private current(generation: number) { return generation === this.generation && this.allowed(); }
  private removeListeners() { this.subscriptions.forEach((item) => item.remove()); this.subscriptions = []; }
  start(mode: "wake" | "dictation" = "wake"): Promise<void> {
    if (this.capturePaused) return Promise.resolve();
    const generation = ++this.generation;
    this.cancelResponse(); this.conversationUntil = 0;
    this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    this.update({ phase: "loading", mode, partial: "", notice: "正在加载手机内置中文模型，首次可能较慢" });
    return this.enqueue(async () => {
      try {
        await this.native.stopChineseCapture();
        if (!this.current(generation)) return;
        if (!await this.permission()) throw new Error("麦克风权限未允许；文字和触屏控制仍可使用");
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
            if (this.current(generation)) void this.stop("离线识别发生错误，请重新开启中文语音");
          }),
        ];
        await this.native.startChineseCapture();
        if (!this.current(generation)) { await this.native.stopChineseCapture(); return; }
        this.update({ phase: "listening", notice: mode === "wake" ? "离线监听中：说“小丫小丫”开始对话；“停止”无需唤醒" : "请说一句话；识别后可检查文字，再发送给 Hermes" });
      } catch (error) {
        if (generation === this.generation) {
          this.removeListeners(); await this.native.stopChineseCapture().catch(() => {});
          this.update({ phase: "error", notice: error instanceof Error ? error.message : "中文语音启动失败" });
        }
      }
    });
  }
  stop(notice = "中文语音已关闭"): Promise<void> {
    this.cancelResponse(); this.conversationUntil = 0;
    ++this.generation; this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    void this.stopHardware().catch(() => {});
    this.update({ phase: "off", partial: "", notice });
    return this.enqueue(async () => { await this.native.stopChineseCapture().catch(() => {}); });
  }
  speak(text: string): Promise<void> {
    this.cancelResponse(); this.conversationUntil = 0;
    const generation = ++this.generation;
    void this.stopHardware().catch(() => {});
    this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    this.update({ phase: "speaking", partial: "", notice: "正在使用系统中文离线音色朗读" });
    return this.enqueue(async () => {
      await this.native.stopChineseCapture().catch(() => {});
      if (!this.current(generation)) return;
      try { await this.native.speakChinese(text); if (this.current(generation)) this.update({ phase: "off", notice: "朗读结束；可重新开启中文语音" }); }
      catch (error) { if (this.current(generation)) this.update({ phase: "error", notice: error instanceof Error ? error.message : "请安装系统中文离线音色" }); }
    });
  }
  private onResult(event: { text: string; partial: boolean }) {
    if (!event.text.trim()) return;
    this.lastInputAt = Date.now();
    const addressed = splitChineseWake(event.text);
    // AEC is enabled natively. This additional guard prevents an exact fragment
    // of our own spoken reply from becoming a wake/STOP command on weak devices.
    if (this.state.phase === "speaking" && !isChineseStop(event.text) && this.speakingText.includes(compactChinese(event.text))) return;
    if (event.partial) this.update({ partial: event.text });
    else this.update({ transcript: event.text, partial: "" });
    const result = this.gate.accept(event.text, event.partial, Date.now());
    if (this.state.mode === "dictation" && result.command?.kind !== "stop") {
      if (!event.partial) void this.stop("已识别，请检查文字再发送；听写不会自动执行动作");
      return;
    }
    if (result.command) {
      // A direct physical instruction supersedes any pending model/tool action.
      this.interrupt(result.command.kind !== "stop");
      const generation = this.generation;
      void this.execute(result.command).then((notice) => { if (this.current(generation)) this.update({ notice }); })
        .catch((error) => { if (this.current(generation)) this.update({ notice: error instanceof Error ? error.message : "动作执行失败" }); });
    } else if (this.converse && !event.partial) {
      if (addressed.addressed) {
        this.interrupt();
        if (addressed.command) this.beginConversation(addressed.command);
        else void this.sayWakeAcknowledgement();
      } else if (this.state.phase === "listening" && Date.now() < this.conversationUntil) {
        this.beginConversation(event.text);
      }
    } else if (result.wake) this.update({ notice: "小丫在听，15 秒内可连续说前进、后退、左转、点头等口令" });
  }
  private cancelResponse() { this.turn++; this.response?.abort(); this.response = undefined; this.speakingText = ""; }
  /** Recording owns the microphone until its manual stop button is pressed. */
  async pauseCaptureForRecording(): Promise<() => Promise<void>> {
    const generation = this.generation;
    const hadCapture = ["listening", "thinking", "speaking"].includes(this.state.phase);
    this.capturePaused = true;
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
        if (this.current(generation)) await this.native.startChineseCapture();
      });
    };
  }
  isCapturePaused(): boolean { return this.capturePaused; }
  /** Announcements wait for idle; never abort a user turn, a photo review or recording. */
  async announce(text: string): Promise<boolean> {
    if (!this.allowed() || this.state.phase !== "listening" || this.capturePaused || this.response || this.state.partial || Date.now() - this.lastInputAt < 1500) return false;
    const generation = this.generation, turn = this.turn;
    this.speakingText = compactChinese(text);
    this.update({ phase: "speaking", notice: "后台任务有结果了" });
    try { await this.native.speakChinese(text); }
    catch { if (this.current(generation) && this.turn === turn) return false; }
    finally {
      if (this.current(generation) && this.turn === turn) {
        this.speakingText = ""; this.conversationUntil = Date.now() + 15_000; this.gate.open(Date.now());
        this.update({ phase: "listening", notice: "我在听" });
      }
    }
    // If a user interrupted after speech started, avoid repeatedly announcing it.
    return true;
  }
  /** Face tap or local STOP cancels model/TTS immediately, retaining microphone ownership. */
  interrupt(openWindow = true): void {
    this.cancelResponse(); this.native.stopChineseSpeech();
    this.conversationUntil = openWindow ? Date.now() + 15_000 : 0;
    if (openWindow) this.gate.open(Date.now());
    if (["thinking", "speaking", "listening"].includes(this.state.phase)) this.update({ phase: "listening", partial: "", notice: "我在听" });
  }
  private async sayWakeAcknowledgement() {
    const turn = this.turn, generation = this.generation;
    this.speakingText = compactChinese("我在听");
    this.update({ phase: "speaking", notice: "我在听" });
    try { await this.native.speakChinese("我在听"); } catch { /* Keep listening if system TTS is unavailable. */ }
    if (this.current(generation) && this.turn === turn) {
      this.speakingText = ""; this.conversationUntil = Date.now() + 15_000;
      this.update({ phase: "listening", notice: "我在听" });
    }
  }
  private beginConversation(text: string) {
    this.cancelResponse();
    const turn = this.turn, generation = this.generation;
    const controller = new AbortController(); this.response = controller;
    this.update({ phase: "thinking", partial: "", notice: "正在想怎么回答" });
    void (async () => {
      try {
        const reply = await this.converse!(text, controller.signal);
        if (!this.current(generation) || this.turn !== turn) return;
        this.speakingText = compactChinese(reply);
        this.update({ phase: "speaking", notice: "小丫在说话" });
        await this.native.speakChinese(reply);
        if (!this.current(generation) || this.turn !== turn) return;
        this.conversationUntil = Date.now() + 15_000; this.gate.open(Date.now());
        this.update({ phase: "listening", notice: "我在听" });
      } catch (error) {
        if (!this.current(generation) || this.turn !== turn) return;
        this.update({ phase: "listening", notice: error instanceof Error ? error.message : "对话暂时不可用" });
      } finally { if (this.turn === turn) { this.response = undefined; this.speakingText = ""; } }
    })();
  }
}
