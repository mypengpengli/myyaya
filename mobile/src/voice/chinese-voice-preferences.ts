import { createMMKV } from "react-native-mmkv";

const preferences = createMMKV({ id: "myyaya.chinese-voice" });
const listeners = new Set<() => void>();
export const isChineseWakeEnabled = () => preferences.getBoolean("wakeEnabled") !== false;
export const subscribeChineseWake = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setChineseWakeEnabled(enabled: boolean): void {
  preferences.set("wakeEnabled", enabled);
  for (const listener of listeners) listener();
}
