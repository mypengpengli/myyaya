import { fetch } from "expo/fetch";
import { CompanionAgent } from "./companion-agent";
import { readNewApiConfig } from "./newapi-config";
import { createNewApiStream } from "./newapi-stream";
import { phoneTools } from "./phone-tools";
import { mirrorSessionMessage, mirrorSessionTouch } from "../memory/memory-service";
import { currentHermesTasks } from "../hermes/task-runtime";
import { listArtifacts } from "../artifacts/artifact-store";
import { readArtifactFocus } from "../artifacts/artifact-focus";
import { resultPresentation } from "../artifacts/presentation";
import { getMediaJobs } from "../artifacts/media-jobs";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { restoredCompanionContext } from "./restored-context";

import { updateCompanionProgress as update } from "./companion-progress";
let agent: CompanionAgent | undefined;
let binding = "";
let sessionId = "";
const taskNotices = new Map<string, string>();
export function queueCompanionTaskResult(id: string, text: string) {
  taskNotices.set(id, text.slice(0, 10_000));
  if (taskNotices.size > 16) taskNotices.delete(taskNotices.keys().next().value!);
}
export async function replyToCompanion(text: string, signal: AbortSignal): Promise<string> {
  const releaseCountdown = resultPresentation.holdCountdown();
  update({ phase: "thinking", label: "正在想怎么回答" });
  try {
    const config = await readNewApiConfig();
    if (!config) throw new Error("请在菜单的模型连接中填写中转站和 API Key");
    const identity = JSON.stringify(config); // In memory only. Never logged or persisted outside SecureStore.
    if (!agent || binding !== identity) {
      agent?.abort(); binding = identity;
      agent = new CompanionAgent(config, createNewApiStream(config, fetch), phoneTools, update);
      sessionId = `pi-${Date.now()}`; mirrorSessionTouch(sessionId, "system");
    }
    const tasks = await currentHermesTasks().catch(() => []);
    const mediaBinding = await digestStringAsync(CryptoDigestAlgorithm.SHA256, config.baseUrl + "\n" + config.apiKey);
    const media = getMediaJobs().list().filter((job) => job.binding === mediaBinding);
    agent.restoreContext(restoredCompanionContext(tasks, listArtifacts(), media, readArtifactFocus(), resultPresentation.getSnapshot().active?.id));
    for (const [id, notice] of taskNotices) if (tasks.some((task) => task.id === id) || media.some((job) => `media:${job.id}` === id)) agent.appendBackgroundResult(notice);
    taskNotices.clear();
    mirrorSessionMessage(sessionId, { role: "user", content: text });
    const reply = await agent.reply(text, signal);
    mirrorSessionMessage(sessionId, { role: "assistant", content: reply });
    update({ phase: "idle", label: "" }); return reply;
  } catch (error) {
    update({ phase: signal.aborted ? "idle" : "error", label: signal.aborted ? "" : error instanceof Error ? error.message : "对话暂时不可用" });
    throw error;
  } finally { releaseCountdown(); }
}
