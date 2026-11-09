import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { Alert, AppState, Platform } from "react-native";
import { router } from "expo-router";
import { getLooiRobotRuntimeState } from "../device-tools/looi-robot";
import { memoryService } from "../memory/memory-service";
import { getHermesTaskService, submitNewHermesTask, stopHermesTask, currentHermesTasks, serverHermesHistory, continueHermesTask } from "../hermes/task-runtime";
import { presentArtifact, findArtifact, listArtifacts, selectedImage, listArtifactVersions } from "../artifacts/artifact-store";
import { readArtifactFocus, updateArtifactFocus } from "../artifacts/artifact-focus";
import { getPhoneRecording, startPhoneRecording, stopPhoneRecording } from "../artifacts/phone-recording";
import { getMediaJobs, submitMediaJob } from "../artifacts/media-jobs";
import { webSearchTool } from "../search/web-search-tool";
import { connectRobotTool, robotActionTool } from "./robot-tools";
import { photoTool, observeSceneTool } from "./camera-tools";
import { viewerControlTool } from "./viewer-tools";
import { resultPresentation } from "../artifacts/presentation";
import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, type MediaAspectRatio, type ImageResolution } from "../artifacts/agnes-protocol";
import { createSkillTools } from "../skills/skill-tools";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], details: {} });
// Pi validates unknown arguments against each TypeBox schema before execute.
export const phoneTools: AgentTool[] = [
  ...createSkillTools(() => phoneTools.map((tool) => tool.name)),
  webSearchTool, connectRobotTool, robotActionTool, viewerControlTool,
  { name: "list_taught_routes", label: "正在查看已教路线", description: "列出手机保存的人工教学路线。去客厅等请求先查真实路线，不能编造路线或声称已到达。",
    parameters: Type.Object({}), execute: async () => {
      const { listTaughtRoutes } = await import("../../modules/navigation-probe");return text(await listTaughtRoutes());
    } },
  { name: "open_taught_route", label: "正在打开指定路线", description: "用户明确要求去某地时，打开list_taught_routes返回的具体路线。第一版先在导航页确认定位、固定头部和短动作校验，再点开始复走；本工具只打开流程，不表示已经行驶或到达。无路线时请用户先教路线，禁止用robot_action循环盲走。",
    parameters: Type.Object({ route_id: Type.String() }), execute: async (_id, params, signal) => {
      if (signal?.aborted || AppState.currentState !== "active") throw new Error("请在应用前台打开路线");
      const { listTaughtRoutes } = await import("../../modules/navigation-probe");
      const route = (await listTaughtRoutes()).find((r) => r.id === (params as { route_id: string }).route_id);
      if (!route) throw new Error("未找到该路线，请先查看已教路线");
      setTimeout(() => { if(signal?.aborted) return;void import("../navigation/route-robot-session").then(({ openTaughtRouteSession }) => signal?.aborted ? null : openTaughtRouteSession(route.id))
        .catch((error) => Alert.alert("路线导航",error instanceof Error ? error.message : String(error))); }, 0);
      return text({ route: route.name, status: "opening_route_setup", moving: false, notice: "正在打开指定路线，需在导航页完成定位与校验后开始复走。" });
    } },
  { name: "phone_status", label: "正在检查手机和底座", description: "查询手机前台状态、LOOI 是否连接，不执行动作。",
    parameters: Type.Object({}), execute: async () => {
      const robot = getLooiRobotRuntimeState();
      return text({ platform: Platform.OS, foreground: AppState.currentState === "active",
        looiConnected: robot.connected, connecting: robot.connecting, lastError: robot.lastError,
        driveControlReady: robot.driveControlReady, safety: robot.safety,
        recording: getPhoneRecording().phase });
    } },
  { name: "robot_head_status", label: "正在读取头部状态", description: "只读检查已连接底座的头部蓝牙属性、原始回读和手机倾角，不发运动命令，不会自动连接。原始字节语义未确认，倾角也不能证明脖子最低；physicalPosition 为 unknown 时须如实说明。",
    parameters: Type.Object({}), execute: async (_id, _params, signal) => {
      if (signal?.aborted || AppState.currentState !== "active") throw new Error("请在前台读取头部状态");
      const [{ inspectLooiHeadChannel }, observation, sensors, tilt] = await Promise.all([
        import("../device-tools/looi-robot"), import("../device-tools/head-observation"),
        import("../../modules/robot-observation"), import("../device-tools/head-tilt"),
      ]);
      const release = sensors.acquireRobotObservation();
      try {
        const channel = await inspectLooiHeadChannel();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const gravity = sensors.robotGravitySnapshot();
        return text({ ...channel, gravity: { available: gravity.available, active: gravity.active,
          stable: tilt.stableGravity(gravity), latest: gravity.samples.at(-1) ?? null },
          lastCommandObservation: observation.getLastHeadObservation(), physicalPosition: "unknown" });
      } finally { release(); }
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
  { name: "show_artifact", label: "正在打开作品", description: "重新显示之前保存的照片、录像或文档。空编号表示最近作品。打开并固定用 pinned=true；依次展示多个已有作品时可传 enqueue=true 加入待展示队列，当前作品不被抢占。入队后打开时才能固定。",
    parameters: Type.Object({ id: Type.Optional(Type.String()), pinned: Type.Optional(Type.Boolean()), enqueue: Type.Optional(Type.Boolean()) }), execute: async (_id, params) => {
      const args = params as { id?: string; pinned?: boolean; enqueue?: boolean };
      if (args.enqueue && args.pinned) throw new Error("请在作品打开时固定，不要同时要求入队与固定");
      const item = args.enqueue ? findArtifact(args.id) : presentArtifact(args.id);
      if (!item) throw new Error("没有找到要展示的作品");
      if (args.enqueue) resultPresentation.offer(item);
      if (args.pinned) resultPresentation.pin(true);
      const state = resultPresentation.getSnapshot();
      router.navigate("/"); return text({ id: item.id, title: item.title, kind: item.kind, queued: state.active?.id !== item.id,
        pinned: state.active?.id === item.id && state.pinned, position: state.position, total: state.total }); } },
  { name: "list_artifacts", label: "正在查找作品", description: "列出最近保存的照片、录像和文档的稳定编号，供用户重新播放或继续修改。",
    parameters: Type.Object({}), execute: async () => text(listArtifacts().slice(0, 30).map(({ id, title, kind, createdAt, parentId }) => ({ id, title, kind, createdAt, parentId }))) },
  { name: "artifact_versions", label: "正在查找图片版本", description: "查询当前选中图片或指定作品的原图、修改版本及生成视频关系。返回稳定编号，可用 show_artifact 打开原图或中间版本。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => text({ selected: readArtifactFocus(), versions: listArtifactVersions((params as { id?: string }).id).map(({ id, title, kind, createdAt, parentId }) => ({ id, title, kind, createdAt, parentId })) }) },
  { name: "create_media", label: "正在安排生成任务", description: "生成图片、编辑图片或生成视频。用户指定比例、横屏或竖屏时必须传 aspectRatio：横屏默认16:9，竖屏默认9:16，正方形1:1。图片支持1:1、3:4、4:3、16:9、9:16、2:3、3:2、21:9；视频不支持2:3和3:2，不能静默替换。编辑默认使用当前展示或明确选中的图片版本，存在歧义时先选图。未指定比例时改图保留原图比例，文生图用默认比例，视频默认16:9。图生视频指定 source=image，parentId 可指定准确版本；文生视频指定 source=text。立即返回任务编号，在后台继续生成，不代表已完成。",
    parameters: Type.Object({ kind: Type.Union([Type.Literal("image"), Type.Literal("edit"), Type.Literal("video")]),
      prompt: Type.String({ minLength: 1, maxLength: 2000 }), parentId: Type.Optional(Type.String()), source: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("image")])),
      aspectRatio: Type.Optional(Type.Union(IMAGE_ASPECT_RATIOS.map((ratio) => Type.Literal(ratio)))),
      resolution: Type.Optional(Type.Union(IMAGE_RESOLUTIONS.map((resolution) => Type.Literal(resolution)), { description: "仅图片/改图：1K、2K、3K、4K。用户要求2K等必须传此参数，不能只写prompt。未指定维持默认1K；提高分辨率未指定档位时参考原任务升一档，未知时2K。视频不可传。" })) }),
    execute: async (_id, params, signal) => {
      if (signal?.aborted) throw new Error("已取消提交");
      const args = params as { kind: "image" | "edit" | "video"; prompt: string; parentId?: string; source?: "text" | "image"; aspectRatio?: MediaAspectRatio; resolution?: ImageResolution };
      if (args.source === "text" && args.parentId) throw new Error("文生请求不能同时指定输入图片");
      if (args.kind === "edit" && !args.parentId) throw new Error("改图必须明确传入 parentId。请先核对当前展示或选中图片；用户要以前某个主题的图片时，用 media_status 的 prompt 与 artifactId 找到对应成品，不能默认用最近图片。确认后再调用，不要重复提交已有任务。");
      const parentId = args.kind === "edit" || args.source === "image" || args.parentId ? selectedImage(args.parentId).id : undefined;
      if (args.kind === "image" && parentId) throw new Error("修改已有图片请使用 edit");
      const job = await submitMediaJob({ kind: args.kind, prompt: args.prompt, ...(parentId ? { parentId } : {}), ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}), ...(args.resolution ? { resolution: args.resolution } : {}) }, signal);
      return text({ id: job.id, parentId: job.parentId, model: job.model, aspectRatio: job.aspectRatio, resolution: job.resolution, status: job.status, notice: job.notice }); } },
  { name: "media_status", label: "正在查看生成进度", description: "查询生成图片、改图或视频任务的真实状态和结果作品编号。",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }), execute: async (_id, params) => {
      const { id } = params as { id?: string }; return text(getMediaJobs().list().filter((job) => !id || job.id === id).slice(0, 10)
        .map(({ id, kind, prompt, model, aspectRatio, resolution, status, artifactId, parentId, createdAt, notice }) => ({ id, kind, prompt, model, aspectRatio, resolution, status, artifactId, parentId, createdAt, notice }))); } },
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
