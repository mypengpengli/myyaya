/** Only public assistant text and factual execution stages belong in the speaker queue. */
export type ConversationFeedback =
  | { kind: "assistant"; text: string; message: number }
  | { kind: "stage"; text: string };
export type ConversationReporter = (feedback: ConversationFeedback) => void;

export const CONVERSATION_WINDOW_MS = 60_000;

/** Emit complete sentences instead of reading individual network tokens aloud. */
export class PublicReplySentences {
  private pending = "";
  private message = 0;
  constructor(private emit: ConversationReporter) {}
  start() { this.pending = ""; this.message++; }
  append(delta: string) {
    this.pending += delta;
    for (;;) {
      const end = this.pending.search(/[。！？!?；;\n]/u);
      const length = end >= 0 ? end + 1 : this.pending.length >= 160 ? 160 : 0;
      if (!length) break;
      const text = this.pending.slice(0, length); this.pending = this.pending.slice(length);
      if (text.trim()) this.emit({ kind: "assistant", text, message: this.message });
    }
  }
  finish(success: boolean) {
    if (success && this.pending.trim()) this.emit({ kind: "assistant", text: this.pending, message: this.message });
    this.pending = "";
  }
}
