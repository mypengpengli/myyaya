import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type NavigationProbeStatus = {
  available: boolean;
  availability: string;
  serviceInstalled: boolean;
  serviceVersion: string | null;
  lastReport: string | null;
};

type Native = {
  getStatus(): Promise<NavigationProbeStatus>;
  open(): Promise<string | null>;
};
let native: Native | undefined;
function getNative(): Native {
  if (Platform.OS !== "android") throw new Error("房间视觉探针目前仅支持 Android");
  return native ??= requireNativeModule<Native>("NavigationProbe");
}
export const getNavigationProbeStatus = () => getNative().getStatus();
// Resolves only when the Android activity has closed, so camera/runtime leases
// cannot be released immediately after launch.
export const openNativeNavigationProbe = () => getNative().open();
