import { fetch } from "expo/fetch";
import { CompanionAgent } from "./companion-agent";
import { readNewApiConfig } from "./newapi-config";
import { createNewApiStream } from "./newapi-stream";
import { phoneTools } from "./phone-tools";
import { mirrorSessionMessage, mirrorSessionTouch } from "../memory/memory-service";

import { updateCompanionProgress as update } from "./companion-progress";
let agent: CompanionAgent | undefined;
let binding = "";
let sessionId = "";
export async function replyToCompanion(text: string, signal: AbortSignal): Promise<string> {
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
    mirrorSessionMessage(sessionId, { role: "user", content: text });
    const reply = await agent.reply(text, signal);
    mirrorSessionMessage(sessionId, { role: "assistant", content: reply });
    update({ phase: "idle", label: "" }); return reply;
  } catch (error) {
    update({ phase: signal.aborted ? "idle" : "error", label: signal.aborted ? "" : error instanceof Error ? error.message : "对话暂时不可用" });
    throw error;
  }
}
