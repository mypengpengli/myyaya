import type { LocalStillCapture } from "../../modules/local-face-attention";
import type { Artifact } from "./artifact-store";
export type PhotoResult = { photo: LocalStillCapture; artifact: Artifact };
export type PhotoReview = { id: number; phase: "idle" | "capturing" | "review" | "saving"; camera: "front" | "back"; photo?: LocalStillCapture; notice: string };

/** A photo is a draft until confirmed. Retakes never save or upload discarded frames. */
export class PhotoCaptureSession {
  private state: PhotoReview = { id: 0, phase: "idle", camera: "front", notice: "" };
  private listeners = new Set<() => void>();
  private complete?: (result: PhotoResult | null) => void;
  private fail?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private cleanup?: () => void;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PhotoReview>) {
    this.state = { ...this.state, ...patch };
    clearTimeout(this.timer);
    const { id, phase } = this.state;
    if (phase === "capturing" || phase === "review") {
      this.timer = setTimeout(() => {
        if (this.state.id !== id || this.state.phase !== phase) return;
        const fail = this.fail;
        this.reset();
        fail?.(new Error(phase === "review" ? "照片预览已超时，草稿已关闭，没有保存。" : "相机一直没有返回照片，请再试一次。"));
      }, 120_000);
    }
    this.listeners.forEach((listener) => listener());
  }
  constructor(private capture: (camera: "front" | "back") => Promise<LocalStillCapture>, private save: (photo: LocalStillCapture) => Promise<Artifact>) {}
  begin(camera: "front" | "back", signal?: AbortSignal): Promise<PhotoResult | null> {
    if (signal?.aborted) return Promise.resolve(null);
    if (this.state.phase !== "idle") throw new Error("请先确认、重拍或取消当前照片");
    const result = new Promise<PhotoResult | null>((resolve, reject) => { this.complete = resolve; this.fail = reject; });
    const abort = () => this.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    this.cleanup = () => { signal?.removeEventListener("abort", abort); };
    this.update({ id: this.state.id + 1, phase: "capturing", camera, photo: undefined, notice: "正在拍照" });
    if (signal?.aborted) this.cancel();
    else void this.take(this.state.id);
    return result;
  }
  private async take(id: number) {
    try {
      const photo = await this.capture(this.state.camera);
      if (this.state.id === id && this.state.phase === "capturing") this.update({ phase: "review", photo, notice: "照片拍好了，可以说或点「确定」「重拍」「取消」" });
    } catch {
      if (this.state.id === id && this.state.phase === "capturing") this.update({ phase: "review", photo: undefined, notice: "拍照失败，请检查相机权限后重拍，或取消" });
    }
  }
  retake() {
    if (this.state.phase !== "review") return;
    this.update({ id: this.state.id + 1, phase: "capturing", photo: undefined, notice: "正在重新拍照" });
    void this.take(this.state.id);
  }
  handleVoice(command: string): boolean {
    if (this.state.phase === "idle") return false;
    if (/^(确定|确认|保存照片|确定保存)$/.test(command)) {
      void this.confirm();
    } else if (/^(重拍|重新拍|重新拍一张|再拍一张)$/.test(command)) {
      this.retake();
    } else if (/^(取消|取消拍照|不要这张)$/.test(command)) {
      if (this.state.phase !== "saving") this.cancel();
    } else return false;
    return true;
  }
  async confirm() {
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
  cancel() { const complete = this.complete; this.reset(); complete?.(null); }
  private reset() {
    this.cleanup?.(); this.cleanup = undefined; this.complete = undefined; this.fail = undefined;
    this.update({ id: this.state.id + 1, phase: "idle", photo: undefined, notice: "" });
  }
}
