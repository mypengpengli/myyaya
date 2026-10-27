import { fetch } from "expo/fetch";
import { resolveHermesConnection, type HermesConnection } from "./connection";
import { parseRunSnapshot, RunEventParser, type RunEvent, type RunSnapshot } from "./run-protocol";

export class HermesHttpError extends Error {
  constructor(readonly status: number) { super(`hermes_http_${status}`); }
}
export interface RunTransport {
  discover(): Promise<void>;
  submit(payload: string, key: string): Promise<RunSnapshot>;
  status(runId: string): Promise<RunSnapshot>;
  stop(runId: string): Promise<RunSnapshot>;
  events(runId: string, signal: AbortSignal, emit: (event: RunEvent) => void): Promise<void>;
}

export function createRunClient(connection: HermesConnection): RunTransport {
  const config = resolveHermesConnection(connection.baseUrl, connection.token, null);
  const headers = { Authorization: `Bearer ${config.token}`, Accept: "application/json" };
  const json = async (path: string, method = "GET", body?: string, key?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(config.baseUrl + path, { method, body, signal: controller.signal,
        redirect: "error", credentials: "omit",
        headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) } });
      if (!response.ok) throw new HermesHttpError(response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  };
  const path = (id: string) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("invalid_run_id");
    return `/v1/runs/${id}`;
  };
  return {
    async discover() {
      const data = await json("/v1/capabilities");
      if (!["run_submission", "run_status", "run_events_sse", "run_stop"].every((name) => data?.features?.[name] === true)) {
        throw new Error("runs_not_supported");
      }
    },
    submit: async (payload, key) => parseRunSnapshot(await json("/v1/runs", "POST", payload, key)),
    status: async (id) => parseRunSnapshot(await json(path(id))),
    stop: async (id) => {
      const result = await json(path(id) + "/stop", "POST");
      // Official stop acknowledgements contain status only; they are not final cancellation.
      return parseRunSnapshot({ ...result, run_id: result.run_id ?? id });
    },
    async events(id, signal, emit) {
      const response = await fetch(config.baseUrl + path(id) + "/events", {
        signal, redirect: "error", credentials: "omit", headers: { ...headers, Accept: "text/event-stream" },
      });
      if (!response.ok) throw new HermesHttpError(response.status);
      if (!response.body) throw new Error("stream_unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new RunEventParser(emit);
      try {
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.push(decoder.decode());
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
}
