import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { getLocalFaceAttentionModule } from "../../modules/local-face-attention";
import { getLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { memoryService } from "../memory/memory-service";
import { getHermesTaskService, submitNewHermesTask, stopHermesTask } from "../hermes/task-runtime";
import { savePhotoArtifact, presentArtifact, listArtifacts } from "../artifacts/artifact-store";
import { resultPresentation } from "../artifacts/presentation";
import { getPhoneRecording, startPhoneRecording, stopPhoneRecording } from "../artifacts/phone-recording";
import { getMediaJobs, submitMediaJob } from "../artifacts/media-jobs";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], details: {} });
// Pi validates unknown arguments against each TypeBox schema before execute.
export const phoneTools: AgentTool[] = [
  { name: "phone_status", label: "正在检查手机和底座", description: "查询手机前台状态、LOOI 是否连接，不执行动作。",
    parameters: Type.Object({}), execute: async () => text({ platform: Platform.OS, foreground: AppState.currentState === "active",
      looiConnected: getLooiRobotRuntimeState().connected, recording: getPhoneRecording().phase }) },
  { name: "phone_photo", label: "正在拍照", description: "用户要求拍照或看眼前事物时，用手机相机取得当前真实照片。front 看手机屏幕前方，back 看手机背后。",
    parameters: Type.Object({ camera: Type.Union([Type.Literal("front"), Type.Literal("back")]) }),
    execute: async (_id, params, signal) => {
      const args = params as { camera: "front" | "back" };
      if (signal?.aborted) throw new Error("已取消拍照");
      if (["preparing", "recording", "saving"].includes(getPhoneRecording().phase)) throw new Error("正在录像，请先停止录像再拍照");
      if (AppState.currentState !== "active" || !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)) throw new Error("请允许相机权限并保持 App 在前台");
      const camera = getLocalFaceAttentionModule();
      if (!camera) throw new Error("此安装包没有可用的相机模块");
      const photo = await camera.captureStill(args.camera);
      if (signal?.aborted) throw new Error("已取消拍照");
      const artifact = await savePhotoArtifact(photo.base64, photo.mimeType, "手机照片");
      resultPresentation.offer(artifact);
      return { content: [{ type: "text", text: `手机刚刚拍摄的${args.camera === "front" ? "前置" : "后置"}照片，已保存。作品编号：${artifact.id}` },
        { type: "image", data: photo.base64, mimeType: photo.mimeType }], details: {} };
    } },
  { name: "record_video", label: "正在准备录像", description: "用户明确要求录像时，使用手机相机开始有声录像。录像期间暂停语音识别，用户点击画面上的停止录像按钮结束，随后恢复对话。返回准备中不代表已保存。",
    parameters: Type.Object({ camera: Type.Union([Type.Literal("front"), Type.Literal("back")]) }), execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消录像");
      const recording = await startPhoneRecording((params as { camera: "front" | "back" }).camera);
      return text({ status: recording.phase, notice: recording.notice }); } },
  { name: "stop_recording", label: "正在保存录像", description: "停止当前录像并保存到手机。只有返回作品编号才表示已经保存。",
    parameters: Type.Object({}), execute: async () => { const artifact = await stopPhoneRecording(); return text(artifact ? { saved: true, id: artifact.id } : { saved: false, status: getPhoneRecording().phase, notice: getPhoneRecording().notice }); } },
  { name: "show_artifact", label: "正在打开作品", description: "重新显示之前保存的照片、录像或文档。空编号表示最近作品。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const item = presentArtifact((params as { id?: string }).id); return text({ id: item.id, title: item.title, kind: item.kind }); } },
  { name: "list_artifacts", label: "正在查找作品", description: "列出最近保存的照片、录像和文档的稳定编号，供用户重新播放或继续修改。",
    parameters: Type.Object({}), execute: async () => text(listArtifacts().slice(0, 30).map(({ id, title, kind, createdAt, parentId }) => ({ id, title, kind, createdAt, parentId }))) },
  { name: "create_media", label: "正在安排生成任务", description: "按用户要求生成图片、编辑已保存的图片或生成视频。编辑和图生视频需传入准确图片编号。立即返回任务编号，在后台继续生成；不代表作品已完成。",
    parameters: Type.Object({ kind: Type.Union([Type.Literal("image"), Type.Literal("edit"), Type.Literal("video")]),
      prompt: Type.String({ minLength: 1, maxLength: 2000 }), parentId: Type.Optional(Type.String()) }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消提交");
      const input = params as { kind: "image" | "edit" | "video"; prompt: string; parentId?: string };
      if (input.kind === "edit" && !input.parentId) throw new Error("请指定要修改的图片编号");
      const job = await submitMediaJob(input, signal); return text({ id: job.id, status: job.status, notice: job.notice }); } },
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
    parameters: Type.Object({ task: Type.String({ minLength: 1, maxLength: 10_000 }) }),
    execute: async (_id, params, signal) => {
      const args = params as { task: string };
      if (signal?.aborted) throw new Error("已取消提交");
      const id = await submitNewHermesTask(args.task);
      const task = getHermesTaskService().list().find((item) => item.id === id);
      return text({ id, status: task?.status, accepted: Boolean(task?.runId), notice: task?.notice }); } },
  { name: "hermes_status", label: "正在查看任务结果", description: "查询已经提交的后台任务的真实进度和结果。空编号列出最近任务。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const args = params as { id?: string };
      return text(getHermesTaskService().list().filter((task) => !args.id || task.id === args.id).slice(0, 5)
        .map(({ id, status, output, notice, progress }) => ({ id, status, output: output.slice(0, 12_000), notice, progress: progress.slice(-3) }))); } },
  { name: "hermes_stop", label: "正在请求停止任务", description: "用户明确要求停止指定的后台任务时请求取消，需根据返回状态确认是否结束。",
    parameters: Type.Object({ id: Type.String({ minLength: 1 }) }), execute: async (_id, params) => {
      const args = params as { id: string };
      await stopHermesTask(args.id); return text(getHermesTaskService().list().find((task) => task.id === args.id)?.status); } },
];
