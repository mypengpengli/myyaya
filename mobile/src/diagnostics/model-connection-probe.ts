import { fetch } from "expo/fetch";
import { readNewApiConfig } from "../agent/newapi-config";

/** ADB-only bounded transport diagnostics; never returns headers, keys or provider bodies. */
export async function probeModelConnection(mode: string) {
  if (!["models", "chat", "stream"].includes(mode)) throw new Error("未知连接检查");
  const config = await readNewApiConfig(); if (!config) throw new Error("尚未配置模型");
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let stage = "request", status: number | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(config.baseUrl + (mode === "models" ? "/models" : "/chat/completions"), {
      method: mode === "models" ? "GET" : "POST", signal: controller.signal, redirect: "error",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      ...(mode === "models" ? {} : { body: JSON.stringify({ model: config.model, messages: [{ role: "user", content: "只回复连接成功" }], max_tokens: 20, stream: mode === "stream" }) }),
    });
    status = response.status; stage = "body";
    if (!response.ok) return { mode, status, elapsedMs: Date.now() - started };
    if (mode === "stream") {
      reader = response.body?.getReader(); if (!reader) throw new Error("missing-stream");
      const first = await reader.read();
      return { mode, status, receivedBytes: first.value?.byteLength ?? 0, elapsedMs: Date.now() - started };
    }
    const data = await response.json();
    return { mode, status, elapsedMs: Date.now() - started, ...(mode === "models"
      ? { modelAvailable: Array.isArray(data.data) && data.data.some((item: { id?: string }) => item.id === config.model) }
      : { hasReply: typeof data.choices?.[0]?.message?.content === "string" }) };
  } catch { return { mode, stage, status, timeout: controller.signal.aborted, elapsedMs: Date.now() - started }; }
  finally { clearTimeout(timer); void reader?.cancel().catch(() => {}); }
}
