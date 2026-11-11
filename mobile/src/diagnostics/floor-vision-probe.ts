import * as FileSystem from "expo-file-system/legacy";
import { OnnxInference, base64ToTypedArray, typedArrayToBase64 } from "@siteed/sherpa-onnx.rn";
import { getNavigationProbeStatus, captureNativeMonocularFrame, showNativeFloorLabels, exportNativeMonocularBenchmark } from "../../modules/navigation-probe";
import { analyzeFloorDepth, type FloorRegion } from "../navigation/vision-floor-analysis";
import { holdAmbientMotionFor } from "../core/ambient-motion";
import { holdSocialAttentionMotionFor } from "../core/social-attention";

export async function runFloorVisionProbe(args: { heightCm?: unknown; roi?: FloorRegion }) {
  if(typeof args?.heightCm!=="number" || !Number.isFinite(args.heightCm) || args.heightCm<3 || args.heightCm>50) throw new Error("需要实测镜头高度（厘米）");
  holdAmbientMotionFor(90_000,"floor-vision");holdSocialAttentionMotionFor(90_000,"floor-vision");
  const status=await getNavigationProbeStatus(), modelPath=`file://${status.dataDirectory}/monocular-benchmark/fused_model_int8_256.onnx`;
  const info=await FileSystem.getInfoAsync(modelPath);
  if(!info.exists || info.isDirectory || info.size!==27_342_208) throw new Error("缺少已核验的本地深度模型");
  const session=await OnnxInference.createSession({modelPath,numThreads:4});
  try {
    if(session.inputNames.length!==1 || session.inputTypes[0]!=="uint8") throw new Error("模型输入格式不符");
    const frame=await captureNativeMonocularFrame();
    if(frame.trackingState!=="TRACKING") throw new Error("相机定位尚未有效");
    const input=await FileSystem.readAsStringAsync(frame.inputUri,{encoding:FileSystem.EncodingType.Base64});
    const result=await OnnxInference.run(session.sessionId,{[session.inputNames[0]]:{type:"uint8",dims:[1,256,256,3],data:input}});
    if(!result.success || !result.outputs) throw new Error(result.error || "模型未返回输出");
    const outputs=Object.values(result.outputs);
    if(outputs.length!==1 || outputs[0].type!=="uint8" || outputs[0].dims.join(",")!=="1,252,252") throw new Error("模型格式不符");
    const values=base64ToTypedArray(outputs[0].data,"uint8") as Uint8Array;
    const focal=frame.imageFocalLength as number[], principal=frame.imagePrincipalPoint as number[];
    const analysis=analyzeFloorDepth(values,252,252,{width:frame.imageDimensions[0],height:frame.imageDimensions[1],
      fx:focal[0],fy:focal[1],cx:principal[0],cy:principal[1],q:frame.cameraQuaternion as number[]},args.heightCm/100,
      args.roi ?? {left:.3,top:.65,right:.88,bottom:.82});
    if(!FileSystem.cacheDirectory) throw new Error("缺少应用缓存");
    await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}monocular-benchmark/live.depth`,outputs[0].data,{encoding:FileSystem.EncodingType.Base64});
    await showNativeFloorLabels(frame.requestId,typedArrayToBase64(analysis.labels),analysis.report);
    return {frame,analysis:analysis.report,exported:await exportNativeMonocularBenchmark()};
  } finally {await session.release();}
}
