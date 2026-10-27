import { AppState, PermissionsAndroid } from "react-native";
import { chineseVoice, resumeAutomaticChineseVoice } from "../voice/chinese-voice-runtime";
import { pauseSocialCamera } from "../core/social-attention";
import { saveVideoArtifact, type Artifact } from "./artifact-store";
import { resultPresentation } from "./presentation";

export type PhoneRecording = { id: number; phase: "idle" | "preparing" | "recording" | "saving" | "error"; camera: "front" | "back"; notice: string };
let state: PhoneRecording = { id: 0, phase: "idle", camera: "back", notice: "" };
const listeners = new Set<() => void>();
export const getPhoneRecording = () => state;
export const subscribePhoneRecording = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const update = (patch: Partial<PhoneRecording>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
let releaseCamera: (() => void) | undefined;
let resumeVoice: (() => Promise<void>) | undefined;
let stopCamera: (() => void) | undefined;
let finished: Promise<Artifact | undefined> | undefined;
let finish: ((value: Artifact | undefined) => void) | undefined;
let recordingStarted = false;
let preparing: Promise<void> | undefined;

export async function startPhoneRecording(camera: "front" | "back"): Promise<PhoneRecording> {
  if (!["idle", "error"].includes(state.phase)) throw new Error("已有录像正在进行，请先停止录像");
  if (AppState.currentState !== "active" || !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA) ||
      !await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) throw new Error("请保持 App 在前台并允许相机和麦克风权限");
  const id = state.id + 1;
  recordingStarted = false;
  finished = new Promise((resolve) => { finish = resolve; });
  update({ id, phase: "preparing", camera, notice: "正在准备录像" });
  try {
    preparing = (async () => {
      const release = await pauseSocialCamera();
      try {
        if (state.phase !== "preparing" || AppState.currentState !== "active") { release(); return; }
        const resume = await chineseVoice.pauseCaptureForRecording();
        if (state.phase !== "preparing" || AppState.currentState !== "active") {
          await resume(); release(); return;
        }
        resumeVoice = resume;
        releaseCamera = release;
        // Mount only after recognition has released the microphone.
        update({ notice: "正在打开录像相机" });
      } catch (error) { release(); throw error; }
    })();
    await preparing;
    return state;
  } catch { failPhoneRecording(id); throw new Error("录像相机准备失败"); }
  finally { preparing = undefined; }
}
export const canMountRecordingCamera = () => Boolean(releaseCamera);
export async function recordingCameraReady(id: number, record: () => Promise<{ uri: string } | undefined>, stop: () => void): Promise<void> {
  if (state.id !== id || state.phase !== "preparing" || recordingStarted) return;
  recordingStarted = true; stopCamera = stop;
  try {
    const video = record();
    update({ phase: "recording", notice: "正在录像 · 点“停止录像”结束" });
    const result = await video;
    stopCamera = undefined;
    if (!result?.uri) throw new Error("相机没有返回录像");
    update({ phase: "saving", notice: "正在保存有声录像" });
    const artifact = await saveVideoArtifact(result.uri);
    resultPresentation.offer(artifact);
    releaseCamera?.(); releaseCamera = undefined;
    update({ phase: "idle", notice: "录像已保存" }); finish?.(artifact); finish = undefined;
    await restoreVoice();
  } catch { failPhoneRecording(id); }
}
export function failPhoneRecording(id: number): void {
  if (state.id !== id) return;
  stopCamera = undefined; releaseCamera?.(); releaseCamera = undefined;
  void restoreVoice();
  update({ phase: "error", notice: "录像未保存成功，请检查相机和麦克风" }); finish?.(undefined); finish = undefined;
}
export async function stopPhoneRecording(): Promise<Artifact | undefined> {
  if (state.phase === "preparing") {
    update({ phase: "saving", notice: "正在取消录像" });
    await preparing?.catch(() => {});
    await restoreVoice();
    releaseCamera?.(); releaseCamera = undefined;
    update({ phase: "idle", notice: "已取消录像" });
    finish?.(undefined); finish = undefined; return;
  }
  if (state.phase === "recording") { update({ phase: "saving", notice: "正在保存录像" }); try { stopCamera?.(); } catch { failPhoneRecording(state.id); } }
  if (state.phase === "saving") return finished;
}
async function restoreVoice() {
  const resume = resumeVoice; resumeVoice = undefined;
  await resume?.().catch(() => {});
  resumeAutomaticChineseVoice();
}
