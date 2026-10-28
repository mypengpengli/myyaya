export type RunStatus = "pending" | "started" | "queued" | "running" | "waiting_for_approval" | "stopping" | "completed" | "failed" | "cancelled" | "interrupted";
export type RunSnapshot = { run_id: string; status: RunStatus; output?: string; session_id?: string };
export type RunEvent = { event: string; [key: string]: unknown };
export const terminalRun = (status: RunStatus) => ["completed", "failed", "cancelled", "interrupted"].includes(status);

export function parseRunSnapshot(value: unknown): RunSnapshot {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data.run_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(data.run_id) ||
      !["started", "queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled", "interrupted"].includes(String(data.status))) {
    throw new Error("invalid_run_response");
  }
  return { run_id: data.run_id, status: data.status as RunStatus,
    ...(typeof data.session_id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(data.session_id) ? { session_id: data.session_id } : {}),
    ...(typeof data.output === "string" ? { output: data.output } : {}) };
}

/** Incremental SSE framing, including split CRLF, UTF-8 decoded chunks and multiline data. */
export class RunEventParser {
  private buffer = "";
  private data: string[] = [];
  private name = "";
  private size = 0;
  constructor(private readonly emit: (event: RunEvent) => void) {}
  push(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length + this.size > 1_048_576) throw new Error("event_too_large");
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line) {
        if (this.data.length) {
          let payload: unknown;
          try { payload = JSON.parse(this.data.join("\n")); } catch { payload = null; }
          if (payload && typeof payload === "object" && !Array.isArray(payload)) {
            const value = payload as Record<string, unknown>;
            const event = typeof value.event === "string" ? value.event : this.name;
            if (event) this.emit({ ...value, event });
          }
        }
        this.data = []; this.name = ""; this.size = 0;
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") { this.data.push(value); this.size += value.length; }
        if (field === "event") this.name = value;
      }
    }
  }
}
