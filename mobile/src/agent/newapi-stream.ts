import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, getCurrentTools } from "./pi-mobile-compat";
import type { NewApiConfig } from "./newapi-config";

type Transport = (url: string, init: RequestInit) => Promise<Response>;
export type ChatHttpDiagnostic = {
  clientRequestId: string; startedAt: string; stage: "request" | "headers" | "receiving" | "complete" | "error";
  elapsedMs: number; requestBytes: number; receivedBytes: number; dataEvents: number; pendingChars: number;
  completionSeen: boolean; status?: number; requestId?: string; contentType?: string;
  headersMs?: number; firstByteMs?: number; idleMs?: number; reason?: string;
};
let requestSequence = 0;
const textOf = (content: unknown): string => typeof content === "string" ? content :
  Array.isArray(content) ? content.filter((item) => item.type === "text").map((item) => item.text).join("\n") : "";

export function toNewApiMessages(messages: Message[]): Record<string, unknown>[] {
  return messages.flatMap((message): Record<string, unknown>[] => {
    if (message.role === "system") return [{ role: "system", content: textOf(message.content) }];
    if (message.role === "user") return [{ role: "user", content: typeof message.content === "string" ? message.content :
      message.content.map((part) => part.type === "text" ? { type: "text", text: part.text } :
        { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }) }];
    if (message.role === "assistant") {
      const calls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
      return [{ role: "assistant", content: textOf(message.content) || null,
        ...(calls.length ? { tool_calls: calls.map((call) => ({ id: call.id, type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }];
    }
    // Images returned by a camera tool need a user image block: the compatible
    // chat API's tool role accepts text only. Keep the call/result pair intact.
    const images = message.content.filter((part) => part.type === "image");
    return [{ role: "tool", tool_call_id: message.toolCallId, content: textOf(message.content) || "工具已返回图片" },
      ...(images.length ? [{ role: "user", content: images.map((part) => ({ type: "image_url",
        image_url: { url: `data:${part.mimeType};base64,${part.data}` } })) }] : [])];
  });
}

/** Stream protocol adapter only. Tool scheduling and validation belong to Pi. */
export function createNewApiStream(config: NewApiConfig, transport: Transport, report?: (value: ChatHttpDiagnostic) => void): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const output: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider,
      model: model.id, timestamp: Date.now(), stopReason: "pending", usage: { input: 0, output: 0,
        cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    void (async () => {
      const started = Date.now(), clientRequestId = `myyaya-chat-${started.toString(36)}-${++requestSequence}`;
      let status: number | undefined, requestId: string | undefined, contentType: string | undefined;
      let headersMs: number | undefined, firstByteMs: number | undefined, lastByteAt = started;
      let receivedBytes = 0, dataEvents = 0, pending = "", finished = false, requestBytes = 0, lastReport = 0;
      let timeoutReason: "idle-timeout" | "total-timeout" | undefined;
      const diagnostic = (stage: ChatHttpDiagnostic["stage"], reason?: string) => {
        try { report?.({ clientRequestId, startedAt: new Date(started).toISOString(), stage, elapsedMs: Date.now() - started,
          requestBytes, receivedBytes, dataEvents, pendingChars: pending.length, completionSeen: finished,
          status, requestId, contentType, headersMs, firstByteMs, idleMs: Date.now() - lastByteAt, reason }); } catch { /* Observation cannot break a reply. */ }
      };
      const controller = new AbortController();
      const abort = () => controller.abort();
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
      // A long but active reply must not be aborted just because its total
      // duration exceeds one minute. Keep both an idle and an overall bound.
      const expireIdle = () => { timeoutReason = "idle-timeout"; abort(); };
      let timeout = setTimeout(expireIdle, 60_000);
      const overallTimeout = setTimeout(() => { timeoutReason = "total-timeout"; abort(); }, 180_000);
      const received = () => { lastByteAt = Date.now(); clearTimeout(timeout); timeout = setTimeout(expireIdle, 60_000); };
      let rejectAborted: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        rejectAborted = () => reject(new Error("request-aborted"));
        controller.signal.addEventListener("abort", rejectAborted, { once: true });
        if (controller.signal.aborted) rejectAborted();
      });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const tools = getCurrentTools(context.messages);
        const body = JSON.stringify({ model: config.model, messages: toNewApiMessages(context.messages), stream: true,
          max_tokens: 1200, ...(tools.length ? { tools: tools.map((tool) => ({ type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}) });
        requestBytes = new TextEncoder().encode(body).byteLength;
        diagnostic("request");
        const response = await Promise.race([transport(config.baseUrl + "/chat/completions", { method: "POST", redirect: "error",
          signal: controller.signal, headers: { "Content-Type": "application/json", Accept: "text/event-stream",
            Authorization: `Bearer ${config.apiKey}`, "User-Agent": "myyaya/2.1.169", "X-Client-Request-Id": clientRequestId }, body }), aborted]);
        status = response.status; headersMs = Date.now() - started;
        const rawId = response.headers.get("x-request-id") ?? response.headers.get("x-oneapi-request-id") ?? response.headers.get("request-id");
        requestId = rawId && /^[A-Za-z0-9_.:-]{1,120}$/.test(rawId) ? rawId : undefined;
        const rawType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        contentType = rawType === "text/event-stream" ? "sse" : rawType === "application/json" ? "json" : rawType === "text/html" ? "html" : rawType ? "other" : "missing";
        diagnostic("headers");
        if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
        received();
        if (response.url && new URL(response.url).origin !== new URL(config.baseUrl).origin) throw new Error("模型地址发生跨站跳转");
        if (!response.body) throw new Error("模型未返回流式响应");
        stream.push({ type: "start", partial: output });
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textIndex = -1, streamDone = false;
        const calls = new Map<number, { index: number; raw: string }>();
        const consume = (line: string) => {
          if (!line.startsWith("data:")) return;
          const raw = line.slice(5).trim();
          if (!raw) return;
          if (raw === "[DONE]") { streamDone = true; return; }
          dataEvents++;
          const chunk = JSON.parse(raw);
          if (chunk.error) throw new Error("模型服务返回错误，请检查模型和额度");
          if (chunk.usage) {
            output.usage.input = chunk.usage.prompt_tokens ?? 0;
            output.usage.output = chunk.usage.completion_tokens ?? 0;
            output.usage.totalTokens = chunk.usage.total_tokens ?? output.usage.input + output.usage.output;
          }
          const choice = chunk.choices?.[0];
          if (!choice) return;
          const delta = choice.delta ?? {};
          if (typeof delta.content === "string" && delta.content) {
            if (textIndex < 0) {
              textIndex = output.content.push({ type: "text", text: "" }) - 1;
              stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
            }
            const part = output.content[textIndex];
            if (part.type === "text") part.text += delta.content;
            stream.push({ type: "text_delta", contentIndex: textIndex, delta: delta.content, partial: output });
          }
          for (const item of delta.tool_calls ?? []) {
            if (!Number.isInteger(item.index) || item.index < 0 || item.index > 31) throw new Error("模型工具调用编号无效");
            let call = calls.get(item.index);
            if (!call) {
              const index = output.content.push({ type: "toolCall", id: "", name: "", arguments: {} }) - 1;
              call = { index, raw: "" }; calls.set(item.index, call);
              stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
            }
            const part = output.content[call.index] as ToolCall;
            if (item.id) part.id += item.id;
            if (item.function?.name) part.name += item.function.name;
            if (item.function?.arguments) {
              call.raw += item.function.arguments;
              if (call.raw.length > 64_000) throw new Error("模型工具参数过长");
              stream.push({ type: "toolcall_delta", contentIndex: call.index, delta: item.function.arguments, partial: output });
            }
          }
          if (choice.finish_reason) {
            output.stopReason = choice.finish_reason === "length" ? "length" : calls.size ? "toolUse" : "stop";
            finished = true;
          }
        };
        for (;;) {
          const next = await Promise.race([reader.read(), aborted]);
          if (next.value?.byteLength) { firstByteMs ??= Date.now() - started; receivedBytes += next.value.byteLength; received(); }
          pending += decoder.decode(next.value, { stream: !next.done });
          if (pending.length > 1_000_000) throw new Error("模型流式消息过长");
          const lines = pending.split(/\r\n|\r|\n/); pending = lines.pop()!;
          for (const line of lines) consume(line.trimEnd());
          // A complete terminal JSON frame is sufficient even when a compatible
          // relay omits its trailing newline and leaves the connection open.
          if (!finished && pending.startsWith("data:")) {
            let tail; try { tail = JSON.parse(pending.slice(5).trim()); } catch { /* Still a fragmented frame. */ }
            if (tail?.choices?.[0]?.finish_reason) { consume(pending); pending = ""; }
          }
          if (Date.now() - lastReport >= 5000) { lastReport = Date.now(); diagnostic("receiving"); }
          // finish_reason is terminal even when a compatible gateway omits [DONE]
          // or keeps the HTTP connection open after sending the final choice.
          if (next.done || streamDone || finished) break;
        }
        if (pending.trim()) consume(pending.trimEnd());
        if (!finished) throw new Error("模型连接中断，请重试");
        for (const { index, raw } of calls.values()) {
          const call = output.content[index] as ToolCall;
          try {
            const args = JSON.parse(raw);
            if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error();
            call.arguments = args;
          } catch { call.argumentsError = "模型工具参数不是有效 JSON 对象"; }
          if (!call.id || !call.name) throw new Error("模型工具调用缺少名称或编号");
          stream.push({ type: "toolcall_end", contentIndex: index, toolCall: call, partial: output });
        }
        if (textIndex >= 0) stream.push({ type: "text_end", contentIndex: textIndex,
          content: (output.content[textIndex] as { text: string }).text, partial: output });
        stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
        diagnostic("complete");
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        // Never surface response bodies, headers, or transport error URLs containing credentials.
        output.errorMessage = output.stopReason === "aborted" ? "已停止" : timeoutReason ? status === undefined ? "手机等待模型响应超时，请稍后重试" : "手机接收模型回复超时，请稍后重试" : error instanceof Error &&
          /^(模型|请填写)/.test(error.message) ? error.message : "模型连接失败或超时，请检查网络及模型设置";
        diagnostic("error", options?.signal?.aborted ? "user-abort" : timeoutReason ?? (status && status >= 400 ? "http-error" : "incomplete-response"));
        stream.push({ type: "error", reason: output.stopReason, error: output });
      } finally {
        clearTimeout(timeout); clearTimeout(overallTimeout); options?.signal?.removeEventListener("abort", abort);
        if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted);
        // reader.cancel() only changes Expo's streaming state on Android;
        // abort the actual native request too, including successful open streams.
        controller.abort();
        // Expo's native cancellation can wait on the network. Closing the Pi
        // event stream must not depend on that acknowledgement.
        void reader?.cancel().catch(() => {}); stream.end(output);
      }
    })();
    return stream;
  };
}
