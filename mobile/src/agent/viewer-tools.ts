import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { AppState } from "react-native";
import { resultPresentation as presentation } from "../artifacts/presentation";
import { videoControl } from "../artifacts/video-control";
import { documentControl } from "../artifacts/document-control";

export const viewerControlTool: AgentTool = {
  name: "viewer_control", label: "正在调整作品展示",
  description: "控制当前作品。status 返回当前作品、队列编号、视频进度或文档页码；pin/unpin 固定/取消，close 关闭但保留作品。视频用 play/pause/replay/seek(seconds)。文档用 next_page/previous_page/go_page(page，一起从第1页计数)。next_result 打开队列下一项，可指定 id 选择待展示作品。重新打开作品用 show_artifact；不能控制拍照确认框、录像或外部 WPS。",
  parameters: Type.Object({ action: Type.Union([Type.Literal("status"), Type.Literal("pin"), Type.Literal("unpin"), Type.Literal("close"), Type.Literal("play"), Type.Literal("pause"), Type.Literal("replay"), Type.Literal("seek"), Type.Literal("next_page"), Type.Literal("previous_page"), Type.Literal("go_page"), Type.Literal("next_result")]),
    seconds: Type.Optional(Type.Number({ minimum: 0 })),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    id: Type.Optional(Type.String({ minLength: 1 })), pinned: Type.Optional(Type.Boolean({ description: "next_result 打开后同时固定" })) }),
  execute: async (_id, params, signal) => {
    if (signal?.aborted) throw new Error("已取消展示操作");
    if (AppState.currentState !== "active") throw new Error("请保持 App 在前台操作展示");
    const { action, id, seconds, page } = params as { action: "status" | "pin" | "unpin" | "close" | "play" | "pause" | "replay" | "seek" | "next_page" | "previous_page" | "go_page" | "next_result"; id?: string; seconds?: number; page?: number };
    if (!["status", "pin", "unpin", "close", "play", "pause", "replay", "seek", "next_page", "previous_page", "go_page", "next_result"].includes(action)) throw new Error("不支持的展示操作");
    const before = presentation.getSnapshot();
    if (id && action !== "next_result" && before.active?.id !== id) throw new Error("该作品当前未展示，请先查询当前展示或重新打开指定作品");
    if (action === "next_result") { presentation.next(id); if ((params as { pinned?: boolean }).pinned) presentation.pin(true); }
    let document;
    if (["next_page", "previous_page", "go_page"].includes(action)) {
      if (before.active?.kind !== "document") throw new Error("当前没有展示文档");
      document = documentControl.run(before.active.id, action as "next_page" | "previous_page" | "go_page", page);
      presentation.interact();
    }
    const playback = ["play", "pause", "replay", "seek"].includes(action);
    if (playback) {
      if (before.active?.kind !== "video") throw new Error("当前没有展示视频，请先打开要播放的视频");
      videoControl.run(before.active.id, action as "play" | "pause" | "replay" | "seek", seconds);
      // Synchronously clear a completed video's timer, before the next native event.
      presentation.videoResumedOrSeeking(before.active.id);
    }
    if (before.active) {
      if (action === "pin" || action === "unpin") presentation.pin(action === "pin");
      else if (action === "close") presentation.close(false);
    }
    const state = presentation.getSnapshot();
    const value = { action, active: state.active ? { id: state.active.id, title: state.active.title, kind: state.active.kind } : null,
      pinned: state.pinned, queued: state.queue.length, position: state.position, total: state.total,
      queue: state.queue.map(({ id, title, kind }) => ({ id, title, kind })),
      document: state.active?.kind === "document" ? document ?? documentControl.status() : null,
      video: state.active?.kind === "video" ? videoControl.status() : null,
      notice: action === "next_result" ? "已打开所选待展示结果" : document ? "已切换文档页码" : !before.active ? "当前没有展示作品" : playback ? "已执行视频播放操作，请以实际进度为准" : action === "close" ? "已关闭展示，作品仍保留，可重新调出" : action === "status" ? "已查询当前展示" : state.pinned ? "已固定" : "已取消固定" };
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} };
  },
};
