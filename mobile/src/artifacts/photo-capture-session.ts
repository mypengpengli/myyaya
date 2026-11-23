import type { LocalStillCapture } from "../../modules/local-face-attention";
import type { Artifact } from "./artifact-store";
export type PhotoResult = { photo: LocalStillCapture; artifact: Artifact };
export type PhotoReview = { id: number; phase: "idle" | "framing" | "capturing" | "review" | "saving"; camera: "front" | "back"; ready?: boolean; photo?: LocalStillCapture; notice: string };

/** A photo is a draft until confirmed. Retakes never save or upload discarded frames. */
export class PhotoCaptureSession {
  private state: PhotoReview = { id: 0, phase: "idle", camera: "front", notice: "" };
  private listeners = new Set<() => void>();
  private complete?: (result: PhotoResult | null) => void;
  private fail?: (error: Error) => void;
  private shutter?: () => Promise<LocalStillCapture>;
  private timer?: ReturnType<typeof setTimeout>;
  private cleanup?: () => void;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PhotoReview>) {
    this.state = { ...this.state, ...patch };
    clearTimeout(this.timer);
    const { id, phase } = this.state;
    if (phase === "capturing" || phase === "review" || phase === "framing") {
      this.timer = setTimeout(() => {
        if (this.state.id !== id || this.state.phase !== phase) return;
        const fail = this.fail;
        this.reset();
        fail?.(new Error(phase !== "capturing" ? "照片预览已超时，草稿已关闭，没有保存。" : "相机一直没有返回照片，请再试一次。"));
      }, phase === "capturing" ? 20_000 : 300_000);
    }
    this.listeners.forEach((listener) => listener());
  }
  constructor(private save: (photo: LocalStillCapture) => Promise<Artifact>) {}
  begin(camera: "front" | "back", signal?: AbortSignal): Promise<PhotoResult | null> {
    if (signal?.aborted) return Promise.resolve(null);
    if (this.state.phase !== "idle") throw new Error("请先确认、重拍或取消当前照片");
    const result = new Promise<PhotoResult | null>((resolve, reject) => { this.complete = resolve; this.fail = reject; });
    const abort = () => this.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    this.cleanup = () => { signal?.removeEventListener("abort", abort); };
    this.update({ id: this.state.id + 1, phase: "framing", ready: false, camera, photo: undefined, notice: "正在打开实时取景" });
    if (signal?.aborted) this.cancel();
    return result;
  }
  cameraReady(id: number, shutter: () => Promise<LocalStillCapture>) {
    if (this.state.id !== id || this.state.phase !== "framing") return;
    this.shutter = shutter;
    this.update({ ready: true, notice: "摆好姿势后，说或点「确定」拍摄" });
  }
  cameraFailed(id: number) {
    if (this.state.id !== id || !["framing", "capturing"].includes(this.state.phase)) return;
    this.shutter = undefined;
    this.update({ phase: "review", ready: false, notice: "相机启动失败，可重拍或取消" });
  }
  private async take(id: number) {
    const shutter = this.shutter;
    if (!shutter) return;
    this.shutter = undefined;
    this.update({ phase: "capturing", ready: false, notice: "正在拍摄" });
    try {
      const photo = await shutter();
      if (this.state.id === id && this.state.phase === "capturing") this.update({ phase: "review", photo, notice: "照片拍好了，可以说或点「确定」「重拍」「取消」" });
    } catch {
      if (this.state.id === id && this.state.phase === "capturing") this.update({ phase: "review", photo: undefined, notice: "拍照失败，请检查相机权限后重拍，或取消" });
    }
  }
  retake() {
    if (this.state.phase !== "review") return;
    this.update({ id: this.state.id + 1, phase: "framing", ready: false, photo: undefined, notice: "正在重新打开取景" });
  }
  handleVoice(command: string): boolean {
    if (this.state.phase === "idle") return false;
    if (this.state.phase === "saving") return /^(确定|确认|重拍|保存照片|取消|取消拍照)$/.test(command);
    if (this.state.phase === "capturing") {
      if (/^(取消|取消拍照|不要这张)$/.test(command)) this.cancel();
      return /^(确定|确认|重拍|保存照片|取消|取消拍照|不要这张)$/.test(command);
    }
    if (/^(确定|确认)$/.test(command) || this.state.phase === "review" && /^(保存照片|确定保存)$/.test(command) || this.state.phase === "framing" && /^(拍照|开始拍摄|确定拍摄)$/.test(command)) {
      void this.confirm();
    } else if (/^(重拍|重新拍|重新拍一张|再拍一张)$/.test(command)) {
      this.retake();
    } else if (/^(取消|取消拍照|不要这张)$/.test(command)) {
      this.cancel();
    } else return false;
    return true;
  }
  async confirm() {
    if (this.state.phase === "framing") return this.take(this.state.id);
    if (this.state.phase !== "review" || !this.state.photo) return;
    const { photo, id } = this.state;
    this.update({ phase: "saving", notice: "正在保存照片" });
    try {
      const artifact = await this.save(photo);
      if (this.state.id !== id || this.getSnapshot().phase !== "saving") return;
      const complete = this.complete;
      this.reset(); complete?.({ photo, artifact });
    } catch { if (this.state.id === id && this.getSnapshot().phase === "saving") this.update({ phase: "review", notice: "保存失败，可重试确定或取消" }); }
  }
  cancel() { if (this.state.phase === "saving" || this.state.phase === "idle") return; const complete = this.complete; this.reset(); complete?.(null); }
  private reset() {
    this.shutter = undefined;
    this.cleanup?.(); this.cleanup = undefined; this.complete = undefined; this.fail = undefined;
    this.update({ id: this.state.id + 1, phase: "idle", photo: undefined, notice: "" });
  }
}
