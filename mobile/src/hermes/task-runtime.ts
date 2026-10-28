import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import { AppState } from "react-native";
import { readHermesConnection } from "./connection";
import { createRunClient, type RunTransport } from "./run-client";
import { terminalRun } from "./run-protocol";
import { hermesTaskRepository } from "./run-store";
import { HermesTaskService } from "./task-service";
import { updateArtifactFocus } from "../artifacts/artifact-focus";
import { createHermesHistoryClient } from "./history-client";

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
  return { baseUrl: connection.baseUrl, accountId, connection, client: createRunClient(connection) };
}

export async function submitNewHermesTask(input: string, returnFiles?: boolean) {
  const { baseUrl, accountId, client } = await connectionContext();
  const tasks = getHermesTaskService();
  const task = tasks.create(input, baseUrl, accountId, returnFiles);
  updateArtifactFocus({ taskId: task.id });
  await tasks.submit(task.id, baseUrl, accountId, client);
  return task.id;
}
export async function currentHermesTasks() {
  const context = await connectionContext();
  return getHermesTaskService().list().filter((task) => task.baseUrl === context.baseUrl && task.accountId === context.accountId);
}
export async function serverHermesHistory(sessionId?: string) {
  const { connection } = await connectionContext(), history = createHermesHistoryClient(connection);
  return sessionId ? history.messages(sessionId) : history.list();
}
export async function continueHermesTask(id: string, input: string, returnFiles?: boolean) {
  const { baseUrl, accountId, client, connection } = await connectionContext();
  const tasks = getHermesTaskService(), previous = tasks.list().find((item) => item.id === id);
  if (!previous || previous.baseUrl !== baseUrl || previous.accountId !== accountId) throw new Error("没有找到当前连接下的原任务");
  if (!terminalRun(previous.status)) throw new Error("原任务仍在进行，请先查询进度或等它结束");
  const sessionId = previous.sessionId ?? `myyaya-${previous.id}`;
  // Runs accepts explicit history. Do not assume a repeated session_id loads it automatically.
  let history;
  try { history = await createHermesHistoryClient(connection).messages(sessionId); }
  catch { history = [{ role: "user", content: previous.input }, { role: "assistant", content: previous.output.slice(0, 12_000) }]; }
  const task = tasks.create(input, baseUrl, accountId, returnFiles ?? previous.wantsFiles, { sessionId, previousTaskId: previous.id, history });
  updateArtifactFocus({ taskId: task.id });
  await tasks.submit(task.id, baseUrl, accountId, client);
  return task.id;
}
export function retryHermesFiles(id: string): void {
  const tasks = getHermesTaskService(), task = tasks.list().find((item) => item.id === id);
  if (!task || task.status !== "completed" || !task.wantsFiles || task.delivery?.files === "pending") return;
  tasks.updateDelivery(id, { files: "pending", notified: false, notice: "正在重新取回文件", dismissed: false });
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
  let completion: import("./completion-service").CompletionCoordinator | null = null;
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
      if (binding !== context.accountId) { closeStreams(); retryAt.clear(); binding = context.accountId; completion = null; }
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
      if (!disposed && tasks.list().some((task) => terminalRun(task.status) && task.delivery && !task.delivery.notified && task.accountId === context.accountId && task.baseUrl === context.baseUrl)) {
        const current = async () => !disposed && AppState.currentState === "active" && (await connectionContext()).accountId === context.accountId;
        if (!completion) {
          const { createCompletionCoordinator } = await import("./completion-runtime");
          if (!await current()) return;
          completion = createCompletionCoordinator(tasks, context.connection, current);
        }
        void completion.process(context.baseUrl, context.accountId).catch(() => {});
      }
    } catch { closeStreams(); }
    finally { if (!disposed) timer = setTimeout(() => void tick(), 3_000); }
  };
  const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") closeStreams(); });
  void tick();
  return () => { disposed = true; if (timer) clearTimeout(timer); closeStreams(); subscription.remove(); };
}
