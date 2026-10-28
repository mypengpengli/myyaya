import { fetch } from "expo/fetch";
import type { HermesConnection } from "./connection";
import type { HermesTask } from "./task-service";
import { fileTypes } from "../artifacts/file-types";
import { documentNative } from "../../modules/document-preview";
import { findArtifact, registerArtifactFile } from "../artifacts/artifact-store";

export type ResultFile = { id: string; name: string; mimeType: string; bytes: number; sha256: string };
export function parseFileManifest(value: unknown, taskId: string): ResultFile[] {
  const data = value as { version?: unknown; task_id?: unknown; files?: unknown } | null;
  if (!data || data.version !== 1 || data.task_id !== taskId || !Array.isArray(data.files) || data.files.length > 10) throw new Error("文件清单无效");
  const ids = new Set<string>(); let total = 0;
  return data.files.map((item: ResultFile) => {
    if (!item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) || typeof item.name !== "string" || !item.name || item.name.length > 180 || /[\\/\x00-\x1f]/.test(item.name) || !Object.hasOwn(fileTypes, item.mimeType) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("文件清单包含无效或不支持的文件");
    ids.add(item.id); total += item.bytes;
    if (total > 60 * 1024 * 1024) throw new Error("任务文件总量过大");
    return { id: item.id, name: item.name, mimeType: item.mimeType, bytes: item.bytes, sha256: item.sha256 };
  });
}
export async function receiveTaskFiles(task: HermesTask, connection: HermesConnection, current: () => Promise<boolean>): Promise<string[]> {
  if (task.baseUrl !== connection.baseUrl || !/^[A-Za-z0-9_-]{1,100}$/.test(task.id)) throw new Error("任务连接不匹配");
  if (!await current()) throw new Error("文件接收已暂停");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
  let manifest: ResultFile[];
  try {
    const response = await fetch(connection.baseUrl + `/myyaya/v1/tasks/${task.id}/files`, {
      headers: { Authorization: `Bearer ${connection.token}`, Accept: "application/json" }, redirect: "error", credentials: "omit", signal: controller.signal,
    });
    if (response.status === 404) throw new Error("服务器尚未发布文件清单，请检查文件桥和任务产物");
    if (!response.ok) throw new Error("无法获取文件清单，请检查连接或鉴权");
    if (Number(response.headers.get("content-length")) > 32_768) throw new Error("文件清单过大");
    const reader = response.body?.getReader(); if (!reader) throw new Error("文件清单读取失败");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 32_768) throw new Error("文件清单过大"); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    manifest = parseFileManifest(JSON.parse(new TextDecoder().decode(bytes)), task.id);
  } finally { clearTimeout(timeout); }
  const artifacts: string[] = [];
  for (const file of manifest) {
    if (!await current()) throw new Error("文件接收已暂停");
    const id = `${task.id}_${file.id}`, type = fileTypes[file.mimeType], existing = findArtifact(id);
    if (existing) {
      if (existing.sourceTaskId !== task.id || existing.mimeType !== file.mimeType) throw new Error("文件编号冲突");
      artifacts.push(existing.id); continue;
    }
    const uri = await documentNative().download(connection.baseUrl + `/myyaya/v1/tasks/${task.id}/files/${file.id}`, connection.token, file.sha256, file.bytes, id, type.extension);
    if (!await current()) throw new Error("文件接收已暂停");
    artifacts.push(registerArtifactFile({ id, uri, title: file.name, mimeType: file.mimeType, sourceTaskId: task.id }).id);
  }
  return artifacts;
}
