import { AppState, PermissionsAndroid } from "react-native";
import { getLocalFaceAttentionModule, type LocalStillCapture } from "../../modules/local-face-attention";
import { getPhoneRecording } from "./phone-recording";
import { savePhotoArtifact } from "./artifact-store";
import { PhotoCaptureSession, type PhotoResult } from "./photo-capture-session";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

let captureBusy = false;
export async function ensurePhotoAvailable() {
  if (AppState.currentState !== "active" || !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)) throw new Error("请允许相机权限并保持 App 在前台");
  if (["preparing", "recording", "saving"].includes(getPhoneRecording().phase)) throw new Error("正在录像，请先停止录像再拍照");
}
async function capture(cameraFacing: "front" | "back"): Promise<LocalStillCapture> {
  await ensurePhotoAvailable();
  if (captureBusy) throw new Error("相机正在拍摄，请稍后再试");
  const camera = getLocalFaceAttentionModule();
  if (!camera) throw new Error("此安装包没有可用的相机模块");
  if (AppState.currentState !== "active") throw new Error("请保持 App 在前台拍摄");
  captureBusy = true;
  holdAmbientMotionFor(8000, "phone-camera"); holdSocialAttentionMotionFor(8000, "phone-camera");
  try {
    const photo = await camera.captureStill(cameraFacing);
    if (AppState.currentState !== "active") throw new Error("拍照已因进入后台取消");
    return photo;
  } finally { captureBusy = false; }
}
export const photoCapture = new PhotoCaptureSession(capture,
  (photo) => savePhotoArtifact(photo.base64, photo.mimeType, "手机照片"));

/** Observation reuses Camera2 capture and returns an actual image to the model, without opening a Viewer. */
export async function observeScene(camera: "front" | "back", signal?: AbortSignal): Promise<PhotoResult> {
  if (signal?.aborted) throw new Error("已取消观察");
  if (photoCapture.getSnapshot().phase !== "idle") throw new Error("请先确定或取消当前拍摄的照片");
  const photo = await capture(camera);
  if (signal?.aborted) throw new Error("已取消观察");
  const artifact = await savePhotoArtifact(photo.base64, photo.mimeType, "环境观察照片", undefined, { select: false });
  if (signal?.aborted || AppState.currentState !== "active") throw new Error("已取消观察");
  return { photo, artifact };
}
