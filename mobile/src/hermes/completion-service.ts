import { terminalRun } from "./run-protocol";
import type { HermesTask, HermesTaskService } from "./task-service";

export function completionSummary(task: HermesTask): string {
  const title = task.input.replace(/\s+/g, " ").slice(0, 45);
  const result = task.output.replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/g, "链接见任务记录").replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (task.status !== "completed") return `后台任务“${title}”${task.status === "failed" ? "执行失败" : task.status === "cancelled" ? "已取消" : "已中断"}。${result || "详情可以在任务记录查看。"}`;
  const files = task.delivery?.files === "saved" ? task.delivery.artifactIds.length ? `已接收 ${task.delivery.artifactIds.length} 个文件，可以让我打开。` : "本次没有返回文件，可查看任务记录。" : task.delivery?.files === "failed" ? "服务器任务已结束，但文件接收失败，可在任务记录重试取回。" : "";
  return `后台任务“${title}”已完成。${result || "结果已在任务记录保存。"}${files}`;
}

export class CompletionCoordinator {
  private busy = false;
  constructor(private readonly tasks: HermesTaskService,
    private readonly receive: (task: HermesTask) => Promise<string[]>,
    private readonly announce: (text: string) => Promise<boolean>,
    private readonly stage: (id: string, text: string) => void,
    private readonly current: () => Promise<boolean>) {}
  async process(baseUrl: string, accountId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const pending = this.tasks.list().filter((task) => terminalRun(task.status) && task.delivery && !task.delivery.notified && task.baseUrl === baseUrl && task.accountId === accountId).reverse();
      for (const before of pending) {
        if (!await this.current()) return;
        if (before.status === "completed" && before.delivery?.files === "pending") {
          try {
            const ids = await this.receive(before);
            if (!await this.current()) return;
            this.tasks.updateDelivery(before.id, { files: "saved", artifactIds: ids, notice: ids.length ? "文件已保存到作品库" : "服务器未提供文件" });
          } catch {
            if (!await this.current()) return;
            this.tasks.updateDelivery(before.id, { files: "failed", notice: "文件接收失败；请检查文件桥是否部署、任务是否发布文件清单，然后点击重试取回。" });
          }
        }
        const task = this.tasks.list().find((item) => item.id === before.id)!;
        if (!task.delivery || task.delivery.notified || !await this.current()) continue;
        const summary = completionSummary(task);
        this.stage(task.id, JSON.stringify({ taskId: task.id, status: task.status, summary, artifactIds: task.delivery.artifactIds, result: task.output.slice(0, 8000) }));
        if (await this.announce(summary)) {
          if (!await this.current()) return;
          this.tasks.updateDelivery(task.id, { notified: true });
        }
      }
    } finally { this.busy = false; }
  }
}
