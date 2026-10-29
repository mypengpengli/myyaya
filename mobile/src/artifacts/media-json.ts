export type MediaHttpDiagnostic = {
  stage: "headers" | "receiving" | "complete" | "error";
  status: number; contentType: string; receivedBytes: number; elapsedMs: number;
  contentLength?: number; requestId?: string; reason?: string;
};
export class MediaJsonReadError extends Error {
  constructor(readonly diagnostic: MediaHttpDiagnostic) { super("media-json-read-failed"); }
}

/** Read one bounded JSON response. A complete object need not wait for a relay's
 * idle connection to close. Diagnostics contain metadata, never response text. */
export async function readMediaJson(response: Pick<Response, "status" | "headers" | "body">, options: {
  signal?: AbortSignal; startedAt?: number; maxBytes?: number;
  report?: (value: MediaHttpDiagnostic) => void;
} = {}): Promise<any> {
  const started = options.startedAt ?? Date.now(), limit = options.maxBytes ?? 40 * 1024 * 1024;
  const rawType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const contentType = rawType === "application/json" || rawType?.endsWith("+json") ? "json" :
    rawType === "text/html" ? "html" : rawType === "text/event-stream" ? "sse" : rawType === "text/plain" ? "text" : rawType ? "other" : "missing";
  const length = Number(response.headers.get("content-length") ?? NaN);
  const rawId = response.headers.get("x-request-id") ?? response.headers.get("x-oneapi-request-id") ?? response.headers.get("request-id");
  const requestId = rawId && /^[A-Za-z0-9_.:-]{1,120}$/.test(rawId) ? rawId : undefined;
  let receivedBytes = 0, lastReport = 0;
  const snapshot = (stage: MediaHttpDiagnostic["stage"], reason?: string): MediaHttpDiagnostic => ({
    stage, status: response.status, contentType, receivedBytes, elapsedMs: Date.now() - started,
    ...(Number.isSafeInteger(length) && length >= 0 ? { contentLength: length } : {}),
    ...(requestId ? { requestId } : {}), ...(reason ? { reason } : {}),
  });
  const fail = (reason: string): never => { throw new MediaJsonReadError(snapshot("error", reason)); };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortRead: (() => void) | undefined;
  try {
    options.report?.(snapshot("headers"));
    reader = response.body?.getReader();
    if (length > limit) fail("too-large");
    if (!reader) fail("empty");
    const aborted = options.signal ? new Promise<never>((_, reject) => {
      abortRead = () => reject(new MediaJsonReadError(snapshot("error", "aborted")));
      options.signal!.addEventListener("abort", abortRead, { once: true });
    }) : undefined;
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let startedJson = false, invalid = false, inString = false, escaped = false, depth = 0;
    const consume = (text: string): { value: any } | undefined => {
      if (invalid) return;
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (!startedJson) {
          if (/\s/.test(char) || char === "\uFEFF") continue;
          if (char !== "{" && char !== "[") { invalid = true; parts.length = 0; return; }
          startedJson = true;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === "{" || char === "[") depth++;
        else if (char === "}" || char === "]") {
          depth--;
          if (depth === 0) {
            if (text.slice(i + 1).trim()) fail("invalid-json");
            parts.push(text.slice(0, i + 1));
            try { return { value: JSON.parse(parts.join("").replace(/^\uFEFF/, "").trimStart()) }; }
            catch { fail("invalid-json"); }
          }
        }
      }
      parts.push(text);
    };
    while (true) {
      if (options.signal?.aborted) fail("aborted");
      const chunk = await (aborted ? Promise.race([reader!.read(), aborted]) : reader!.read());
      if (chunk.value) receivedBytes += chunk.value.byteLength;
      if (receivedBytes > limit) fail("too-large");
      const parsed = consume(chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true }));
      if (parsed) { options.report?.(snapshot("complete")); return parsed.value; }
      if (chunk.done) fail(invalid ? "non-json" : startedJson ? "incomplete" : "empty");
      if (Date.now() - lastReport >= 5000) { lastReport = Date.now(); options.report?.(snapshot("receiving")); }
    }
  } catch (error) {
    const safe = error instanceof MediaJsonReadError ? error : new MediaJsonReadError(snapshot("error", options.signal?.aborted ? "aborted" : "read-failed"));
    options.report?.(safe.diagnostic); throw safe;
  } finally {
    if (abortRead) options.signal?.removeEventListener("abort", abortRead);
    void reader?.cancel().catch(() => {});
  }
}
