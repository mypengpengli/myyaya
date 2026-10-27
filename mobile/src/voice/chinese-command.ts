export type ChineseRobotCommand =
  | { kind: "stop" }
  | { kind: "move"; direction: "forward" | "back" }
  | { kind: "turn"; direction: "left" | "right"; degrees: 90 | 180 }
  | { kind: "head"; direction: "up" | "down" | "center" }
  | { kind: "nod" }
  | { kind: "dance" }
  | { kind: "light"; enabled: boolean };

// Vosk's Chinese decoder inserts spaces between words. Only exact, anchored
// physical commands may drive the robot; never extract actions from prose.
export function compactChinese(text: string): string {
  return text.normalize("NFKC").replace(/[\s，。！？、,.!?]/gu, "").trim();
}
const ADDRESS = /^(?:小丫小丫|小鸭小鸭|小雅小雅)/u;
export function splitChineseWake(text: string): { addressed: boolean; command: string } {
  const value = compactChinese(text);
  return { addressed: ADDRESS.test(value), command: value.replace(ADDRESS, "") };
}
export function isChineseStop(text: string): boolean {
  const { command } = splitChineseWake(text);
  return /^(?:请)?(?:停|停下|停下来|停止|停止移动|停止运动|紧急停止|别动|不要动|刹车)$/u.test(command);
}
export function parseChineseRobotCommand(text: string): ChineseRobotCommand | null {
  const value = splitChineseWake(text).command.replace(/^请/u, "").replace(/(?:一下|一点|一点点)$/u, "");
  if (isChineseStop(value)) return { kind: "stop" };
  if (/^(?:前进|向前|往前|向前走|往前走|前进一步)$/u.test(value)) return { kind: "move", direction: "forward" };
  if (/^(?:后退|退后|向后|往后|向后走|往后走|后退一步)$/u.test(value)) return { kind: "move", direction: "back" };
  if (/^(?:左转|向左转|往左转|向左|往左)$/u.test(value)) return { kind: "turn", direction: "left", degrees: 90 };
  if (/^(?:右转|向右转|往右转|向右|往右)$/u.test(value)) return { kind: "turn", direction: "right", degrees: 90 };
  if (/^(?:转身|掉头|转一圈的一半|转180度|转一百八十度)$/u.test(value)) return { kind: "turn", direction: "right", degrees: 180 };
  if (/^(?:抬头|头抬起来|向上看)$/u.test(value)) return { kind: "head", direction: "up" };
  if (/^(?:低头|头低下去|向下看)$/u.test(value)) return { kind: "head", direction: "down" };
  if (/^(?:头部回正|回正|看前面)$/u.test(value)) return { kind: "head", direction: "center" };
  if (/^(?:点头|点个头)$/u.test(value)) return { kind: "nod" };
  if (/^(?:跳舞|跳个舞|跳一支舞)$/u.test(value)) return { kind: "dance" };
  if (/^(?:开灯|打开灯光)$/u.test(value)) return { kind: "light", enabled: true };
  if (/^(?:关灯|关闭灯光)$/u.test(value)) return { kind: "light", enabled: false };
  return null;
}

export class ChineseCommandGate {
  private until = 0;
  reset() { this.until = 0; }
  accept(text: string, partial: boolean, now: number): { command?: ChineseRobotCommand; wake?: boolean } {
    // STOP bypasses wake, endpoint and conversation windows. Other partials do nothing.
    if (isChineseStop(text)) { this.until = 0; return { command: { kind: "stop" } }; }
    if (partial) return {};
    const addressed = splitChineseWake(text);
    if (addressed.addressed) this.until = now + 15_000;
    if (now >= this.until) return {};
    const command = parseChineseRobotCommand(addressed.command);
    if (command) this.until = now + 15_000;
    return { ...(addressed.addressed ? { wake: true } : {}), ...(command ? { command } : {}) };
  }
}
