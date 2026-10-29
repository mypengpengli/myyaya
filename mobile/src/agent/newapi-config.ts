import * as SecureStore from "expo-secure-store";

export type NewApiConfig = { version: 1; baseUrl: string; apiKey: string; model: string; imageModel?: string; videoModel?: string };
export const DEFAULT_NEWAPI_URL = "https://apichat.jiazhuangai.com/v1";
export const DEFAULT_CHAT_MODEL = "agnes-3.0-flash";
export const DEFAULT_IMAGE_MODEL = "agnes-image-2.5-flash";
export const DEFAULT_VIDEO_MODEL = "agnes-video-2.5-flash";
const KEY = "myyaya.newapi.connection.v1";

export function validateNewApiConfig(value: NewApiConfig): NewApiConfig {
  const url = new URL(value.baseUrl.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !["", "/v1"].includes(url.pathname.replace(/\/+$/, ""))) throw new Error("请填写 HTTPS 中转站地址，可带 /v1");
  const apiKey = value.apiKey.trim().replace(/^Bearer\s+/i, "");
  if (!/^[!-~]{8,2048}$/.test(apiKey)) throw new Error("请填写有效的模型 API Key");
  const model = value.model.trim();
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error("请填写对话模型名称");
  const imageModel = value.imageModel?.trim() || DEFAULT_IMAGE_MODEL;
  if (imageModel.length > 200 || /[\r\n]/.test(imageModel)) throw new Error("请填写有效的图片模型名称");
  const videoModel = value.videoModel?.trim() || DEFAULT_VIDEO_MODEL;
  if (videoModel.length > 200 || /[\r\n]/.test(videoModel)) throw new Error("请填写有效的视频模型名称");
  return { version: 1, baseUrl: url.origin + "/v1", apiKey, model, imageModel, videoModel };
}
export async function readNewApiConfig(): Promise<NewApiConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try { return validateNewApiConfig(JSON.parse(raw)); } catch { return null; }
}
export async function saveNewApiConfig(value: NewApiConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(validateNewApiConfig(value)));
}
