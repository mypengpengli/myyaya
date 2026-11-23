import { fetch } from "expo/fetch";
import { File } from "expo-file-system";
import { readNewApiConfig } from "../agent/newapi-config";

export async function compareSpeechSample(uri: string, signal: AbortSignal): Promise<string> {
  const config = await readNewApiConfig();
  if (!config) throw new Error("请先设置模型连接");
  if (signal.aborted) throw new Error("已取消对照");
  const input = new FormData();
  input.append("model", "TeleAI/TeleSpeechASR");
  input.append("file", new File(uri));
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const started = Date.now();
  const deadline = setTimeout(abort, 30_000);
  try {
    const response = await fetch(config.baseUrl + "/audio/transcriptions", {
      method: "POST", body: input, redirect: "error", signal: request.signal,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`语音对照接口返回 HTTP ${response.status}`);
    const body = await response.json();
    if (typeof body.text !== "string") throw new Error("语音对照接口没有返回文字");
    return `中转（${Date.now() - started} 毫秒）：${body.text.trim() || "未识别到文字"}`;
  } catch (error) {
    if (request.signal.aborted && !signal.aborted) throw new Error("中转语音对照超时");
    throw error;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}
