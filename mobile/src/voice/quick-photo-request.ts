import { compactChinese, splitChineseWake } from "./chinese-command";

/** Exact standalone photo requests bypass a cloud tool-selection round trip. */
export function quickPhotoRequest(text: string): { camera: "front" | "back" } | null {
  const value = compactChinese(splitChineseWake(text).command);
  const match = value.match(/^(?:请|麻烦)?(?:你)?(?:帮我|给我|帮忙)?(?:用|使用)?(前置|后置)?(?:摄像头|镜头)?(?:拍|拍摄)(?:一张|个|张)?(?:照片|照|相片)(?:吧|呀|好吗)?$/u);
  return match ? { camera: match[1] === "后置" ? "back" : "front" } : null;
}
