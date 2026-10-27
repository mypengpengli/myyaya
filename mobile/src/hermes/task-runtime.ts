import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { AppState } from "react-native";
import { readHermesConnection } from "./connection";
import { createRunClient, type RunTransport } from "./run-client";
import { terminalRun } from "./run-protocol";
import { hermesTaskRepository } from "./run-store";
import { HermesTaskService } from "./task-service";

let service: HermesTaskService | null = null;
export function getHermesTaskService() {
  if (!service) service = new HermesTaskService(hermesTaskRepository, randomUUID);
  return service;
}

async function connectionContext() {
  const connection = await readHermesConnection();
  if (!connection) throw new Error("请先在设置中填写 Hermes Token 并测试连接");
  // A different credential must never replay a pending task in a different API account.
  const accountId = await digestStringAsync(CryptoDigestAlgorithm.SHA256, connection.baseUrl + "\n" + connection.token);
  return { baseUrl: connection.baseUrl, accountId, client: createRunClient(connection) };
}

export async function submitNewHermesTask(input: string) {
  const { baseUrl, accountId, client } = await connectionContext();
  const tasks = getHermesTaskService();
  const task = tasks.create(input, baseUrl, accountId);
  await tasks.submit(task.id, baseUrl, accountId, client);
  return task.id;
}
export async function retryHermesTask(id: string) {
  const { baseUrl, accountId, client } = await connectionContext();
  await getHermesTaskService().submit(id, baseUrl, accountId, client);
}
export async function stopHermesTask(id: string) {
  const { baseUrl, accountId, client } = await connectionContext();
  await getHermesTaskService().stop(id, baseUrl, accountId, client);
}

/** Foreground-only transport. Server jobs survive app background/Android process exit. */
export function startHermesTaskMonitor(): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let binding = "";
  const streams = new Map<string, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>();
  const retryAt = new Map<string, number>();
  const closeStreams = () => {
    streams.forEach(({ controller, timer: watchdog }) => { controller.abort(); clearTimeout(watchdog); });
    streams.clear();
  };
  const openStream = (id: string, runId: string, client: RunTransport) => {
    if (streams.has(id) || (retryAt.get(id) ?? 0) > Date.now()) return;
    const controller = new AbortController();
    // Rotate bounded streams; status polling reconciles gaps without assuming event replay.
    const watchdog = setTimeout(() => controller.abort(), 45_000);
    const entry = { controller, timer: watchdog };
    streams.set(id, entry);
    void client.events(runId, controller.signal, (event) => {
      if (disposed || controller.signal.aborted || AppState.currentState !== "active") return;
      getHermesTaskService().acceptEvent(id, event);
    }).catch(() => { /* Polling remains authoritative, including on expired SSE buffers. */ }).finally(() => {
      clearTimeout(watchdog);
      if (streams.get(id) === entry) streams.delete(id);
      retryAt.set(id, Date.now() + 15_000);
    });
  };
  const tick = async () => {
    timer = null;
    if (disposed) return;
    try {
      if (AppState.currentState !== "active") { closeStreams(); return; }
      const context = await connectionContext();
      if (disposed || AppState.currentState !== "active") return;
      if (binding !== context.accountId) { closeStreams(); retryAt.clear(); binding = context.accountId; }
      const tasks = getHermesTaskService();
      const active = tasks.list().filter((task) => task.runId && !terminalRun(task.status) &&
        task.baseUrl === context.baseUrl && task.accountId === context.accountId);
      for (const id of streams.keys()) {
        if (!active.some((task) => task.id === id)) { const entry = streams.get(id)!; entry.controller.abort(); clearTimeout(entry.timer); streams.delete(id); }
      }
      await Promise.all(active.map(async (task) => {
        openStream(task.id, task.runId!, context.client);
        await tasks.refresh(task.id, context.baseUrl, context.accountId, context.client);
      }));
    } catch { closeStreams(); }
    finally { if (!disposed) timer = setTimeout(() => void tick(), 3_000); }
  };
  const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") closeStreams(); });
  void tick();
  return () => { disposed = true; if (timer) clearTimeout(timer); closeStreams(); subscription.remove(); };
}
