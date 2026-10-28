import { AppState } from "react-native";
import { integrationControl } from "../../modules/integration-control";
import { phoneTools } from "../agent/phone-tools";
import { replyToCompanion } from "../agent/companion-runtime";
import { chineseVoice } from "../voice/chinese-voice-runtime";
import { probeModelConnection } from "./model-connection-probe";

/** Only the permission-protected native receiver can enqueue commands. */
export function startIntegrationControl() {
  let busy = false, closed = false;
  const native = integrationControl();
  const tick = async () => {
    if (closed || busy || AppState.currentState !== "active") return;
    const raw = native.takeCommand(); if (!raw) return;
    busy = true; let id = "unknown";
    try {
      const command = JSON.parse(raw); id = command.id;
      native.reportResult(JSON.stringify({ id, status: "running" }));
      let result;
      if (command.kind === "chat") result = await replyToCompanion(String(command.text).slice(0, 10000), new AbortController().signal);
      else if (command.kind === "probe") result = await probeModelConnection(String(command.mode));
      else if (command.kind === "status") result = chineseVoice.getSnapshot();
      else {
        const tool = phoneTools.find((entry) => entry.name === command.tool);
        if (!tool) throw new Error("未知联调工具");
        const value = await tool.execute(`adb-${id}`, command.args ?? {}, new AbortController().signal);
        result = value.content.map((part) => part.type === "text" ? { type: "text", text: part.text.slice(0, 12000) } : { type: part.type });
      }
      const serialized = JSON.stringify({ id, status: "completed", result });
      native.reportResult(serialized.length <= 24000 ? serialized : JSON.stringify({ id, status: "completed", truncated: true, result: serialized.slice(0, 6000) }));
    } catch (error) { native.reportResult(JSON.stringify({ id, status: "failed", error: error instanceof Error ? error.message : "联调失败" })); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 800);
  return () => { closed = true; clearInterval(timer); };
}
