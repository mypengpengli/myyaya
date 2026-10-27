export type MediaJob = { id: string; kind: "image" | "edit" | "video"; prompt: string; parentId?: string;
  binding: string; createdAt: number; status: "submitting" | "running" | "completed" | "failed" | "unknown";
  remoteId?: string; videoId?: string; model?: string; artifactId?: string; notice: string };
export class MediaRequestRejected extends Error {}
export interface MediaJobRepository { list(): MediaJob[]; save(job: MediaJob): void }
export interface MediaJobTransport {
  submit(job: MediaJob): Promise<{ remoteId?: string; videoId?: string; artifactId?: string }>;
  poll(job: MediaJob): Promise<{ status: "running" | "completed" | "failed"; artifactId?: string; videoId?: string }>;
}
/** Never replay an ambiguous generation POST: it can charge or create twice. */
export class MediaJobService {
  private jobs: MediaJob[];
  private listeners = new Set<() => void>();
  private busy = new Set<string>();
  constructor(private readonly repository: MediaJobRepository, private readonly uuid: () => string) {
    this.jobs = repository.list();
    for (const job of this.jobs) if (job.status === "submitting") this.save({ ...job, status: "unknown", notice: "上次生成请求的结果未确认，不会自动重复提交" });
  }
  list = () => this.jobs;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private save(job: MediaJob) { this.repository.save(job); this.jobs = [job, ...this.jobs.filter((item) => item.id !== job.id)].sort((a, b) => b.createdAt - a.createdAt); this.listeners.forEach((fn) => fn()); }
  create(input: Pick<MediaJob, "kind" | "prompt" | "parentId" | "model">, binding: string): MediaJob {
    if (!input.prompt.trim() || input.prompt.length > 2000) throw new Error("请描述要生成或修改的内容，最多 2000 字");
    if (this.jobs.filter((job) => ["submitting", "running"].includes(job.status)).length >= 2) throw new Error("已有两个媒体任务在处理，请稍等");
    const job: MediaJob = { ...input, prompt: input.prompt.trim(), binding, id: this.uuid(), createdAt: Date.now(), status: "submitting", notice: "生成请求已建立，尚未完成" };
    this.save(job); return job;
  }
  async submit(id: string, binding: string, transport: MediaJobTransport): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || job.binding !== binding || job.status !== "submitting" || this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const result = await transport.submit(job);
      if (result.artifactId) this.save({ ...job, ...result, status: "completed", notice: "已生成并保存到手机" });
      else if (result.remoteId || result.videoId) this.save({ ...job, ...result, status: "running", notice: "服务器正在生成" });
      else this.save({ ...job, status: "unknown", notice: "服务器没有返回作品或任务编号，请先核对请求记录" });
    } catch (error) { this.save({ ...job, status: error instanceof MediaRequestRejected ? "failed" : "unknown",
      notice: error instanceof MediaRequestRejected ? error.message : "生成结果暂未确认；请先核对服务记录，不会自动重复扣费提交" }); }
    finally { this.busy.delete(id); }
  }
  async poll(binding: string, transport: MediaJobTransport): Promise<void> {
    for (const job of this.jobs.filter((item) => item.binding === binding && item.status === "running" && (item.remoteId || item.videoId))) {
      if (this.busy.has(job.id)) continue;
      this.busy.add(job.id);
      try {
        const result = await transport.poll(job);
        if (result.status === "completed" && !result.artifactId) continue;
        this.save({ ...job, ...result, notice: result.status === "completed" ? "已生成并保存到手机" : result.status === "failed" ? "服务器生成失败" : "服务器正在生成" });
      } catch { /* A failed query never repeats the original POST or claims failure/completion. */ }
      finally { this.busy.delete(job.id); }
    }
  }
}
