/** Agnes 2.5 protocol, checked against the owner's ImageForge frontend and
 * wiki.agnes-ai.com/en/docs/agnes-image-25-flash and agnes-video-25-flash
 * (ratio/model options checked 2026-10-29).
 */
export const IMAGE_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
export type MediaAspectRatio = typeof IMAGE_ASPECT_RATIOS[number];
export const IMAGE_RESOLUTIONS = ["1K", "2K", "3K", "4K"] as const;
export type ImageResolution = typeof IMAGE_RESOLUTIONS[number];
export function validateImageResolution(kind: "image" | "edit" | "video", resolution?: ImageResolution): void {
  if (resolution === undefined) return;
  if (kind === "video") throw new Error("图片分辨率参数不能用于视频；当前视频仍使用 720P");
  if (!(IMAGE_RESOLUTIONS as readonly string[]).includes(resolution)) throw new Error("图片分辨率可选：1K、2K、3K、4K");
}
/** Agnes tiers need a supported ratio, otherwise an edit silently becomes square. */
export function closestImageAspectRatio(width = 1024, height = 1024): MediaAspectRatio {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "1:1";
  const distance = (ratio: MediaAspectRatio) => { const [w, h] = ratio.split(":").map(Number); return Math.abs(Math.log(width / height) - Math.log(w / h)); };
  return IMAGE_ASPECT_RATIOS.reduce((best, ratio) => distance(ratio) < distance(best) ? ratio : best);
}
export const VIDEO_ASPECT_RATIOS: readonly MediaAspectRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
export function validateMediaAspectRatio(kind: "image" | "edit" | "video", ratio?: MediaAspectRatio): void {
  if (ratio === undefined) return;
  const supported = kind === "video" ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS;
  if (!(supported as readonly string[]).includes(ratio)) throw new Error(`${kind === "video" ? "视频" : "图片"}不支持这个比例，可选：${supported.join("、")}`);
}
export function buildAgnesVideoRequest(model: string, prompt: string, firstFrame?: string, aspectRatio?: MediaAspectRatio) {
  validateMediaAspectRatio("video", aspectRatio);
  return { model, prompt, mode: firstFrame ? "keyframe" : "text", seconds: "5", size: "720P", aspect_ratio: aspectRatio || "16:9", n: 1,
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
export function buildAgnesImageRequest(prompt: string, image?: string, dimensions?: { width: number; height: number }, options: { model?: string; aspectRatio?: MediaAspectRatio; resolution?: ImageResolution } = {}) {
  validateMediaAspectRatio(image ? "edit" : "image", options.aspectRatio);
  validateImageResolution(image ? "edit" : "image", options.resolution);
  const model = options.model || "agnes-image-2.5-flash";
  const aspectRatio = options.aspectRatio ?? (image && options.resolution ? closestImageAspectRatio(dimensions?.width, dimensions?.height) : undefined);
  const ratio = aspectRatio ? { ratio: aspectRatio } : {};
  if (!image) return { model, prompt, size: options.resolution || "1K", ...ratio, n: 1, extra_body: { response_format: "url" } };
  // Keep ImageForge's dimensions/reference shape. Prefer Agnes' URL response:
  // persist the small receipt before downloading, so an interrupted image transfer
  // can be retried without repeating the generation POST.
  return { model,
    prompt: `Use the provided reference image as the visual source for this image-to-image edit. Follow this edit instruction: ${prompt}.`,
    size: options.resolution || (options.aspectRatio ? "1K" : agnesEditSize(dimensions?.width, dimensions?.height)), ...ratio, image, images: [image],
    extra_body: { image: [image], response_format: "url" } };
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
  return { "User-Agent": "myyaya/2.1.168",
    ...(new URL(baseUrl).origin === new URL(targetUrl).origin ? { Authorization: `Bearer ${apiKey}` } : {}) };
}
