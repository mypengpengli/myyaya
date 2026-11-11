import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type NavigationProbeStatus = {
  available: boolean;
  availability: string;
  serviceInstalled: boolean;
  serviceVersion: string | null;
  lastReport: string | null;
  dataDirectory: string;
  navigationGeometry?: { centerRightMeters: number; alongViewMeters: number; widthMeters: number; lengthMeters: number; marginMeters: number; source: string } | null;
  measuredCameraHeightMeters?: number;
};

export type ContinuousStatus={token?:string;stopEpoch:number;phase?:string;reason?:string;active?:boolean;pose?:{x:number;y:number;yaw:number};poseReady?:boolean;frameNs?:number;[key:string]:unknown};
type Native = {
  continuousStatus():Promise<ContinuousStatus>;
  startContinuous(device:string,epoch:number,config:string):Promise<ContinuousStatus>;
  continuousObservation(token:string,data:string):Promise<void>;
  stopContinuous(reason:string):Promise<void>;
  saveContinuousReport(data:string):Promise<void>;
  getStatus(): Promise<NavigationProbeStatus>;
  diagnosticField(direction: "back" | "back_step" | "left" | "right" | "left_step" | "right_step", confirmed: boolean, stepMs: number, batchId: string): Promise<Record<string, unknown>>;
  beginLocalMission(confirmed: boolean,left: number,top: number,right: number,bottom: number): Promise<{batchId:string;maximumSteps:number;maximumSeconds:number}>;
  localMissionProgress(value:string):Promise<void>;
  saveLocalMissionReport(data:string):Promise<void>;
  localMissionRegion(token:string,left:number,top:number,right:number,bottom:number):Promise<void>;
  beginDiagnosticBatch(confirmed: boolean,left: number,top: number,right: number,bottom: number): Promise<{ batchId: string; maximumSteps: number }>;
  stopOperatorObservation(): Promise<void>;
  showFloorLabels(id: string, labels: string, summary: string): Promise<void>;
  analyzeUprightReference(id: string,height: number,width: number): Promise<Record<string, unknown>>;
  captureMonocularFrame(): Promise<{ requestId: string; inputUri: string; imageDimensions: number[]; [key: string]: unknown }>;
  showMonocularFrame(id: string, data: string, inferenceMs: number): Promise<void>;
  exportMonocularBenchmark(): Promise<{ directory: string; files: string[] }>;
  open(): Promise<string | null>;
  openMap(): Promise<string | null>;
  openRoutes(token: string, name: string): Promise<string | null>;
  routeRobotState(token: string, connected: boolean, voiceStop: boolean,back:boolean,turn:boolean): Promise<void>;
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
export const getContinuousStatus=()=>getNative().continuousStatus();
export const startNativeContinuous=(device:string,epoch:number,gx:number,gy:number,height:number,region:{left:number;top:number;right:number;bottom:number})=>getNative().startContinuous(device,epoch,JSON.stringify({gx,gy,height,region}));
export const observeNativeContinuous=(token:string,data:unknown)=>getNative().continuousObservation(token,JSON.stringify(data));
export const stopNativeContinuous=(reason:string)=>getNative().stopContinuous(reason);
export const saveContinuousReport=(value:unknown)=>getNative().saveContinuousReport(JSON.stringify(value));
export const getNavigationProbeStatus = () => getNative().getStatus();
export const runNativeFieldDiagnostic = (direction: "back" | "back_step" | "left" | "right" | "left_step" | "right_step", confirmed: boolean, stepMs = 150, batchId = "") => getNative().diagnosticField(direction, confirmed, stepMs, batchId);
export const beginNativeLocalMission = (confirmed: boolean,region={left:.3,top:.65,right:.88,bottom:.82}) => getNative().beginLocalMission(confirmed,region.left,region.top,region.right,region.bottom);
export const publishNativeLocalMission = (value:string)=>getNative().localMissionProgress(value);
export const saveNativeLocalMissionReport=(value:unknown)=>getNative().saveLocalMissionReport(JSON.stringify(value));
export const setNativeLocalMissionRegion=(token:string,region:{left:number;top:number;right:number;bottom:number})=>getNative().localMissionRegion(token,region.left,region.top,region.right,region.bottom);
export const beginNativeFieldBatch = (confirmed: boolean,region={left:.3,top:.65,right:.88,bottom:.82}) => getNative().beginDiagnosticBatch(confirmed,region.left,region.top,region.right,region.bottom);
export const stopNativeOperatorObservation = () => getNative().stopOperatorObservation();
export const showNativeFloorLabels = (id: string, labels: string, report: unknown) => getNative().showFloorLabels(id, labels, JSON.stringify(report));
export const analyzeNativeUprightReference = (id: string,height: number,width: number) => getNative().analyzeUprightReference(id,height,width);
export const captureNativeMonocularFrame = () => getNative().captureMonocularFrame();
export const showNativeMonocularFrame = (id: string,data: string,inferenceMs: number) => getNative().showMonocularFrame(id,data,inferenceMs);
export const exportNativeMonocularBenchmark = () => getNative().exportMonocularBenchmark();
// Resolves only when the Android activity has closed, so camera/runtime leases
// cannot be released immediately after launch.
export const openNativeNavigationProbe = () => getNative().open();
export const openNativeRoomMap = () => getNative().openMap();
export const openNativeTaughtRoutes = (token: string, name = "") => getNative().openRoutes(token, name);
export const publishRouteRobotState = (token: string, connected: boolean, voiceStop = false,back=false,turn=false) => getNative().routeRobotState(token, connected, voiceStop,back,turn);
export const acknowledgeRouteMotion = (token: string, sequence: number, ok: boolean, message: string) => getNative().acknowledgeRouteMotion(token, sequence, ok, message);
export const subscribeRouteMotion = (callback: (event: RouteMotorEvent) => void) => getNative().addListener("onRouteMotion", callback);
export const listTaughtRoutes = () => getNative().listTaughtRoutes();
export const stopNativeTaughtRoute = (token: string) => getNative().stopTaughtRoute(token);
