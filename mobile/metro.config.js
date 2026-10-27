const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("onnx");
// Pi's root pi-ai entry discovers Node provider SDKs. Mobile supplies its own
// NewAPI streamFn and only needs Pi's platform-neutral transcript utilities.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@earendil-works/pi-ai" &&
      context.originModulePath.replace(/\\/g, "/").includes("/@earendil-works/pi-agent-core/")) {
    return { type: "sourceFile", filePath: require("path").resolve(__dirname, "src/agent/pi-mobile-compat.ts") };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
