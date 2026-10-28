import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { router } from "expo-router";
import { ensurePhotoAvailable, observeScene, photoCapture } from "../artifacts/phone-camera";
import type { PhotoResult } from "../artifacts/photo-capture-session";
const parameters = Type.Object({ camera: Type.Optional(Type.Union([Type.Literal("front"), Type.Literal("back")])) });
const result = ({ photo, artifact }: PhotoResult, observation: boolean) => ({
  content: [{ type: "text" as const, text: `${observation ? "刚取得当前环境的真实照片，默认不要弹图，仅根据图像回答用户；需要调出时使用作品编号。" : "用户已确认照片，已保存，预览已关闭。"}作品编号：${artifact.id}。摄像头：${photo.cameraFacing}。只代表该镜头当前视野，不能声称已看遍四周。` },
    { type: "image" as const, data: photo.base64, mimeType: photo.mimeType }], details: { id: artifact.id, observation },
});
export const photoTool: AgentTool = {
  name: "phone_photo", label: "正在拍照", description: "用户明确要求拍照留存时使用。眼睛移到左边，右侧显示实拍照片，等待用户点确定、重拍或取消；只有确定后的照片才保存并返回给模型。front 为屏幕前方（默认），back 为手机背后。看环境/看眼前物体请用 observe_scene，无需用户确认。",
  parameters, execute: async (_id, params, signal) => {
    if (signal?.aborted) throw new Error("已取消拍照");
    await ensurePhotoAvailable();
    router.navigate("/");
    const accepted = await photoCapture.begin((params as { camera?: "front" | "back" }).camera ?? "front", signal);
    return accepted ? result(accepted, false) : { content: [{ type: "text", text: "拍照已取消，没有确认或向模型发送照片。" }], details: { cancelled: true } };
  },
};
export const observeSceneTool: AgentTool = {
  name: "observe_scene", label: "正在看眼前的环境", description: "用户问眼前/周边环境、物品或需要视觉信息才能回答时，后台取得当前镜头照片送给模型分析；不移动底座、不显示图片、不要求用户点确定。默认 front 看手机屏幕前方，明确看背后才用 back。用户要求展示照片时另用 show_artifact。",
  parameters, execute: async (_id, params, signal) => result(await observeScene((params as { camera?: "front" | "back" }).camera ?? "front", signal), true),
};
