import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { AppState, Platform } from "react-native";
import { router } from "expo-router";
import { getLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { memoryService } from "../memory/memory-service";
import { getHermesTaskService, submitNewHermesTask, stopHermesTask, currentHermesTasks, serverHermesHistory, continueHermesTask } from "../hermes/task-runtime";
import { presentArtifact, listArtifacts, selectedImage, listArtifactVersions } from "../artifacts/artifact-store";
import { readArtifactFocus, updateArtifactFocus } from "../artifacts/artifact-focus";
import { getPhoneRecording, startPhoneRecording, stopPhoneRecording } from "../artifacts/phone-recording";
import { getMediaJobs, submitMediaJob } from "../artifacts/media-jobs";
import { webSearchTool } from "../search/web-search-tool";
import { connectRobotTool, robotActionTool } from "./robot-tools";
import { photoTool, observeSceneTool } from "./camera-tools";
import { viewerControlTool } from "./viewer-tools";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], details: {} });
// Pi validates unknown arguments against each TypeBox schema before execute.
export const phoneTools: AgentTool[] = [
  webSearchTool, connectRobotTool, robotActionTool, viewerControlTool,
  { name: "phone_status", label: "正在检查手机和底座", description: "查询手机前台状态、LOOI 是否连接，不执行动作。",
    parameters: Type.Object({}), execute: async () => {
      const robot = getLooiRobotRuntimeState();
      return text({ platform: Platform.OS, foreground: AppState.currentState === "active",
        looiConnected: robot.connected, connecting: robot.connecting, lastError: robot.lastError,
        driveControlReady: robot.driveControlReady, safety: robot.safety,
        recording: getPhoneRecording().phase });
    } },
  photoTool, observeSceneTool,
  { name: "record_video", label: "正在准备录像", description: "用户明确要求录像时，使用手机相机开始有声录像。录像期间暂停语音识别，用户点击画面上的停止录像按钮结束，随后恢复对话。返回准备中不代表已保存。",
    parameters: Type.Object({ camera: Type.Union([Type.Literal("front"), Type.Literal("back")]) }), execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消录像");
      router.navigate("/");
      const recording = await startPhoneRecording((params as { camera: "front" | "back" }).camera);
      return text({ status: recording.phase, notice: recording.notice }); } },
  { name: "stop_recording", label: "正在保存录像", description: "停止当前录像并保存到手机。只有返回作品编号才表示已经保存。",
    parameters: Type.Object({}), execute: async () => { const artifact = await stopPhoneRecording(); return text(artifact ? { saved: true, id: artifact.id } : { saved: false, status: getPhoneRecording().phase, notice: getPhoneRecording().notice }); } },
  { name: "show_artifact", label: "正在打开作品", description: "重新显示之前保存的照片、录像或文档。空编号表示最近作品。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const item = presentArtifact((params as { id?: string }).id); router.navigate("/"); return text({ id: item.id, title: item.title, kind: item.kind }); } },
  { name: "list_artifacts", label: "正在查找作品", description: "列出最近保存的照片、录像和文档的稳定编号，供用户重新播放或继续修改。",
    parameters: Type.Object({}), execute: async () => text(listArtifacts().slice(0, 30).map(({ id, title, kind, createdAt, parentId }) => ({ id, title, kind, createdAt, parentId }))) },
  { name: "artifact_versions", label: "正在查找图片版本", description: "查询当前选中图片或指定作品的原图、修改版本及生成视频关系。返回稳定编号，可用 show_artifact 打开原图或中间版本。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => text({ selected: readArtifactFocus(), versions: listArtifactVersions((params as { id?: string }).id).map(({ id, title, kind, createdAt, parentId }) => ({ id, title, kind, createdAt, parentId })) }) },
  { name: "create_media", label: "正在安排生成任务", description: "生成图片、编辑图片或生成视频。编辑默认使用当前展示或明确选中的图片版本，存在歧义时先选图。图生视频指定 source=image，parentId 可指定准确版本；文生视频指定 source=text。立即返回任务编号，在后台继续生成，不代表已完成。",
    parameters: Type.Object({ kind: Type.Union([Type.Literal("image"), Type.Literal("edit"), Type.Literal("video")]),
      prompt: Type.String({ minLength: 1, maxLength: 2000 }), parentId: Type.Optional(Type.String()), source: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("image")])) }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消提交");
      const args = params as { kind: "image" | "edit" | "video"; prompt: string; parentId?: string; source?: "text" | "image" };
      if (args.source === "text" && args.parentId) throw new Error("文生请求不能同时指定输入图片");
      const parentId = args.kind === "edit" || args.source === "image" || args.parentId ? selectedImage(args.parentId).id : undefined;
      if (args.kind === "image" && parentId) throw new Error("修改已有图片请使用 edit");
      const job = await submitMediaJob({ kind: args.kind, prompt: args.prompt, ...(parentId ? { parentId } : {}) }, signal);
      return text({ id: job.id, parentId: job.parentId, status: job.status, notice: job.notice }); } },
  { name: "media_status", label: "正在查看生成进度", description: "查询生成图片、改图或视频任务的真实状态和结果作品编号。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const { id } = params as { id?: string }; return text(getMediaJobs().list().filter((job) => !id || job.id === id).slice(0, 10)
        .map(({ id, kind, prompt, status, artifactId, notice }) => ({ id, kind, prompt, status, artifactId, notice }))); } },
  { name: "remember", label: "正在记住这件事", description: "用户明确要求记住某事实或偏好时保存到手机长期记忆。不要存储密码、密钥或猜测。",
    parameters: Type.Object({ fact: Type.String({ minLength: 1, maxLength: 1000 }) }),
    execute: async (_id, params) => { const args = params as { fact: string }; await memoryService.remember([{ role: "user", content: args.fact }],
      { category: "note", source: "voice", timestamp: new Date().toISOString() }); return text("已保存到手机长期记忆"); } },
  { name: "search_memory", label: "正在查找记忆", description: "查询手机中保存的用户事实和偏好。没有记录时如实说不知道。",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }) }),
    execute: async (_id, params) => {
      const args = params as { query: string };
      const all = await memoryService.getAll();
      // Small stores provide full bounded context; Chinese word spacing is not
      // forced through SQLite's unicode61 English-oriented token boundaries.
      const facts = all.length <= 48 ? all : await memoryService.search(args.query);
      return text(facts.slice(0, 48).map((fact) => ({ id: fact.id, memory: fact.memory }))); } },
  { name: "hermes_submit", label: "正在安排后台任务", description: "把需要服务器浏览器、文件或办公操作的明确任务交给已配置的 Hermes。返回任务编号不等于任务完成。",
    parameters: Type.Object({ task: Type.String({ minLength: 1, maxLength: 10_000 }), returnFiles: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params, signal) => {
      const args = params as { task: string; returnFiles?: boolean };
      if (signal?.aborted) throw new Error("已取消提交");
      const id = await submitNewHermesTask(args.task, args.returnFiles);
      updateArtifactFocus({ taskId: id });
      const task = getHermesTaskService().list().find((item) => item.id === id);
      if (task?.runId && AppState.currentState === "active" && !signal?.aborted) router.navigate({ pathname: "/tasks", params: { taskId: id } });
      return text({ id, status: task?.status, accepted: Boolean(task?.runId), notice: task?.notice }); } },
  { name: "hermes_status", label: "正在查看任务结果", description: "查询已经提交的后台任务的真实进度和结果。空编号列出最近任务。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const args = params as { id?: string };
      const tasks = await currentHermesTasks();
      return text(tasks.filter((task) => !args.id || task.id === args.id).slice(0, 5)
        .map(({ id, runId, sessionId, status, output, notice, progress, delivery }) => ({ id, runId, sessionId: sessionId ?? `myyaya-${id}`, status, output: output.slice(0, 12_000), notice, files: delivery?.artifactIds, fileStatus: delivery?.files, progress: progress.slice(-3) }))); } },
  { name: "hermes_history", label: "正在查服务器旧会话", description: "只读查询 Hermes 已保存的手机任务会话；不填 sessionId 列出最近手机会话，填写后读取用户和助手消息历史，不重新执行任务。",
    parameters: Type.Object({ sessionId: Type.Optional(Type.String()) }), execute: async (_id, params) => text(await serverHermesHistory((params as { sessionId?: string }).sessionId)) },
  { name: "hermes_continue", label: "正在续办原任务", description: "用户明确要求继续修改或执行旧任务时，带服务器原会话和历史另建一次续办记录。查询旧结果请用 hermes_status/hermes_history。空 id 使用最近选中任务。",
    parameters: Type.Object({ id: Type.Optional(Type.String()), task: Type.String({ minLength: 1, maxLength: 10_000 }), returnFiles: Type.Optional(Type.Boolean()) }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消续办");
      const args = params as { id?: string; task: string; returnFiles?: boolean };
      const tasks = await currentHermesTasks(), focus = readArtifactFocus();
      const previous = args.id ? tasks.find((task) => task.id === args.id) : tasks.find((task) => task.id === focus.taskId) ?? tasks[0];
      if (!previous) throw new Error("没有可继续的旧任务，请先查询任务记录");
      const id = await continueHermesTask(previous.id, args.task, args.returnFiles);
      const task = getHermesTaskService().list().find((entry) => entry.id === id);
      if (task?.runId && AppState.currentState === "active") router.navigate({ pathname: "/tasks", params: { taskId: id } });
      return text({ id, previousTaskId: previous.id, sessionId: task?.sessionId, status: task?.status, accepted: Boolean(task?.runId) });
    } },
  { name: "hermes_stop", label: "正在请求停止任务", description: "用户明确要求停止指定的后台任务时请求取消，需根据返回状态确认是否结束。",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }) }), execute: async (_id, params) => {
      const args = params as { id: string };
      await stopHermesTask(args.id); return text(getHermesTaskService().list().find((task) => task.id === args.id)?.status); } },
];
