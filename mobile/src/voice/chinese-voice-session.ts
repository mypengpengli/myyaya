import { ChineseCommandGate, type ChineseRobotCommand } from "./chinese-command";

export type ChineseSpeechState = {
  phase: "off" | "loading" | "listening" | "speaking" | "error";
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
  constructor(private readonly native: ChineseSpeechNative,
    private readonly permission: () => Promise<boolean>, private readonly allowed: () => boolean,
    private readonly execute: (command: ChineseRobotCommand) => Promise<string>,
    private readonly stopHardware: () => Promise<void> = async () => {}) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ChineseSpeechState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  private enqueue(work: () => Promise<void>) { this.queue = this.queue.then(work, work).catch(() => {}); return this.queue; }
  private current(generation: number) { return generation === this.generation && this.allowed(); }
  private removeListeners() { this.subscriptions.forEach((item) => item.remove()); this.subscriptions = []; }
  start(mode: "wake" | "dictation" = "wake"): Promise<void> {
    const generation = ++this.generation;
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
            if (this.current(generation) && event.sessionId === this.sessionId && this.state.phase === "listening") this.onResult(event);
          }),
          this.native.addListener("onRecognizerError", () => {
            if (this.current(generation)) void this.stop("离线识别发生错误，请重新开启中文语音");
          }),
        ];
        await this.native.startChineseCapture();
        if (!this.current(generation)) { await this.native.stopChineseCapture(); return; }
        this.update({ phase: "listening", notice: mode === "wake" ? "离线监听中：先说“小丫小丫”，再说动作；“停止”无需唤醒" : "请说一句话；识别后可检查文字，再发送给 Hermes" });
      } catch (error) {
        if (generation === this.generation) {
          this.removeListeners(); await this.native.stopChineseCapture().catch(() => {});
          this.update({ phase: "error", notice: error instanceof Error ? error.message : "中文语音启动失败" });
        }
      }
    });
  }
  stop(notice = "中文语音已关闭"): Promise<void> {
    ++this.generation; this.gate.reset(); this.removeListeners(); this.native.stopChineseSpeech();
    void this.stopHardware().catch(() => {});
    this.update({ phase: "off", partial: "", notice });
    return this.enqueue(async () => { await this.native.stopChineseCapture().catch(() => {}); });
  }
  speak(text: string): Promise<void> {
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
    if (event.partial) this.update({ partial: event.text });
    else this.update({ transcript: event.text, partial: "" });
    const result = this.gate.accept(event.text, event.partial, Date.now());
    if (this.state.mode === "dictation" && result.command?.kind !== "stop") {
      if (!event.partial) void this.stop("已识别，请检查文字再发送；听写不会自动执行动作");
      return;
    }
    if (result.command) {
      const generation = this.generation;
      void this.execute(result.command).then((notice) => { if (this.current(generation)) this.update({ notice }); })
        .catch((error) => { if (this.current(generation)) this.update({ notice: error instanceof Error ? error.message : "动作执行失败" }); });
    } else if (result.wake) this.update({ notice: "小丫在听，15 秒内可连续说前进、后退、左转、点头等口令" });
  }
}
