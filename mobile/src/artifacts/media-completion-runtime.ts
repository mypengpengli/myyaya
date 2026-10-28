import type { MediaJobService } from "./media-job-service";
import { chineseVoice } from "../voice/chinese-voice-runtime";
import { queueCompanionTaskResult } from "../agent/companion-runtime";
import { photoCapture } from "./phone-camera";
import { getPhoneRecording } from "./phone-recording";

let busy = false;
export async function reportMediaCompletions(service: MediaJobService, binding: string, current: () => Promise<boolean>) {
  if (busy) return;
  busy = true;
  try {
    for (const job of service.list().filter((item) => item.binding === binding && item.notified === false && ["completed", "failed", "unknown"].includes(item.status)).reverse()) {
      if (!await current()) return;
      const summary = job.status === "completed" ? `${job.kind === "video" ? "视频" : job.kind === "edit" ? "修改的图片" : "图片"}已经生成并保存，可以让我打开。` : `媒体任务${job.status === "failed" ? "失败了" : "结果暂未确认"}，详情已保存在作品页。`;
      queueCompanionTaskResult(`media:${job.id}`, JSON.stringify({ jobId: job.id, status: job.status, artifactId: job.artifactId, parentId: job.parentId, summary }));
      if (photoCapture.getSnapshot().phase !== "idle" || ["preparing", "recording", "saving"].includes(getPhoneRecording().phase)) continue;
      if (await chineseVoice.announce(summary) && await current()) service.markNotified(job.id);
    }
  } finally { busy = false; }
}
