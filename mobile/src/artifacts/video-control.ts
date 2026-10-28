export type VideoSnapshot = { id: string; playing: boolean; seconds: number; duration: number; ready: boolean };
type Player = { playing: boolean; currentTime: number; duration: number; status: string; play(): void; pause(): void };
/** The mounted native player owns this lease. Old screens cannot control a newer player. */
export class VideoControl {
  private binding: { id: string; player: Player } | null = null;
  bind(id: string, player: Player) {
    const binding = { id, player }; this.binding = binding;
    return () => { if (this.binding === binding) this.binding = null; };
  }
  status(): VideoSnapshot | null {
    if (!this.binding) return null;
    const { id, player } = this.binding;
    return { id, playing: player.playing, seconds: Number.isFinite(player.currentTime) ? player.currentTime : 0,
      duration: Number.isFinite(player.duration) ? player.duration : 0, ready: player.status === "readyToPlay" };
  }
  run(id: string, action: "play" | "pause" | "seek" | "replay", seconds?: number) {
    const binding = this.binding;
    if (!binding || binding.id !== id) throw new Error("当前视频尚未准备好或已关闭");
    const player = binding.player;
    if (action !== "pause" && player.status !== "readyToPlay") throw new Error("视频正在加载或播放出错，请稍后重试");
    if (action === "pause") player.pause();
    else if (action === "play") player.play();
    else if (action === "replay") { player.currentTime = 0; player.play(); }
    else {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || player.duration <= 0) throw new Error("请输入有效的播放秒数");
      player.currentTime = Math.min(seconds, player.duration);
    }
    return this.status();
  }
}
export const videoControl = new VideoControl();
