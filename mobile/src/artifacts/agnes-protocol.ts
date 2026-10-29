/** Agnes 2.5 protocol, checked against the owner's ImageForge frontend and
 * wiki.agnes-ai.com/en/docs/agnes-video-25.md (2026-10-27).
 */
export function buildAgnesVideoRequest(model: string, prompt: string, firstFrame?: string) {
  return { model, prompt, mode: firstFrame ? "keyframe" : "text", seconds: "5", size: "720P", aspect_ratio: "16:9", n: 1,
    ...(firstFrame ? { first_frame: firstFrame } : {}) };
}
export function agnesEditSize(width = 1024, height = 1024): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "1024x1024";
  const ratio = width / height;
  const common = [[1, "1024x1024"], [4 / 3, "1024x768"], [3 / 2, "1536x1024"], [16 / 9, "1024x576"],
    [3 / 4, "768x1024"], [2 / 3, "1024x1536"], [9 / 16, "576x1024"]] as const;
  for (const [value, size] of common) if (Math.abs(ratio - value) < 0.001) return size;
  return ratio > 1 ? `1024x${Math.max(64, Math.round(1024 / ratio))}` : `${Math.max(64, Math.round(1024 * ratio))}x1024`;
}
export function buildAgnesImageRequest(prompt: string, image?: string, dimensions?: { width: number; height: number }) {
  if (!image) return { model: "agnes-image-2.5-flash", prompt, size: "1K", n: 1, return_base64: true };
  // Match the working ImageForge edit request, including concrete dimensions
  // and its reference instruction. Some relays handle the "1K" shorthand differently.
  return { model: "agnes-image-2.5-flash",
    prompt: `Use the provided reference image as the visual source for this image-to-image edit. Follow this edit instruction: ${prompt}.`,
    size: agnesEditSize(dimensions?.width, dimensions?.height), image, images: [image],
    extra_body: { image: [image], response_format: "b64_json" } };
}
export function parseAgnesVideoSubmission(data: Record<string, unknown>) {
  const remoteId = data.id || data.task_id;
  const videoId = data.video_id;
  if ((typeof remoteId !== "string" || !remoteId) && (typeof videoId !== "string" || !videoId)) throw new Error("没有返回有效的视频任务编号");
  return { ...(typeof remoteId === "string" ? { remoteId } : {}), ...(typeof videoId === "string" ? { videoId } : {}) };
}
export function agnesVideoPollPaths(job: { remoteId?: string; videoId?: string; model?: string }): string[] {
  return [job.videoId ? `/agnesapi?${new URLSearchParams({ video_id: job.videoId, model_name: job.model || "agnes-video-2.5" })}` : "",
    job.remoteId ? `/v1/videos/${encodeURIComponent(job.remoteId)}` : ""].filter(Boolean);
}
export function extractAgnesVideoUrl(value: unknown, depth = 0): string | undefined {
  if (!value || typeof value !== "object" || depth > 4) return;
  const data = value as Record<string, unknown>;
  for (const key of ["video_url", "url", "output_url", "result_url"]) if (typeof data[key] === "string" && data[key].startsWith("https://")) return data[key];
  for (const next of [data.metadata, Array.isArray(data.data) ? data.data[0] : data.data, data.output, data.result]) {
    const url = extractAgnesVideoUrl(next, depth + 1); if (url) return url;
  }
}
/** Classify nested NewAPI -> Agnes JSON without displaying provider bodies. */
export function mediaRejectionNotice(status: number, value: unknown): string | undefined {
  let data = value;
  for (let i = 0; i < 5; i++) {
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { break; } }
    if (!data || typeof data !== "object") break;
    const object = data as Record<string, unknown>;
    if (object.code === "model_not_found") return "上游返回：当前分组不能使用这个视频模型。请更换视频模型或检查中转渠道分组。";
    data = object.error ?? object.message;
  }
  if (status === 401 || status === 403) return "媒体接口拒绝了凭据或分组权限，请检查模型连接。";
  if (status === 400 || status === 422) return "媒体接口拒绝了生成参数，请检查模型对应的请求格式。";
  return;
}
export function videoDownloadCandidates(baseUrl: string, remoteId?: string, resultUrl?: string): string[] {
  return [...new Set([remoteId ? `${baseUrl}/videos/${encodeURIComponent(remoteId)}/content` : "",
    resultUrl?.startsWith("https://") ? resultUrl : ""].filter(Boolean))];
}
export function mediaDownloadHeaders(baseUrl: string, targetUrl: string, apiKey: string): Record<string, string> {
  return { "User-Agent": "myyaya/2.1.164",
    ...(new URL(baseUrl).origin === new URL(targetUrl).origin ? { Authorization: `Bearer ${apiKey}` } : {}) };
}
