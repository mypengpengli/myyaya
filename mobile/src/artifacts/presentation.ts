export type PresentationItem = { id: string; kind: "image" | "video" | "document"; title: string; uri: string; text?: string; mimeType?: string };
export type PresentationState = { active: PresentationItem | null; queue: PresentationItem[]; pinned: boolean;
  ready: boolean; ended: boolean; suspended: boolean; deadline: number | null; position: number; total: number };

/** Hiding a result only changes this presentation queue; it never deletes files. */
export class ResultPresentation {
  private state: PresentationState = { active: null, queue: [], pinned: false, ready: false, ended: false, suspended: false, deadline: null, position: 0, total: 0 };
  private listeners = new Set<() => void>();
  private countdownHolds = new Set<symbol>();
  constructor(private readonly now: () => number = Date.now) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private update(patch: Partial<PresentationState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  private deadline() { return !this.state.pinned && !this.state.suspended && this.countdownHolds.size === 0 && this.state.ready &&
    (this.state.active?.kind !== "video" || this.state.ended) ? this.now() + 10_000 : null; }
  offer(item: PresentationItem) {
    if (!this.state.active) this.open(item);
    else if (this.state.active.id !== item.id && !this.state.queue.some((queued) => queued.id === item.id)) {
      const queue = [...this.state.queue, item].slice(-32);
      this.update({ queue, total: this.state.position + queue.length });
    }
  }
  open(item: PresentationItem) {
    const queued = this.state.queue.some((entry) => entry.id === item.id);
    const position = this.state.active?.id === item.id ? this.state.position : queued && this.state.active ? this.state.position + 1 : 1;
    const queue = this.state.queue.filter((entry) => entry.id !== item.id);
    this.update({ active: item, pinned: false, ready: false, ended: false, deadline: null, queue, position, total: position + queue.length });
  }
  next(id?: string): PresentationItem {
    const next = id ? this.state.queue.find((item) => item.id === id) : this.state.queue[0];
    if (!next) throw new Error(id ? "指定作品不在待展示队列中" : "没有其他待展示结果");
    this.open(next); return next;
  }
  close(advanceQueue = true) {
    if (!advanceQueue) {
      this.update({ active: null, pinned: false, ready: false, ended: false, deadline: null, position: 0, total: this.state.queue.length });
      return;
    }
    const [next, ...queue] = this.state.queue;
    const position = next ? this.state.position + 1 : 0;
    this.update({ active: next ?? null, queue, pinned: false, ready: false, ended: false, deadline: null,
      position, total: next ? position + queue.length : 0 });
  }
  loaded(id: string) { if (this.state.active?.id !== id) return; this.update({ ready: true }); this.update({ deadline: this.deadline() }); }
  videoEnded(id: string) { if (this.state.active?.id !== id) return; this.update({ ready: true, ended: true }); this.update({ deadline: this.deadline() }); }
  videoResumedOrSeeking(id: string) { if (this.state.active?.id === id) this.update({ ended: false, deadline: null }); }
  loadingOrFailed(id: string) { if (this.state.active?.id === id) this.update({ ready: false, ended: false, deadline: null }); }
  pin(value = !this.state.pinned) {
    if (!this.state.active || value === this.state.pinned) return;
    this.update({ pinned: value }); this.update({ deadline: this.deadline() });
  }
  interact() { this.update({ deadline: this.deadline() }); }
  suspend(value: boolean) { this.update({ suspended: value }); this.update({ deadline: this.deadline() }); }
  /** Keep a result available while a user command is being understood/executed.
   * Separate leases avoid releasing another turn or the background suspension. */
  holdCountdown(): () => void {
    const owner = Symbol(); this.countdownHolds.add(owner); this.update({ deadline: null });
    return () => { if (this.countdownHolds.delete(owner)) this.update({ deadline: this.deadline() }); };
  }
  tick() { if (this.state.deadline !== null && this.now() >= this.state.deadline) this.close(); }
}
export const resultPresentation = new ResultPresentation();

export function presentationHint(state: PresentationState, now = Date.now()): string {
  if (!state.active) return "";
  const progress = `第 ${state.position}/${state.total} 项`;
  if (state.pinned) return `${progress} · 已固定${state.queue.length ? ` · 另有 ${state.queue.length} 项待展示` : ""}`;
  const destination = state.queue.length ? "展示下一项" : "返回表情";
  if (state.deadline !== null) return `${progress} · ${Math.max(0, Math.ceil((state.deadline - now) / 1000))} 秒后${destination}`;
  if (!state.ready) return `${progress} · 正在加载`;
  if (state.active.kind === "video" && !state.ended) return `${progress} · 播放结束 10 秒后${destination}`;
  return `${progress} · 正在处理指令，倒计时已暂停`;
}
