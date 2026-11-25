import { createMMKV } from "react-native-mmkv";

const preferences = createMMKV({ id: "myyaya.chinese-voice" });
const listeners = new Set<() => void>();
export const isChineseWakeEnabled = () => preferences.getBoolean("wakeEnabled") !== false;
export const subscribeChineseWake = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setChineseWakeEnabled(enabled: boolean): void {
  preferences.set("wakeEnabled", enabled);
  for (const listener of listeners) listener();
}

export type ChineseAsrMode = "local" | "relay";
export const getChineseAsrMode = (): ChineseAsrMode => preferences.getString("asrMode") === "relay" ? "relay" : "local";
export const getChineseEndSilence = (): number => {
  const value = preferences.getNumber("endSilence");
  return value === 1.1 || value === 1.8 || value === 2.5 ? value : 1.8;
};
export function setChineseAsrMode(mode: ChineseAsrMode) {
  preferences.set("asrMode", mode);
  listeners.forEach(listener => listener());
}
export function setChineseEndSilence(seconds: number) {
  if (![1.1, 1.8, 2.5].includes(seconds)) throw new Error("请选择有效的收句等待时间");
  preferences.set("endSilence", seconds);
  listeners.forEach(listener => listener());
}
