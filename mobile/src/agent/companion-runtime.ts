import { fetch } from "expo/fetch";
import { CompanionAgent } from "./companion-agent";
import { readNewApiConfig } from "./newapi-config";
import { createNewApiStream } from "./newapi-stream";
import { recordDiagnosticEvent } from "../diagnostics/diagnostic-log";
import { phoneTools } from "./phone-tools";
import { mirrorSessionMessage, mirrorSessionTouch, getRecentConversationMessages } from "../memory/memory-service";
import { boundedRecentDialogue } from "../memory/recent-dialogue";
import { currentHermesTasks } from "../hermes/task-runtime";
import { listArtifacts } from "../artifacts/artifact-store";
import { readArtifactFocus } from "../artifacts/artifact-focus";
import { resultPresentation } from "../artifacts/presentation";
import { getMediaJobs } from "../artifacts/media-jobs";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import { restoredCompanionContext } from "./restored-context";
import { observeSkillTool, observeSkillReply, prepareSkillContext } from "../skills/skill-runtime";
import type { ConversationReporter } from "../voice/conversation-feedback";
import { quickPhotoRequest } from "../voice/quick-photo-request";
import { photoTool } from "./camera-tools";

import { updateCompanionProgress as update } from "./companion-progress";
let agent: CompanionAgent | undefined;
let binding = "";
let sessionId = "";
let currentFeedback: ConversationReporter | undefined;
let recoveredDialogue = "";
const taskNotices = new Map<string, string>();
export function queueCompanionTaskResult(id: string, text: string) {
  taskNotices.set(id, text.slice(0, 10_000));
  if (taskNotices.size > 16) taskNotices.delete(taskNotices.keys().next().value!);
}
export async function replyToCompanion(text: string, signal: AbortSignal, feedback?: ConversationReporter): Promise<string> {
  const releaseCountdown = resultPresentation.holdCountdown();
  update({ phase: "thinking", label: "正在想怎么回答" });
  try {
    if (signal.aborted) throw new Error("已停止");
    const photo = quickPhotoRequest(text);
    if (photo) {
      update({ phase: "tool", label: "正在拍照，照片出现后可用语音或按钮选择" });
      feedback?.({ kind: "stage", text: "我来拍照，照片出现后可以直接说你的选择。" });
      const result = await photoTool.execute(`quick-photo-${Date.now()}`, photo, signal);
      if (signal.aborted) throw new Error("已停止");
      observeSkillTool("phone_photo", false, result);
      const reply = (result.details as { cancelled?: boolean })?.cancelled ? "拍照已取消。" : "照片已经确认并保存。";
      const cameraSession = sessionId || `camera-${Date.now()}`;
      mirrorSessionTouch(cameraSession, "system");
      mirrorSessionMessage(cameraSession, { role: "user", content: text });
      mirrorSessionMessage(cameraSession, { role: "assistant", content: reply });
      agent?.appendBackgroundResult(reply + "具体作品请查询手机作品记录。");
      update({ phase: "idle", label: "" }); return reply;
    }
    const config = await readNewApiConfig();
    if (!config) throw new Error("请在菜单的模型连接中填写中转站和 API Key");
    const identity = JSON.stringify(config); // In memory only. Never logged or persisted outside SecureStore.
    if (!agent || binding !== identity) {
      recoveredDialogue = await getRecentConversationMessages().then(boundedRecentDialogue).catch(()=>JSON.stringify({unavailable:true,notice:"近期聊天暂时无法恢复，不能声称记得旧问答"}));
      agent?.abort(); binding = identity;
      agent = new CompanionAgent(config, createNewApiStream(config, fetch, (value) => {
        recordDiagnosticEvent("llm", "chat-http", { ...value });
        if (value.stage === "retry") {
          const reason = value.status === 429 ? "服务暂时限制请求" : value.status && value.status >= 500 ? "模型服务暂时不可用"
            : value.reason === "idle-timeout" || value.reason === "total-timeout" ? "等待模型数据超时" : "模型连接暂时不稳定";
          const label = `${reason}，准备第${value.attempt! + 1}次尝试`;
          update({ phase: "thinking", label }); currentFeedback?.({ kind: "stage", text: label + "。" });
        }
      }), phoneTools, update, observeSkillTool, observeSkillReply);
      sessionId = `pi-${Date.now()}`; mirrorSessionTouch(sessionId, "system");
    }
    const tasks = await currentHermesTasks().catch(() => []);
    const mediaBinding = await digestStringAsync(CryptoDigestAlgorithm.SHA256, config.baseUrl + "\n" + config.apiKey);
    const media = getMediaJobs().list().filter((job) => job.binding === mediaBinding);
    let skills: string;
    try { skills = prepareSkillContext(text, phoneTools.map((tool) => tool.name)); }
    catch { skills = JSON.stringify({ unavailable: true, notice: "本轮技能库暂时无法读取；不能声称已加载或记得技能步骤，其他手机工具仍可正常使用" }); }
    const inspections=await import("../inspection/inspection-runtime").then(async m=>(await import("../inspection/inspection-service")).inspectionContext(m.getInspectionService().list())).catch(()=>({unavailable:true}));
    agent.restoreContext(JSON.stringify({tasksAndMedia:JSON.parse(restoredCompanionContext(tasks, listArtifacts(), media, readArtifactFocus(), resultPresentation.getSnapshot().active?.id)),inspections}), skills, recoveredDialogue);
    for (const [id, notice] of taskNotices) if (tasks.some((task) => task.id === id) || media.some((job) => `media:${job.id}` === id)) agent.appendBackgroundResult(notice);
    taskNotices.clear();
    mirrorSessionMessage(sessionId, { role: "user", content: text });
    currentFeedback = feedback;
    const reply = await agent.reply(text, signal, feedback);
    mirrorSessionMessage(sessionId, { role: "assistant", content: reply });
    update({ phase: "idle", label: "" }); return reply;
  } catch (error) {
    update({ phase: signal.aborted ? "idle" : "error", label: signal.aborted ? "" : error instanceof Error ? error.message : "对话暂时不可用" });
    throw error;
  } finally { if (currentFeedback === feedback) currentFeedback = undefined; releaseCountdown(); }
}
