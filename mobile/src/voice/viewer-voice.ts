import type { ResultPresentation } from "../artifacts/presentation";
import type { VideoControl } from "../artifacts/video-control";

const phrases = {
  pin: ["固定", "固定这张", "固定这张图", "固定图片", "固定这项", "固定视频", "把这张固定起来"],
  unpin: ["取消固定", "解除固定", "取消固定这张"],
  next: ["下一张", "下一项", "下一个", "看下一张", "展示下一项", "切到下一张"],
  close: ["关闭这张", "关闭图片", "关闭视频", "关闭作品", "关闭展示", "回到表情", "返回表情"],
  pause: ["暂停", "暂停视频", "暂停播放", "视频暂停"],
  play: ["继续播放", "继续播放视频", "播放视频", "继续视频"],
  replay: ["重播", "重播视频", "重新播放", "从头播放", "视频从头播放"],
} as const;

type Action = keyof typeof phrases;
const commands = new Map<string, Action>();
for (const [action, values] of Object.entries(phrases)) {
  for (const phrase of values) commands.set(phrase, action as Action);
}

export class ViewerVoice {
  private target?: string;
  private heardAt = 0;
  constructor(private readonly presentation: ResultPresentation, private readonly video: VideoControl,
    private readonly available: () => boolean = () => true) {}

  reset() { this.target = undefined; }

  hear(command: string, partial: boolean): string | undefined {
    const phrase = command.replace(/^(?:麻烦你|请你|请)?(?:帮我)?/u, "").replace(/(?:好吗|吧|一下)$/u, "");
    const state = this.presentation.getSnapshot();
    if (partial) {
      if (!state.suspended && state.active && phrase && [...commands.keys()].some(value => value.startsWith(phrase)) && this.available()) {
        if (this.target === undefined || Date.now() - this.heardAt > 5_000) this.target = state.active.id;
        this.heardAt = Date.now();
        if (state.active.id === this.target) this.presentation.keepVisibleForVoice();
      }
      return;
    }
    const target = Date.now() - this.heardAt <= 5_000 ? this.target : undefined;
    this.reset();
    const action = commands.get(phrase);
    if (!action || state.suspended) return;
    if (!this.available()) return "请先完成当前的照片预览。";
    if (target && target !== state.active?.id) return "刚才显示的作品已切换，请再说一次。";
    if (action === "next") {
      if (!state.queue.length) return state.active ? "已经是最后一项了。" : "暂时没有待展示的作品。";
      this.presentation.next();
      const next = this.presentation.getSnapshot();
      return `已切换到第 ${next.position} 项，共 ${next.total} 项。`;
    }
    const active = state.active;
    if (action === "pin" || action === "unpin" || action === "close") {
      if (!active) return "当前没有展示作品。";
      if (action === "close") {
        this.presentation.close(false);
        return "已回到表情，作品仍保留。";
      }
      this.presentation.pin(action === "pin");
      return action === "pin" ? "这项已固定。" : "这项已解除固定。";
    }
    if (active?.kind !== "video") return phrase === "播放视频" ? undefined : "当前没有展示视频。";
    if (state.ended && action === "pause") return "这段视频已经播完。";
    const playback = state.ended && action === "play" ? "replay" : action;
    try {
      this.video.run(active.id, playback);
      if (playback !== "pause") this.presentation.videoResumedOrSeeking(active.id);
      return playback === "pause" ? "视频已暂停。" : playback === "replay" ? "已从头播放。" : "视频已继续播放。";
    } catch (error) {
      return error instanceof Error ? error.message : "暂时无法控制这个视频。";
    }
  }
}
