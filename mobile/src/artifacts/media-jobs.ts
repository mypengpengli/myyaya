import * as SQLite from "expo-sqlite";
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { fetch } from "expo/fetch";
import { AppState } from "react-native";
import { DEFAULT_VIDEO_MODEL, readNewApiConfig, type NewApiConfig } from "../agent/newapi-config";
import { findArtifact, savePhotoArtifact, saveVideoArtifact } from "./artifact-store";
import { resultPresentation } from "./presentation";
import { MediaJobService, MediaRequestRejected, type MediaJob, type MediaJobTransport } from "./media-job-service";
import { agnesVideoPollPaths, buildAgnesImageRequest, buildAgnesVideoRequest, extractAgnesVideoUrl,
  mediaRejectionNotice, parseAgnesVideoSubmission } from "./agnes-protocol";

let database: SQLite.SQLiteDatabase | undefined, service: MediaJobService | undefined;
function db() {
  if (!database) { database = SQLite.openDatabaseSync("myyaya-media-jobs-v1.db");
    database.execSync("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS media_jobs(id TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL);"); }
  return database;
}
export function getMediaJobs(): MediaJobService {
  return service ??= new MediaJobService({ list: () => db().getAllSync<{ data: string }>("SELECT data FROM media_jobs").map((row) => JSON.parse(row.data)),
    save: (job) => { db().runSync("INSERT INTO media_jobs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", job.id, JSON.stringify(job)); } }, randomUUID);
}
async function connection() {
  const config = await readNewApiConfig();
  if (!config) throw new Error("请先配置模型连接");
  const binding = await digestStringAsync(CryptoDigestAlgorithm.SHA256, config.baseUrl + "\n" + config.apiKey);
  return { config, binding };
}
async function request(config: NewApiConfig, path: string, body?: string, fromOrigin = false) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch((fromOrigin ? new URL(config.baseUrl).origin : config.baseUrl) + path, { method: body ? "POST" : "GET", signal: controller.signal, redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}`, "User-Agent": "myyaya-planning-probe/1", ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}) }, body });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error || !data) {
      const rejected = mediaRejectionNotice(response.status, data);
      if (rejected) throw new MediaRequestRejected(rejected);
      throw new Error(`媒体接口 HTTP ${response.status}`);
    }
    return data;
  } finally { clearTimeout(timeout); }
}
async function imageInput(parentId?: string) {
  const parent = parentId ? findArtifact(parentId) : undefined;
  if (!parent || parent.kind !== "image") throw new Error("请先选择或拍摄一张图片");
  return { parent, file: new File(parent.uri) };
}
async function saveImage(data: { data?: { b64_json?: string; url?: string }[] }, job: MediaJob) {
  const result = data.data?.[0];
  if (!result) throw new Error("媒体接口没有返回图片");
  let base64 = result.b64_json;
  if (!base64 && result.url) {
    const url = new URL(result.url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("图片地址无效");
    const response = await fetch(result.url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error("图片下载失败");
    const file = new File(FileSystem.cacheDirectory!, `myyaya-image-${randomUUID()}.png`);
    file.write(new Uint8Array(await response.arrayBuffer()));
    try { base64 = await file.base64(); } finally { file.delete(); }
  }
  if (!base64 || base64.length > 30_000_000 || !/^(iVBORw0KGgo|\/9j\/)/.test(base64)) throw new Error("图片返回格式无效或过大");
  const item = await savePhotoArtifact(base64, base64.startsWith("/9j/") ? "image/jpeg" : "image/png", job.kind === "edit" ? "修改后的照片" : "生成的图片", job.parentId);
  resultPresentation.offer(item); return item.id;
}
async function saveRemoteVideo(config: NewApiConfig, urlInput: string, job: MediaJob) {
  const url = new URL(urlInput);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("视频地址无效");
  const headers = url.origin === new URL(config.baseUrl).origin ? { Authorization: `Bearer ${config.apiKey}` } : undefined;
  const response = await fetch(url.href, { redirect: "error", signal: AbortSignal.timeout(120_000), headers });
  if (!response.ok || Number(response.headers.get("Content-Length")) > 200 * 1024 * 1024) throw new Error("视频下载失败或文件过大");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 12 || bytes.length > 200 * 1024 * 1024 || String.fromCharCode(...bytes.slice(4, 8)) !== "ftyp") throw new Error("视频不是有效的 MP4 文件");
  const file = new File(FileSystem.cacheDirectory!, `myyaya-video-${job.id}.mp4`); file.write(bytes);
  const item = await saveVideoArtifact(file.uri); resultPresentation.offer(item); return item.id;
}
function transport(config: NewApiConfig): MediaJobTransport {
  return {
    async submit(job) {
      if (job.kind === "video") {
        const input = job.parentId ? await imageInput(job.parentId) : undefined;
        const firstFrame = input ? `data:${input.parent.mimeType};base64,${await input.file.base64()}` : undefined;
        const data = await request(config, "/videos", JSON.stringify(buildAgnesVideoRequest(job.model || DEFAULT_VIDEO_MODEL, job.prompt, firstFrame)));
        return parseAgnesVideoSubmission(data);
      }
      let data;
      if (job.kind === "edit") {
        const { file } = await imageInput(job.parentId);
        const parent = findArtifact(job.parentId)!;
        data = await request(config, "/images/generations", JSON.stringify(buildAgnesImageRequest(job.prompt, `data:${parent.mimeType};base64,${await file.base64()}`)));
      } else data = await request(config, "/images/generations", JSON.stringify(buildAgnesImageRequest(job.prompt)));
      return { artifactId: await saveImage(data, job) };
    },
    async poll(job) {
      let data;
      for (const path of agnesVideoPollPaths(job)) {
        try { data = await request(config, path, undefined, true); break; } catch { /* Read-only fallback to Agnes video_id + model_name. */ }
      }
      if (!data) throw new Error("暂时无法查询视频任务");
      if (data.status === "failed") return { status: "failed" };
      const videoId = typeof data.video_id === "string" && data.video_id ? data.video_id : job.videoId;
      if (data.status !== "completed") return { status: "running", ...(videoId ? { videoId } : {}) };
      const url = extractAgnesVideoUrl(data) || (job.remoteId ? config.baseUrl + "/videos/" + encodeURIComponent(job.remoteId) + "/content" : "");
      if (!url) throw new Error("视频已完成但尚无可下载结果");
      return { status: "completed", artifactId: await saveRemoteVideo(config, url, job) };
    },
  };
}
export async function submitMediaJob(input: Pick<MediaJob, "kind" | "prompt" | "parentId">, signal?: AbortSignal): Promise<MediaJob> {
  if (input.parentId) await imageInput(input.parentId);
  const { config, binding } = await connection();
  if (signal?.aborted) throw new Error("已取消提交");
  const jobs = getMediaJobs(), job = jobs.create({ ...input, ...(input.kind === "video" ? { model: config.videoModel || DEFAULT_VIDEO_MODEL } : {}) }, binding);
  // Persist first, return immediately, then let generation continue while chatting.
  void jobs.submit(job.id, binding, transport(config)).catch(() => {}); return job;
}
export function startMediaJobMonitor(): () => void {
  let closed = false, timer: ReturnType<typeof setTimeout> | undefined, busy = false;
  const poll = async () => {
    if (closed || busy || AppState.currentState !== "active") return;
    busy = true;
    try { const { config, binding } = await connection(); if (!closed) await getMediaJobs().poll(binding, transport(config)); } catch { /* Settings may not be configured yet. */ }
    finally { busy = false; if (!closed) timer = setTimeout(() => void poll(), 5000); }
  };
  const app = AppState.addEventListener("change", (value) => { if (value === "active") { if (timer) clearTimeout(timer); void poll(); } });
  void poll(); return () => { closed = true; if (timer) clearTimeout(timer); app.remove(); };
}
