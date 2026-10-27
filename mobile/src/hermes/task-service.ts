import type { RunTransport } from "./run-client";
import { terminalRun, type RunEvent, type RunSnapshot, type RunStatus } from "./run-protocol";

export type TaskProgress = { at: number; label: string; detail?: string };
export type HermesTask = {
  id: string; baseUrl: string; accountId: string; input: string; payload: string;
  createdAt: number; runId: string | null; status: RunStatus; output: string;
  progress: TaskProgress[]; notice: string;
};
export interface TaskRepository { list(): HermesTask[]; save(task: HermesTask): void }
const REPLAY_WINDOW = 23 * 60 * 60 * 1000;

export class HermesTaskService {
  private tasks: HermesTask[];
  private listeners = new Set<() => void>();
  private busy = new Set<string>();
  constructor(private readonly repository: TaskRepository, private readonly uuid: () => string,
    private readonly now: () => number = Date.now) { this.tasks = repository.list(); }
  list = () => this.tasks;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private get(id: string) { const task = this.tasks.find((item) => item.id === id); if (!task) throw new Error("task_missing"); return task; }
  private save(task: HermesTask) {
    // Synchronous SQLite write must succeed BEFORE a server operation can start.
    this.repository.save(task);
    this.tasks = [task, ...this.tasks.filter((item) => item.id !== task.id)].sort((a, b) => b.createdAt - a.createdAt);
    this.listeners.forEach((listener) => listener());
  }
  create(input: string, baseUrl: string, accountId: string): HermesTask {
    const text = input.trim();
    if (!text || text.length > 10_000) throw new Error("请输入 1–10000 字的任务");
    if (this.tasks.filter((task) => !terminalRun(task.status)).length >= 8) throw new Error("请先处理已有任务，最多保留 8 个进行中的任务");
    const id = this.uuid();
    const task: HermesTask = { id, baseUrl, accountId, input: text,
      payload: JSON.stringify({ input: text, session_id: `myyaya-${id}` }), createdAt: this.now(),
      runId: null, status: "pending", output: "", progress: [], notice: "" };
    this.save(task);
    return task;
  }
  private bound(id: string, baseUrl: string, accountId: string) {
    const task = this.get(id);
    if (task.baseUrl !== baseUrl || task.accountId !== accountId) throw new Error("请恢复提交此任务时的服务地址和 Token");
    return task;
  }
  async submit(id: string, baseUrl: string, accountId: string, client: RunTransport): Promise<void> {
    const task = this.bound(id, baseUrl, accountId);
    if (task.runId || this.busy.has(id)) return;
    if (this.now() - task.createdAt >= REPLAY_WINDOW) throw new Error("提交结果尚未确认且已超过安全重试期限，请先在服务器核对，勿重复执行");
    this.busy.add(id);
    try {
      await client.discover();
      this.applySnapshot(id, await client.submit(task.payload, task.id));
    } catch {
      this.save({ ...this.get(id), notice: "提交尚未确认。请检查连接后重试；重试会沿用原任务的幂等键。" });
    } finally { this.busy.delete(id); }
  }
  applySnapshot(id: string, snapshot: RunSnapshot): void {
    const task = this.get(id);
    if (task.runId && snapshot.run_id !== task.runId) throw new Error("run_id_mismatch");
    // A stale poll or stop acknowledgement must never resurrect a completed run.
    if (terminalRun(task.status)) return;
    const status = task.status === "stopping" && !terminalRun(snapshot.status) ? "stopping" : snapshot.status;
    this.save({ ...task, runId: snapshot.run_id, status,
      output: snapshot.output ?? task.output, notice: "" });
  }
  async refresh(id: string, baseUrl: string, accountId: string, client: RunTransport): Promise<void> {
    const task = this.bound(id, baseUrl, accountId);
    if (!task.runId || terminalRun(task.status)) return;
    try { this.applySnapshot(id, await client.status(task.runId)); }
    catch { this.save({ ...this.get(id), notice: "暂时无法查询。服务器可能仍在执行；恢复连接后继续查询，不会重新派单。" }); }
  }
  async stop(id: string, baseUrl: string, accountId: string, client: RunTransport): Promise<void> {
    const task = this.bound(id, baseUrl, accountId);
    if (!task.runId || terminalRun(task.status) || this.busy.has(id)) return;
    this.busy.add(id);
    try { this.applySnapshot(id, await client.stop(task.runId)); }
    catch { this.save({ ...this.get(id), notice: "停止请求尚未确认，请查询状态或重试停止。" }); }
    finally { this.busy.delete(id); }
  }
  acceptEvent(id: string, event: RunEvent): void {
    const task = this.get(id);
    if (terminalRun(task.status)) return;
    // Only documented public progress is shown. Reasoning/delta/unknown payloads are not persisted.
    const labels: Record<string, string> = { "tool.started": "开始执行工具", "tool.completed": event.error ? "工具执行失败" : "工具执行完成",
      "message.interim": "执行进度", "subagent.start": "子任务开始", "subagent.complete": "子任务完成" };
    const label = labels[event.event];
    if (!label) return;
    const detail = event.event === "message.interim" ? event.text
      : typeof event.tool === "string" ? [event.tool, typeof event.preview === "string" ? event.preview : ""].filter(Boolean).join("\n")
      : event.summary;
    this.save({ ...task, progress: [...task.progress, { at: this.now(), label,
      ...(typeof detail === "string" ? { detail: detail.slice(0, 1000) } : {}) }].slice(-100) });
  }
}
