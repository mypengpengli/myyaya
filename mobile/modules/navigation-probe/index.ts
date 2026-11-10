import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type NavigationProbeStatus = {
  available: boolean;
  availability: string;
  serviceInstalled: boolean;
  serviceVersion: string | null;
  lastReport: string | null;
  dataDirectory: string;
};

type Native = {
  getStatus(): Promise<NavigationProbeStatus>;
  captureMonocularFrame(): Promise<{ requestId: string; inputUri: string; imageDimensions: number[]; [key: string]: unknown }>;
  showMonocularFrame(id: string, data: string, inferenceMs: number): Promise<void>;
  exportMonocularBenchmark(): Promise<{ directory: string; files: string[] }>;
  open(): Promise<string | null>;
  openMap(): Promise<string | null>;
  openRoutes(token: string, name: string): Promise<string | null>;
  routeRobotState(token: string, connected: boolean, voiceStop: boolean): Promise<void>;
  acknowledgeRouteMotion(token: string, sequence: number, ok: boolean, message: string): Promise<void>;
  addListener(event: string, callback: (event: RouteMotorEvent) => void): { remove(): void };
  listTaughtRoutes(): Promise<Array<{ id: string; name: string; mapId: string; requiresReference: boolean; waypoints: number }>>;
  stopTaughtRoute(token: string): Promise<void>;
};
export type RouteMotorEvent = { token: string; sequence: number; action: string; durationMs: number; reason?: string };
let native: Native | undefined;
function getNative(): Native {
  if (Platform.OS !== "android") throw new Error("房间视觉探针目前仅支持 Android");
  return native ??= requireNativeModule<Native>("NavigationProbe");
}
export const getNavigationProbeStatus = () => getNative().getStatus();
export const captureNativeMonocularFrame = () => getNative().captureMonocularFrame();
export const showNativeMonocularFrame = (id: string,data: string,inferenceMs: number) => getNative().showMonocularFrame(id,data,inferenceMs);
export const exportNativeMonocularBenchmark = () => getNative().exportMonocularBenchmark();
// Resolves only when the Android activity has closed, so camera/runtime leases
// cannot be released immediately after launch.
export const openNativeNavigationProbe = () => getNative().open();
export const openNativeRoomMap = () => getNative().openMap();
export const openNativeTaughtRoutes = (token: string, name = "") => getNative().openRoutes(token, name);
export const publishRouteRobotState = (token: string, connected: boolean, voiceStop = false) => getNative().routeRobotState(token, connected, voiceStop);
export const acknowledgeRouteMotion = (token: string, sequence: number, ok: boolean, message: string) => getNative().acknowledgeRouteMotion(token, sequence, ok, message);
export const subscribeRouteMotion = (callback: (event: RouteMotorEvent) => void) => getNative().addListener("onRouteMotion", callback);
export const listTaughtRoutes = () => getNative().listTaughtRoutes();
export const stopNativeTaughtRoute = (token: string) => getNative().stopTaughtRoute(token);
