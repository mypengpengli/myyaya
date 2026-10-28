export type PairingCandidate = { id: string; name: string; rssi: number | null; selected: boolean };
export type PairingState = {
  phase: "idle" | "searching" | "choosing" | "connecting" | "connected" | "timeout" | "cancelled";
  candidates: PairingCandidate[]; notice: string; deadline: number;
};
type Dependencies = {
  prepare(): Promise<void>;
  scan(signal: AbortSignal, update: (items: PairingCandidate[]) => void): Promise<PairingCandidate[]>;
  connect(item: PairingCandidate): Promise<void>;
  disconnect(): Promise<void>;
  connected(): boolean;
  now(): number;
};

/** One foreground pairing window owns discovery and GATT in sequence. */
export class LooiPairingSession {
  private state: PairingState = { phase: "idle", candidates: [], notice: "", deadline: 0 };
  private listeners = new Set<() => void>();
  private stopped = false;
  private round?: AbortController;
  private choice?: PairingCandidate;
  private running = false;
  constructor(private readonly deps: Dependencies, private readonly windowMs = 90_000) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<PairingState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((fn) => fn()); }
  retry() {
    if (this.stopped || this.state.phase === "connecting") return;
    this.update({ deadline: this.deps.now() + this.windowMs });
    this.round?.abort();
    if (!this.running) void this.start();
  }
  choose(item: PairingCandidate) {
    if (this.stopped || this.state.phase === "connecting") return;
    this.choice = item; this.round?.abort();
  }
  cancel() { this.stopped = true; this.round?.abort(); this.update({ phase: "cancelled", notice: "已停止搜索" }); }
  async start() {
    if (this.running || this.stopped) return;
    if (this.deps.connected()) { this.update({ phase: "connected", notice: "LOOI 已连接，可以返回表情聊天" }); return; }
    this.running = true;
    this.update({ phase: "searching", deadline: this.deps.now() + this.windowMs,
      notice: "请长按底座触控区约 3 秒，黄灯呼吸后松手。我会持续搜索，不用赶时间。" });
    try {
      await this.deps.prepare();
      while (!this.stopped && this.deps.now() < this.state.deadline) {
        this.round = new AbortController();
        let seen: PairingCandidate[] = [];
        try {
          this.update({ phase: "searching" });
          const found = await this.deps.scan(this.round.signal, (items) => {
            if (this.stopped) return;
            seen = items; this.update({ candidates: items });
            const saved = items.find((item) => item.selected);
            if (saved) { this.choice = saved; this.round?.abort(); }
          });
          if (this.stopped) return;
          const items = found.length ? found : seen;
          this.update({ candidates: items });
          const target = this.choice ?? items.find((item) => item.selected) ?? (items.length === 1 ? items[0] : undefined);
          this.choice = undefined;
          if (!target) {
            this.update({ phase: items.length > 1 ? "choosing" : "searching", notice: items.length > 1
              ? "发现多个 LOOI，请点击你的底座；我会继续搜索。"
              : "还没发现底座，正在继续搜索。黄灯亮起后也可以点击下面的按钮立即重搜。" });
            continue;
          }
          this.update({ phase: "connecting", notice: `发现 ${target.name}，正在连接并确认握手…` });
          await this.deps.connect(target);
          if (this.stopped) { await this.deps.disconnect(); return; }
          if (!this.deps.connected()) throw new Error("握手尚未完成");
          this.update({ phase: "connected", notice: "LOOI 已连接，可以返回表情聊天" }); return;
        } catch {
          if (this.stopped) return;
          this.update({ notice: "这次连接未成功，正在重试。请保持黄灯呼吸，并退出官方 LOOI App。" });
          await this.deps.prepare();
          // Discovery normally waits 12 seconds. Avoid spinning on adapter errors.
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        }
      }
      if (!this.stopped) this.update({ phase: "timeout", notice: "这轮搜索已结束。确认黄灯呼吸后，点击“已变黄，开始搜索”再试。" });
    } catch {
      if (!this.stopped) this.update({ phase: "timeout", notice: "蓝牙尚未准备好，请开启蓝牙和附近设备权限，再点击“已变黄，开始搜索”。" });
    } finally { this.running = false; this.round = undefined; }
  }
}
